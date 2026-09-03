const MAX_EMBED_DESCRIPTION = 3_900;
const MAX_TOTAL_EMBED_TEXT = 5_800;

export function buildDiscordPayload(entries, timeZone = "America/New_York") {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Cannot build an empty Discord alert.");
  const ordered = [...entries].sort((left, right) => new Date(left.start_time) - new Date(right.start_time));
  const detectionTimes = new Set(ordered.map((entry) => entry.detected_at));
  const commonDetection = detectionTimes.size === 1 ? ordered[0].detected_at : null;
  const header = commonDetection ? `Detected: ${formatZonedTime(commonDetection, timeZone)}\n\n` : "";
  const blocks = ordered.map((entry) => renderEntry(entry, timeZone, !commonDetection));
  const descriptions = chunkDescriptions(header, blocks);
  const totalLength = descriptions.reduce((sum, description) => sum + description.length, 0);
  if (totalLength > MAX_TOTAL_EMBED_TEXT) {
    throw new Error("Discord alert is too large for one message; reduce the number of newly imported games.");
  }

  return {
    content: "",
    allowed_mentions: { parse: [] },
    embeds: descriptions.map((description, index) => ({
      title: index === 0 ? "League game alert" : "League game alert (continued)",
      description,
      color: 0x5383e8
    }))
  };
}

function renderEntry(entry, timeZone, showDetection) {
  const title = `**${escapeMarkdown(entry.riot_id)}** — ${escapeMarkdown(entry.champion)} — ${escapeMarkdown(entry.queue)}`;
  const status = entry.status === "live"
    ? "LIVE"
    : `${escapeMarkdown(entry.result ?? "Completed")} • ${escapeMarkdown(entry.duration ?? "duration unavailable")}`;
  const details = [`Started: ${formatZonedTime(entry.start_time, timeZone)}`, status];
  if (showDetection) details.push(`Detected: ${formatZonedTime(entry.detected_at, timeZone)}`);
  return `${title}\n${details.join(" • ")}`;
}

function chunkDescriptions(header, blocks) {
  const output = [];
  let current = header;
  for (const block of blocks) {
    const candidate = current ? `${current}${current.endsWith("\n\n") ? "" : "\n\n"}${block}` : block;
    if (candidate.length > MAX_EMBED_DESCRIPTION && current) {
      output.push(current.trim());
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) output.push(current.trim());
  return output;
}

export function formatZonedTime(value, timeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${value}`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function escapeMarkdown(value) {
  return String(value ?? "").replace(/([\\`*_{}\[\]()<>#+\-.!|])/g, "\\$1");
}
