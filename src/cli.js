#!/usr/bin/env node

import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig, loadDotEnv, readWebhookUrl } from "./config.js";
import { DiscordWebhookClient } from "./discord.js";
import { runMonitorCycle } from "./monitor.js";
import { OpggCollector } from "./opgg.js";
import { acquireStateLock, createInitializedState, loadState, saveStateAtomic } from "./state.js";
import { safeError } from "./util.js";

const argumentsSet = new Set(process.argv.slice(2));
const initialize = argumentsSet.has("--init");
const once = initialize || argumentsSet.has("--once");
const unknown = [...argumentsSet].filter((argument) => !["--init", "--once"].includes(argument));
if (unknown.length > 0) {
  console.error(`Unknown option: ${unknown.join(", ")}`);
  process.exitCode = 2;
} else {
  await main();
}

async function main() {
  await loadDotEnv();
  const configPath = resolve(process.env.CONFIG_PATH ?? "config.local.json");
  const statePath = resolve(process.env.STATE_PATH ?? "work/lol-monitor-state.json");
  const pollIntervalMs = positiveInteger(process.env.POLL_INTERVAL_MS ?? 60_000, "POLL_INTERVAL_MS");
  const headless = String(process.env.HEADLESS ?? "true").toLowerCase() !== "false";
  const config = await loadConfig(configPath);
  const releaseLock = await acquireStateLock(statePath);
  const collector = await OpggCollector.launch({
    headless,
    timeoutMs: config.pageTimeoutMs,
    maxShowMoreClicks: config.maxShowMoreClicks
  });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    if (initialize) {
      await initializeState(config, collector, statePath);
      return;
    }

    const discord = new DiscordWebhookClient(await readWebhookUrl());
    do {
      const cycleStarted = Date.now();
      try {
        // Loading and validating durable state happens before every source request.
        const state = await loadState(statePath, config);
        const detectedAt = new Date().toISOString();
        const outcome = await runMonitorCycle({ config, state, collector, discord, detectedAt });
        await saveStateAtomic(statePath, outcome.state);
        console.log(`${detectedAt} check complete; new=${outcome.newAlerts}, edited=${outcome.editedMessages}`);
      } catch (error) {
        console.error(`${new Date().toISOString()} check failed: ${safeError(error)}`);
        if (once) process.exitCode = 1;
      }
      if (!once && !stopping) await sleep(Math.max(0, pollIntervalMs - (Date.now() - cycleStarted)));
    } while (!once && !stopping);
  } finally {
    await collector.close().catch(() => {});
    await releaseLock().catch(() => {});
  }
}

async function initializeState(config, collector, statePath) {
  try {
    await access(statePath);
    throw new Error(`Refusing to replace existing state at ${statePath}. Move it aside explicitly before initialization.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const detectedAt = new Date().toISOString();
  const observations = new Map();
  for (const tracker of config.summoners) {
    observations.set(tracker.key, await collector.observe(tracker, null));
  }
  const state = createInitializedState(config, observations, detectedAt);
  await saveStateAtomic(statePath, state);
  console.log(`${detectedAt} initialized ${config.summoners.length} tracker(s); no Discord messages sent.`);
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
