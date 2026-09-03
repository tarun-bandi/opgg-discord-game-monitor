import { normalizedResult, parseDuration, queueLabel, stableLiveId, toIsoTime } from "./util.js";

export class SourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "SourceError";
  }
}

export function parseJsonLdDocuments(documents) {
  const parsed = [];
  for (const text of documents) {
    try {
      parsed.push(JSON.parse(text));
    } catch {
      // A page can contain unrelated or malformed structured-data blocks.
    }
  }
  return parsed;
}

export function extractCompletedMatches(documents) {
  const roots = parseJsonLdDocuments(documents);
  const lists = [];
  for (const root of roots) {
    for (const node of Array.isArray(root?.["@graph"]) ? root["@graph"] : [root]) {
      if (node?.["@type"] === "ItemList" && Array.isArray(node.itemListElement)) lists.push(node);
    }
  }

  const list = lists.sort((left, right) => right.itemListElement.length - left.itemListElement.length)[0];
  if (!list) return [];

  return list.itemListElement
    .map((entry, index) => normalizeCompletedItem(entry, index))
    .filter((match) => match.id && match.started_at && match.champion);
}

function normalizeCompletedItem(entry, index) {
  const item = entry?.item ?? entry ?? {};
  const properties = Object.fromEntries(
    (Array.isArray(item.additionalProperty) ? item.additionalProperty : [])
      .filter((property) => property?.name != null)
      .map((property) => [String(property.name), property.value])
  );
  const get = (...keys) => {
    for (const key of keys) {
      if (properties[key] != null) return properties[key];
      if (item[key] != null) return item[key];
    }
    return null;
  };

  return {
    id: String(get("matchId", "match_id", "gameId", "identifier") ?? ""),
    champion: String(get("champion", "championName") ?? ""),
    queue: queueLabel(get("queueType", "queue", "gameType")),
    started_at: toIsoTime(get("startTime", "startedAt", "gameStartTime")),
    result: normalizedResult(get("result", "outcome")),
    duration: parseDuration(get("duration", "gameDuration")),
    position: Number(entry?.position ?? index + 1)
  };
}

export function attachVisibleDurations(matches, visibleDurations) {
  return matches.map((match, index) => ({
    ...match,
    duration: match.duration ?? visibleDurations[index] ?? null
  }));
}

export function findProfileIdentity(documents) {
  const roots = parseJsonLdDocuments(documents);
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if ((node["@type"] === "Person" || node["@type"] === "ProfilePage") && typeof node.name === "string" && node.name.includes("#")) {
      return node.name.trim();
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

export function findLiveGame(documents, tracker) {
  const roots = parseJsonLdDocuments(documents);
  const candidates = [];
  const stack = [...roots];
  const seen = new Set();

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);

    const participants = firstArray(node, "participants", "summoners", "players", "teamParticipants");
    const rawGameId = firstValue(node, "gameId", "game_id", "spectatorGameId", "id");
    if (participants && rawGameId != null) {
      const participant = participants.find((item) => participantMatches(item, tracker));
      if (participant) {
        const champion = championName(participant);
        const queue = queueLabel(firstValue(node, "queueType", "queueName", "gameType", "mode") ?? firstValue(participant, "queueType"));
        const startedAt = toIsoTime(firstValue(node, "gameStartTime", "startTime", "startedAt", "game_start_time"));
        if (champion && startedAt) {
          candidates.push({
            id: String(rawGameId),
            champion,
            queue,
            started_at: startedAt
          });
        }
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }

  return candidates[0] ?? null;
}

function firstArray(object, ...keys) {
  for (const key of keys) if (Array.isArray(object?.[key])) return object[key];
  return null;
}

function firstValue(object, ...keys) {
  for (const key of keys) if (object?.[key] != null) return object[key];
  return null;
}

function participantMatches(participant, tracker) {
  if (!participant || typeof participant !== "object") return false;
  const participantPuuid = firstValue(participant, "puuid", "summonerPuuid", "playerPuuid");
  if (tracker.puuid && participantPuuid && tracker.puuid === participantPuuid) return true;

  const combined = firstValue(participant, "riotId", "riot_id");
  if (combined && String(combined).toLowerCase() === tracker.riotId.toLowerCase()) return true;

  const gameName = firstValue(participant, "gameName", "summonerName", "name");
  const tagLine = firstValue(participant, "tagLine", "tagline", "tag");
  return Boolean(gameName && tagLine && `${gameName}#${tagLine}`.toLowerCase() === tracker.riotId.toLowerCase());
}

function championName(participant) {
  const direct = firstValue(participant, "championName", "champion_name");
  if (direct) return String(direct);
  if (typeof participant.champion === "string") return participant.champion;
  if (participant.champion?.name) return String(participant.champion.name);
  return null;
}

export class OpggCollector {
  static async launch({ headless = true, timeoutMs = 30_000, maxShowMoreClicks = 10 } = {}) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext({
      locale: "en-US",
      timezoneId: "America/New_York",
      userAgent: "Mozilla/5.0 (compatible; opgg-discord-game-monitor/1.0; public-profile-monitor)"
    });
    return new OpggCollector(browser, context, { timeoutMs, maxShowMoreClicks });
  }

  constructor(browser, context, { timeoutMs, maxShowMoreClicks }) {
    this.browser = browser;
    this.context = context;
    this.timeoutMs = timeoutMs;
    this.maxShowMoreClicks = maxShowMoreClicks;
  }

  async observe(tracker, cursorId) {
    const profilePage = await this.context.newPage();
    const livePage = await this.context.newPage();
    try {
      const [profile, live] = await Promise.all([
        this.#completed(profilePage, tracker, cursorId),
        this.#live(livePage, tracker)
      ]);
      return { ...profile, live };
    } finally {
      await Promise.allSettled([profilePage.close(), livePage.close()]);
    }
  }

  async #completed(page, tracker, cursorId) {
    await page.goto(tracker.profileUrl, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
    await page.waitForTimeout(1_500);

    let documents = await page.locator('script[type="application/ld+json"]').allTextContents();
    let matches = extractCompletedMatches(documents);
    if (matches.length === 0) throw new SourceError(`OP.GG returned no structured recent matches for ${tracker.riotId}.`);

    let clicks = 0;
    while (cursorId && !matches.some((match) => match.id === cursorId) && clicks < this.maxShowMoreClicks) {
      const button = page.getByRole("button", { name: /show more/i }).last();
      if (!(await button.isVisible().catch(() => false))) break;
      await button.click({ timeout: this.timeoutMs });
      await page.waitForTimeout(1_000);
      documents = await page.locator('script[type="application/ld+json"]').allTextContents();
      matches = extractCompletedMatches(documents);
      clicks += 1;
    }

    if (cursorId && !matches.some((match) => match.id === cursorId)) {
      throw new SourceError(`Could not reach the saved match cursor for ${tracker.riotId}; state was not changed.`);
    }

    const visibleDurations = await extractVisibleDurations(page);
    matches = attachVisibleDurations(matches, visibleDurations);
    return {
      completed: matches,
      identity: {
        riotId: findProfileIdentity(documents) ?? tracker.riotId,
        profileUrl: stripQueryAndHash(page.url())
      }
    };
  }

  async #live(page, tracker) {
    await page.goto(tracker.ingameUrl, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
    await page.waitForTimeout(1_500);
    const bodyText = await page.locator("body").innerText();
    if (/not in an active game|currently not in (?:a )?game|no active game/i.test(bodyText)) return null;

    const documents = await page.locator('script[type="application/json"], script[type="application/ld+json"], script#__NEXT_DATA__').allTextContents();
    const game = findLiveGame(documents, tracker);
    if (!game) {
      throw new SourceError(`OP.GG appears to show an active game for ${tracker.riotId}, but its public game details could not be read.`);
    }
    game.id ||= stableLiveId({ champion: game.champion, queue: game.queue, startTime: game.started_at, riotId: tracker.riotId });
    return game;
  }

  async close() {
    await this.browser.close();
  }
}

async function extractVisibleDurations(page) {
  const texts = await page.locator("main").evaluate((root) => {
    const durationPattern = /\b(?:(?:\d+):)?\d{1,2}:\d{2}\b|\b\d+\s*m(?:in(?:utes?)?)?\s*\d+\s*s/i;
    const all = [...root.querySelectorAll("*")];
    return all
      .filter((element) => {
        const text = element.textContent?.trim() ?? "";
        if (!durationPattern.test(text)) return false;
        return ![...element.children].some((child) => durationPattern.test(child.textContent?.trim() ?? ""));
      })
      .map((element) => element.textContent.trim());
  });

  const durations = [];
  for (const text of texts) {
    const duration = parseDuration(text);
    if (duration && durations.at(-1) !== duration) durations.push(duration);
  }
  return durations;
}

function stripQueryAndHash(value) {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
