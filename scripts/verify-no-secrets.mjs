import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const webhookPattern = /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,}\/[A-Za-z0-9._-]{20,}/i;

const { stdout } = await execute("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024
});

const matches = [];
for (const path of stdout.split("\0").filter(Boolean)) {
  const content = await readFile(path);
  if (content.includes(0)) continue;
  if (webhookPattern.test(content.toString("utf8"))) matches.push(path);
}

if (matches.length > 0) {
  console.error(`Potential Discord webhook secret found in: ${matches.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("No Discord webhook secrets found in tracked files.");
}
