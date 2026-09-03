import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalTrackerKey } from "./util.js";

export async function loadState(path, config) {
  let raw;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`State file is missing. Run \"npm run init-monitor\" before starting the monitor.`);
    }
    if (error instanceof SyntaxError) throw new Error("State file is not valid JSON; no alerts were sent.");
    throw error;
  }

  const state = normalizeState(raw);
  validateState(state, config);
  return state;
}

export function normalizeState(raw) {
  if (raw?.version >= 2 && raw.trackers && typeof raw.trackers === "object") return structuredClone(raw);

  if (!raw?.summoner || !raw?.reported_games || !raw?.additional_summoners) {
    throw new Error("State file does not match a supported schema; no alerts were sent.");
  }

  const trackers = {};
  const primaryKey = canonicalTrackerKey(raw.summoner.region, raw.summoner.riot_id);
  trackers[primaryKey] = normalizeTracker(raw);
  for (const tracker of Object.values(raw.additional_summoners)) {
    const key = canonicalTrackerKey(tracker.summoner.region, tracker.summoner.riot_id);
    trackers[key] = normalizeTracker(tracker);
  }

  return {
    version: 2,
    initialized_at: raw.initialized_at ?? null,
    last_check_at: raw.last_check_at ?? null,
    discord: structuredClone(raw.discord ?? {}),
    trackers
  };
}

function normalizeTracker(raw) {
  return {
    summoner: structuredClone(raw.summoner),
    baseline: structuredClone(raw.baseline ?? {}),
    newest_completed_match: structuredClone(raw.newest_completed_match ?? null),
    newest_live_game_id: raw.newest_live_game_id ?? null,
    reported_games: structuredClone(raw.reported_games ?? {}),
    initialized_at: raw.initialized_at ?? null
  };
}

export function validateState(state, config) {
  if (!state?.trackers || typeof state.trackers !== "object") throw new Error("State has no tracker map.");
  for (const configured of config.summoners) {
    const [key, tracker] = findStateTracker(state, configured);
    if (!tracker) throw new Error(`State has no cursor for ${configured.riotId}; run initialization deliberately.`);
    if (!tracker.newest_completed_match?.id && !tracker.baseline?.completed_match_id) {
      throw new Error(`State has no completed-match guardrail for ${configured.riotId}.`);
    }
    if (!tracker.reported_games || typeof tracker.reported_games !== "object") {
      throw new Error(`State has an invalid reported-games map for ${configured.riotId}.`);
    }
    if (key !== configured.key) {
      delete state.trackers[key];
      state.trackers[configured.key] = tracker;
    }
  }
}

export function findStateTracker(state, configured) {
  if (state.trackers[configured.key]) return [configured.key, state.trackers[configured.key]];
  const entry = Object.entries(state.trackers).find(([, tracker]) => {
    if (configured.puuid && tracker.summoner?.puuid) return configured.puuid === tracker.summoner.puuid;
    return canonicalTrackerKey(tracker.summoner?.region, tracker.summoner?.riot_id) === configured.key;
  });
  return entry ?? [null, null];
}

export function createInitializedState(config, observations, detectedAt) {
  const trackers = {};
  for (const configured of config.summoners) {
    const observed = observations.get(configured.key);
    const newest = observed?.completed?.[0];
    if (!newest) throw new Error(`Cannot initialize ${configured.riotId} without a visible completed match.`);
    trackers[configured.key] = {
      summoner: {
        region: configured.region.toUpperCase(),
        riot_id: observed.identity?.riotId ?? configured.riotId,
        ...(configured.puuid ? { puuid: configured.puuid } : {}),
        profile_url: observed.identity?.profileUrl ?? configured.profileUrl,
        ingame_url: configured.ingameUrl
      },
      baseline: {
        completed_match_id: configured.baseline.completedMatchId ?? newest.id,
        started_at: configured.baseline.startedAt ?? newest.started_at
      },
      newest_completed_match: newest,
      newest_live_game_id: observed.live?.id ?? null,
      reported_games: {},
      initialized_at: detectedAt
    };
  }
  return {
    version: 2,
    initialized_at: detectedAt,
    last_check_at: detectedAt,
    discord: {},
    trackers
  };
}

export async function saveStateAtomic(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const body = `${JSON.stringify(state, null, 2)}\n`;
  try {
    await writeFile(temporary, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function acquireStateLock(path) {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`, "utf8");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Another monitor may be using ${path}; lock file exists.`);
    throw error;
  }
  return async () => {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true });
  };
}
