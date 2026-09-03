import test from "node:test";
import assert from "node:assert/strict";
import { findCorrelatedLiveReport, findNewCompletedMatches, runMonitorCycle } from "../src/monitor.js";

const config = {
  timeZone: "America/New_York",
  summoners: [configured("na:a#one", "A#ONE"), configured("na:b#two", "B#TWO")]
};

test("new games across trackers use one Discord POST", async () => {
  const state = baseState();
  const observations = new Map([
    ["A#ONE", observation(match("new-a", "Ahri", "2026-08-23T15:00:00Z"), match("old-a", "Lux", "2026-08-23T14:00:00Z"))],
    ["B#TWO", observation(match("new-b", "Garen", "2026-08-23T15:02:00Z"), match("old-b", "Annie", "2026-08-23T14:02:00Z"))]
  ]);
  const collector = { observe: async (tracker) => observations.get(tracker.riotId) };
  const calls = [];
  const discord = {
    post: async (payload) => { calls.push(["post", payload]); return "message-99"; },
    patch: async (...args) => calls.push(["patch", ...args])
  };

  const outcome = await runMonitorCycle({
    config,
    state,
    collector,
    discord,
    detectedAt: "2026-08-23T15:03:00Z"
  });

  assert.equal(outcome.newAlerts, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "post");
  assert.deepEqual(calls[0][1].allowed_mentions, { parse: [] });
  assert.equal(outcome.state.trackers["na:a#one"].reported_games["new-a"].discord_message_id, "message-99");
  assert.equal(outcome.state.trackers["na:b#two"].reported_games["new-b"].discord_message_id, "message-99");
});

test("a completed game edits its original grouped live message", async () => {
  const state = baseState();
  state.trackers["na:a#one"].reported_games["live-1"] = {
    status: "live",
    live_game_id: "live-1",
    champion: "Ahri",
    queue: "Ranked Solo/Duo",
    start_time: "2026-08-23T15:00:00Z",
    detected_at: "2026-08-23T15:01:00Z",
    discord_message_id: "message-42"
  };
  state.trackers["na:b#two"].reported_games["older-b"] = {
    status: "completed",
    champion: "Garen",
    queue: "Ranked Solo/Duo",
    start_time: "2026-08-23T14:30:00Z",
    result: "WIN",
    duration: "30m 0s",
    detected_at: "2026-08-23T15:01:00Z",
    discord_message_id: "message-42"
  };
  const observations = new Map([
    ["A#ONE", observation(match("complete-1", "Ahri", "2026-08-23T15:05:00Z"), match("old-a", "Lux", "2026-08-23T14:00:00Z"))],
    ["B#TWO", observation(match("old-b", "Annie", "2026-08-23T14:02:00Z"))]
  ]);
  const calls = [];
  const outcome = await runMonitorCycle({
    config,
    state,
    collector: { observe: async (tracker) => observations.get(tracker.riotId) },
    discord: {
      post: async () => { throw new Error("unexpected POST"); },
      patch: async (id, payload) => calls.push([id, payload])
    },
    detectedAt: "2026-08-23T15:40:00Z"
  });

  assert.equal(outcome.editedMessages, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "message-42");
  assert.match(calls[0][1].embeds[0].description, /A\\#ONE/);
  assert.match(calls[0][1].embeds[0].description, /B\\#TWO/);
  assert.equal(outcome.state.trackers["na:a#one"].reported_games["live-1"], undefined);
  assert.equal(outcome.state.trackers["na:a#one"].reported_games["complete-1"].status, "completed");
});

test("fallback correlation requires champion, queue, and a close start time", () => {
  const reports = {
    live: {
      status: "live",
      champion: "Ahri",
      queue: "Ranked Solo/Duo",
      start_time: "2026-08-23T15:00:00Z"
    }
  };
  assert.ok(findCorrelatedLiveReport(reports, {
    id: "different-id",
    champion: "Ahri",
    queue: "SOLORANKED",
    started_at: "2026-08-23T15:09:59Z"
  }));
  assert.equal(findCorrelatedLiveReport(reports, {
    id: "different-id",
    champion: "Ahri",
    queue: "SOLORANKED",
    started_at: "2026-08-23T15:10:01Z"
  }), null);
});

test("completed-match discovery stops at the persisted cursor", () => {
  const matches = [
    match("newest", "Ahri", "2026-08-23T16:00:00Z"),
    match("middle", "Lux", "2026-08-23T15:00:00Z"),
    match("cursor", "Garen", "2026-08-23T14:00:00Z"),
    match("old", "Annie", "2026-08-23T13:00:00Z")
  ];
  assert.deepEqual(findNewCompletedMatches(matches, "cursor").map((item) => item.id), ["middle", "newest"]);
});

function configured(key, riotId) {
  return {
    key,
    region: "na",
    riotId,
    puuid: null,
    profileUrl: `https://op.gg/${riotId}`,
    ingameUrl: `https://op.gg/${riotId}/ingame`,
    baseline: {}
  };
}

function baseState() {
  return {
    version: 2,
    last_check_at: null,
    discord: {},
    trackers: {
      "na:a#one": trackerState("A#ONE", "old-a"),
      "na:b#two": trackerState("B#TWO", "old-b")
    }
  };
}

function trackerState(riotId, cursorId) {
  return {
    summoner: { region: "NA", riot_id: riotId },
    baseline: {},
    newest_completed_match: { id: cursorId },
    newest_live_game_id: null,
    reported_games: {}
  };
}

function observation(...matches) {
  return {
    completed: matches,
    live: null,
    identity: null
  };
}

function match(id, champion, startedAt) {
  return {
    id,
    champion,
    queue: "Ranked Solo/Duo",
    started_at: startedAt,
    result: "WIN",
    duration: "31m 4s"
  };
}
