import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalTrackerKey, profileUrl } from "./util.js";

export async function loadDotEnv(path = ".env") {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

export async function loadConfig(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(raw.summoners) || raw.summoners.length === 0) {
    throw new Error("Configuration must contain at least one summoner.");
  }

  const seen = new Set();
  const summoners = raw.summoners.map((summoner) => {
    if (!summoner?.region || !summoner?.riotId?.includes("#")) {
      throw new Error("Every summoner needs a region and a Riot ID in GameName#Tag form.");
    }
    const region = String(summoner.region).toLowerCase();
    const riotId = String(summoner.riotId).trim();
    const key = canonicalTrackerKey(region, riotId);
    if (seen.has(key)) throw new Error(`Duplicate summoner configuration: ${riotId}`);
    seen.add(key);

    const publicProfileUrl = summoner.profileUrl ?? profileUrl(region, riotId);
    return {
      key,
      region,
      riotId,
      puuid: summoner.puuid ?? null,
      profileUrl: publicProfileUrl,
      ingameUrl: summoner.ingameUrl ?? `${publicProfileUrl}/ingame`,
      baseline: {
        completedMatchId: summoner.baseline?.completedMatchId ?? null,
        startedAt: summoner.baseline?.startedAt ?? null
      }
    };
  });

  return {
    timeZone: raw.timeZone ?? "America/New_York",
    maxShowMoreClicks: positiveInteger(raw.maxShowMoreClicks, 10),
    pageTimeoutMs: positiveInteger(raw.pageTimeoutMs, 30_000),
    summoners
  };
}

export async function readWebhookUrl() {
  if (process.env.DISCORD_WEBHOOK_URL) return validateWebhook(process.env.DISCORD_WEBHOOK_URL.trim());
  if (process.env.DISCORD_WEBHOOK_FILE) {
    const value = (await readFile(resolve(process.env.DISCORD_WEBHOOK_FILE), "utf8")).trim();
    return validateWebhook(value);
  }
  throw new Error("Set DISCORD_WEBHOOK_URL or DISCORD_WEBHOOK_FILE.");
}

function validateWebhook(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Discord webhook configuration is not a valid URL.");
  }
  if (url.protocol !== "https:" || !/^(?:canary\.|ptb\.)?discord(?:app)?\.com$/i.test(url.hostname)) {
    throw new Error("Discord webhook must use an official Discord HTTPS host.");
  }
  if (!/^\/api\/webhooks\/[^/]+\/[^/]+/.test(url.pathname)) {
    throw new Error("Discord webhook URL has an unexpected path.");
  }
  return value;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received ${value}.`);
  return parsed;
}
