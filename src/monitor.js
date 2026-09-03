import { buildDiscordPayload } from "./format.js";
import { SourceError } from "./opgg.js";
import { minutesApart, queueLabel } from "./util.js";

export function findNewCompletedMatches(matches, cursorId, baseline = {}) {
  const cursorIndex = matches.findIndex((match) => match.id === cursorId);
  if (cursorIndex < 0) throw new SourceError("The saved completed-match cursor was not present in the fetched match list.");
  const cutoff = baseline.started_at ? new Date(baseline.started_at).getTime() : Number.NEGATIVE_INFINITY;
  return matches
    .slice(0, cursorIndex)
    .filter((match) => match.id !== baseline.completed_match_id)
    .filter((match) => new Date(match.started_at).getTime() > cutoff)
    .reverse();
}

export function findCorrelatedLiveReport(reportedGames, completedMatch) {
  for (const [key, report] of Object.entries(reportedGames)) {
    if (report.status !== "live") continue;
    if (key === completedMatch.id || report.live_game_id === completedMatch.id) return [key, report];
  }
  for (const [key, report] of Object.entries(reportedGames)) {
    if (report.status !== "live") continue;
    const sameChampion = normalized(report.champion) === normalized(completedMatch.champion);
    const sameQueue = normalized(queueLabel(report.queue)) === normalized(queueLabel(completedMatch.queue));
    const closeStart = minutesApart(report.start_time, completedMatch.started_at) <= 10;
    if (sameChampion && sameQueue && closeStart) return [key, report];
  }
  return null;
}

export async function runMonitorCycle({ config, state, collector, discord, detectedAt = new Date().toISOString() }) {
  const nextState = structuredClone(state);
  const newReports = [];
  const patchMessageIds = new Set();

  for (const configured of config.summoners) {
    const trackerState = nextState.trackers[configured.key];
    const effective = effectiveTracker(configured, trackerState);
    const cursorId = trackerState.newest_completed_match?.id ?? trackerState.baseline.completed_match_id;
    const observation = await collector.observe(effective, cursorId);
    const newCompleted = findNewCompletedMatches(observation.completed, cursorId, trackerState.baseline);

    updateIdentity(trackerState, effective, observation.identity);

    for (const match of newCompleted) {
      assertCompleteMatch(match, effective.riotId);
      const existing = trackerState.reported_games[match.id];
      if (existing?.status === "completed") continue;

      const correlated = findCorrelatedLiveReport(trackerState.reported_games, match);
      if (correlated) {
        const [liveKey, liveReport] = correlated;
        delete trackerState.reported_games[liveKey];
        const completedReport = {
          ...liveReport,
          status: "completed",
          completed_match_id: match.id,
          live_game_id: liveReport.live_game_id ?? liveKey,
          champion: match.champion,
          queue: match.queue,
          start_time: match.started_at,
          result: match.result,
          duration: match.duration
        };
        trackerState.reported_games[match.id] = completedReport;
        if (!completedReport.discord_message_id) {
          throw new Error(`A live report for ${effective.riotId} has no Discord message ID.`);
        }
        patchMessageIds.add(completedReport.discord_message_id);
      } else if (!existing) {
        const report = {
          status: "completed",
          completed_match_id: match.id,
          champion: match.champion,
          queue: match.queue,
          start_time: match.started_at,
          result: match.result,
          duration: match.duration,
          detected_at: detectedAt,
          discord_message_id: null
        };
        trackerState.reported_games[match.id] = report;
        newReports.push({ configured, trackerState, key: match.id, report });
      }
    }

    const scrapedNewest = observation.completed[0];
    if (scrapedNewest) {
      trackerState.newest_completed_match = mergeMatch(trackerState.newest_completed_match, scrapedNewest);
    }

    if (observation.live) {
      trackerState.newest_live_game_id = observation.live.id;
      const alreadyReported = Object.values(trackerState.reported_games).some((report) =>
        report.live_game_id === observation.live.id ||
        (normalized(report.champion) === normalized(observation.live.champion) &&
          normalized(queueLabel(report.queue)) === normalized(queueLabel(observation.live.queue)) &&
          minutesApart(report.start_time, observation.live.started_at) <= 10)
      );
      if (!alreadyReported) {
        const report = {
          status: "live",
          live_game_id: observation.live.id,
          champion: observation.live.champion,
          queue: observation.live.queue,
          start_time: observation.live.started_at,
          result: null,
          duration: null,
          detected_at: detectedAt,
          discord_message_id: null
        };
        trackerState.reported_games[observation.live.id] = report;
        newReports.push({ configured, trackerState, key: observation.live.id, report });
      }
    } else {
      trackerState.newest_live_game_id = null;
    }
  }

  nextState.last_check_at = detectedAt;

  for (const messageId of patchMessageIds) {
    const entries = reportsForMessage(nextState, messageId);
    await discord.patch(messageId, buildDiscordPayload(entries, config.timeZone));
  }

  if (newReports.length > 0) {
    const entries = newReports.map(({ trackerState, report }) => reportWithIdentity(trackerState, report));
    const messageId = await discord.post(buildDiscordPayload(entries, config.timeZone));
    for (const pending of newReports) pending.report.discord_message_id = messageId;
    nextState.discord ??= {};
    nextState.discord.last_message_id = messageId;
  }

  return {
    state: nextState,
    newAlerts: newReports.length,
    editedMessages: patchMessageIds.size
  };
}

export function reportsForMessage(state, messageId) {
  const entries = [];
  for (const tracker of Object.values(state.trackers)) {
    for (const report of Object.values(tracker.reported_games)) {
      if (report.discord_message_id === messageId) entries.push(reportWithIdentity(tracker, report));
    }
  }
  if (entries.length === 0) throw new Error(`No state entries refer to Discord message ${messageId}.`);
  return entries;
}

function reportWithIdentity(trackerState, report) {
  return { riot_id: trackerState.summoner.riot_id, ...report };
}

function effectiveTracker(configured, trackerState) {
  const saved = trackerState.summoner ?? {};
  return {
    ...configured,
    riotId: saved.riot_id ?? configured.riotId,
    puuid: saved.puuid ?? configured.puuid,
    profileUrl: saved.profile_url ?? configured.profileUrl,
    ingameUrl: saved.ingame_url ?? configured.ingameUrl
  };
}

function updateIdentity(trackerState, effective, identity) {
  trackerState.summoner ??= {};
  trackerState.summoner.region = String(effective.region).toUpperCase();
  trackerState.summoner.riot_id = identity?.riotId ?? effective.riotId;
  if (effective.puuid) trackerState.summoner.puuid = effective.puuid;
  trackerState.summoner.profile_url = identity?.profileUrl ?? effective.profileUrl;
  trackerState.summoner.ingame_url = `${trackerState.summoner.profile_url.replace(/\/$/, "")}/ingame`;
}

function assertCompleteMatch(match, riotId) {
  const missing = ["id", "champion", "queue", "started_at", "result", "duration"].filter((key) => !match[key]);
  if (missing.length > 0) {
    throw new SourceError(`A new match for ${riotId} is missing ${missing.join(", ")}; no state was changed.`);
  }
}

function mergeMatch(previous, scraped) {
  if (!previous || previous.id !== scraped.id) return scraped;
  return Object.fromEntries(
    Object.entries({ ...previous, ...scraped }).map(([key, value]) => [key, value ?? previous[key]])
  );
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}
