import test from "node:test";
import assert from "node:assert/strict";
import { attachVisibleDurations, extractCompletedMatches, findLiveGame } from "../src/opgg.js";

test("extractCompletedMatches reads OP.GG-style JSON-LD", () => {
  const documents = [JSON.stringify({
    "@type": "ItemList",
    itemListElement: [{
      position: 1,
      item: {
        startTime: "2026-08-23T12:03:32+09:00",
        duration: "PT15M14S",
        additionalProperty: [
          { name: "matchId", value: "match-1" },
          { name: "champion", value: "Renekton" },
          { name: "result", value: "WIN" },
          { name: "queueType", value: "EVENT" }
        ]
      }
    }]
  })];

  assert.deepEqual(extractCompletedMatches(documents), [{
    id: "match-1",
    champion: "Renekton",
    queue: "Featured",
    started_at: "2026-08-23T03:03:32.000Z",
    result: "WIN",
    duration: "15m 14s",
    position: 1
  }]);
});

test("visible duration is used when JSON-LD omits it", () => {
  const matches = [{ id: "one", duration: null }, { id: "two", duration: "20m 0s" }];
  assert.deepEqual(attachVisibleDurations(matches, ["11m 3s", "19m 59s"]), [
    { id: "one", duration: "11m 3s" },
    { id: "two", duration: "20m 0s" }
  ]);
});

test("findLiveGame follows a public PUUID", () => {
  const documents = [JSON.stringify({
    props: {
      activeGame: {
        gameId: 123456789,
        queueType: "SOLORANKED",
        gameStartTime: 1_787_500_000_000,
        participants: [
          { puuid: "target-puuid", champion: { name: "Ahri" }, gameName: "Renamed", tagLine: "NA1" }
        ]
      }
    }
  })];

  assert.deepEqual(findLiveGame(documents, {
    puuid: "target-puuid",
    riotId: "Old Name#NA1"
  }), {
    id: "123456789",
    champion: "Ahri",
    queue: "Ranked Solo/Duo",
    started_at: new Date(1_787_500_000_000).toISOString()
  });
});
