import test from "node:test";
import assert from "node:assert/strict";
import { normalizeState, validateState } from "../src/state.js";

test("legacy monitor state migrates without dropping reported games", () => {
  const legacy = {
    version: 1,
    summoner: { region: "NA", riot_id: "Primary#NA1" },
    baseline: { completed_match_id: "baseline-a" },
    newest_completed_match: { id: "cursor-a" },
    newest_live_game_id: null,
    reported_games: { a: { status: "completed" } },
    additional_summoners: {
      "na:second#na1": {
        summoner: { region: "NA", riot_id: "Second#NA1", puuid: "public-puuid" },
        baseline: { completed_match_id: "baseline-b" },
        newest_completed_match: { id: "cursor-b" },
        newest_live_game_id: null,
        reported_games: { b: { status: "completed" } }
      }
    },
    discord: { last_message_id: "42" }
  };
  const state = normalizeState(legacy);
  assert.equal(state.version, 2);
  assert.equal(state.trackers["na:primary#na1"].reported_games.a.status, "completed");
  assert.equal(state.trackers["na:second#na1"].reported_games.b.status, "completed");
  assert.equal(state.discord.last_message_id, "42");
});

test("validation refuses to invent a missing tracker cursor", () => {
  const state = { version: 2, trackers: {} };
  const config = { summoners: [{ key: "na:nobody#na1", riotId: "Nobody#NA1", puuid: null }] };
  assert.throws(() => validateState(state, config), /no cursor/i);
});
