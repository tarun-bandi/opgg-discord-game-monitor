import { createHash } from "node:crypto";

export function canonicalTrackerKey(region, riotId) {
  return `${String(region).toLowerCase()}:${String(riotId).trim().toLowerCase()}`;
}

export function opggSlug(riotId) {
  return encodeURIComponent(String(riotId).replace("#", "-")).replace(/%2F/gi, "%252F");
}

export function profileUrl(region, riotId) {
  return `https://op.gg/lol/summoners/${String(region).toLowerCase()}/${opggSlug(riotId)}`;
}

export function queueLabel(value) {
  const normalized = String(value ?? "Unknown")
    .replace(/[\s_-]+/g, "")
    .toUpperCase();

  const labels = {
    SOLORANKED: "Ranked Solo/Duo",
    RANKEDSOLODUO: "Ranked Solo/Duo",
    FLEXRANKED: "Ranked Flex",
    RANKEDFLEX: "Ranked Flex",
    NORMAL: "Normal",
    ARAM: "ARAM",
    EVENT: "Featured",
    FEATURED: "Featured",
    ARENA: "Arena",
    SWIFTPLAY: "Swiftplay",
    QUICKPLAY: "Quickplay"
  };

  return labels[normalized] ?? String(value ?? "Unknown");
}

export function normalizedResult(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["WIN", "VICTORY", "WON"].includes(normalized)) return "WIN";
  if (["LOSE", "LOSS", "DEFEAT", "LOST"].includes(normalized)) return "LOSE";
  if (normalized === "REMAKE") return "REMAKE";
  return normalized || null;
}

export function parseDuration(value) {
  if (value == null) return null;
  const text = String(value).trim();
  const iso = text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (iso) {
    const totalSeconds = Number(iso[1] ?? 0) * 3600 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0);
    return durationLabel(totalSeconds);
  }

  const clock = text.match(/\b(?:(\d+):)?(\d{1,2}):(\d{2})\b/);
  if (clock) {
    const totalSeconds = Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    return durationLabel(totalSeconds);
  }

  const words = text.match(/\b(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?)?\s*)?(\d+)\s*s(?:ec(?:onds?)?)?\b/i);
  if (words) {
    const totalSeconds = Number(words[1] ?? 0) * 3600 + Number(words[2] ?? 0) * 60 + Number(words[3]);
    return durationLabel(totalSeconds);
  }

  return null;
}

export function durationLabel(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0 ? `${hours}h ${minutes}m ${remainder}s` : `${minutes}m ${remainder}s`;
}

export function toIsoTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || /^\d{10,13}$/.test(String(value))) {
    const numeric = Number(value);
    const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function minutesApart(first, second) {
  const left = new Date(first).getTime();
  const right = new Date(second).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.POSITIVE_INFINITY;
  return Math.abs(left - right) / 60_000;
}

export function stableLiveId({ champion, queue, startTime, riotId }) {
  const fingerprint = [riotId, champion, queue, toIsoTime(startTime)].join("|").toLowerCase();
  return `live:${createHash("sha256").update(fingerprint).digest("hex").slice(0, 24)}`;
}

export function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https:\/\/[^\s]+\/api\/webhooks\/[^\s]+/gi, "[redacted webhook]");
}
