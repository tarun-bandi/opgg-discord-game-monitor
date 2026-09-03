# OP.GG Discord Game Monitor

A small, stateful League of Legends monitor that reads public OP.GG pages and posts Discord webhook alerts when a configured summoner starts or completes a game.

It is designed around conservative delivery:

- one alert per game;
- multiple newly discovered games are grouped into one Discord message;
- a live alert is edited when the completed result appears;
- completed-match IDs, live-game IDs, and per-summoner report maps are deduplicated independently;
- state is written atomically only after required Discord requests succeed;
- source or Discord failures leave the prior state intact;
- Discord mentions are disabled in every payload.

This project uses public profile information only. It does not require a Riot API key, OP.GG credentials, Discord bot token, or private player data. It is not affiliated with Riot Games, OP.GG, or Discord.

## Requirements

- Node.js 20 or newer
- a Discord webhook
- Chromium installed through Playwright

## Setup

```sh
npm install
npx playwright install chromium
cp config.example.json config.local.json
cp .env.example .env
```

Edit `config.local.json`, then set either `DISCORD_WEBHOOK_URL` or `DISCORD_WEBHOOK_FILE` in `.env`. The latter keeps the secret out of environment listings:

```sh
mkdir -p .secrets
chmod 700 .secrets
printf '%s\n' 'YOUR_WEBHOOK_URL' > .secrets/discord-webhook-url
chmod 600 .secrets/discord-webhook-url
```

Do not paste a real webhook into `config.example.json`, source code, issues, logs, or commits.

## Safe first run

Initialization is deliberately separate from monitoring:

```sh
npm run init-monitor
```

That command reads the current newest completed game for each summoner, creates `work/lol-monitor-state.json`, and sends nothing to Discord. It refuses to overwrite an existing state file. This prevents a fresh installation from sending historical-summary alerts.

Then run one check:

```sh
npm run once
```

Or run the one-minute watch:

```sh
npm start
```

Only one monitor process should use a state file. A lock file enforces this. If the process was forcibly killed, confirm it is no longer running before removing a stale `work/lol-monitor-state.json.lock` file.

## Configuration

Each entry in `summoners` accepts:

| Field | Required | Meaning |
| --- | --- | --- |
| `region` | yes | OP.GG region slug, such as `na` |
| `riotId` | yes | Riot ID in `Game Name#Tag` form |
| `puuid` | no | Stable public PUUID used to follow a renamed account |
| `profileUrl` | no | Override the generated OP.GG profile URL |
| `ingameUrl` | no | Override the generated OP.GG live-game URL |
| `baseline.completedMatchId` | recommended | Absolute historical cutoff that must never be reported |
| `baseline.startedAt` | recommended | Timestamp paired with the cutoff |

Global settings:

- `timeZone` defaults to `America/New_York`;
- `maxShowMoreClicks` limits OP.GG pagination while looking for a saved cursor;
- `pageTimeoutMs` controls browser navigation timeouts.

`config.local.json`, `.env`, `.secrets/`, and runtime JSON files are ignored by Git. The committed example configuration contains placeholders only.

## Existing monitor state

The loader accepts both this project's version 2 tracker map and the earlier layout where the primary summoner lived at the top level and additional summoners lived under `additional_summoners`. The older layout is migrated in memory and written as version 2 after a fully successful check.

Do not run this service and another automation against the same webhook and summoners at the same time. Stop the old monitor before switching, or duplicate alerts can occur even if each monitor deduplicates correctly on its own.

## How a check works

1. Load and validate durable state before contacting OP.GG.
2. Record one observation timestamp.
3. Read the public JSON-LD recent-match list and visible duration cards for every profile.
4. Page only until the persisted completed-match cursor is found.
5. Inspect every configured live-game page.
6. Correlate live and completed records by game ID, or by champion, queue, and start time within ten minutes.
7. PATCH existing live alerts, then POST one grouped message for all new games.
8. Atomically save the new state only if all required Discord calls succeeded.

If OP.GG changes its markup, the collector fails closed: it logs a source error, sends nothing, and preserves the prior state so the next check can retry.

## Docker

The image is based on Microsoft's Playwright image so Chromium and its system libraries are already present:

```sh
docker build -t opgg-game-monitor .
docker run --rm \
  --env-file .env \
  -v "$PWD/config.local.json:/app/config.local.json:ro" \
  -v "$PWD/.secrets:/app/.secrets:ro" \
  -v "$PWD/work:/app/work" \
  opgg-game-monitor
```

Run the initialization command once by appending `node src/cli.js --init` to that `docker run` command.

## CI/CD

The GitHub Actions pipeline in `.github/workflows/pipeline.yml` uses only the repository-provided `GITHUB_TOKEN`; no registry password is required.

- Pull requests test Node.js 20 and 24, validate syntax, scan tracked files for webhook secrets, audit production dependencies, build the container, and confirm ignored secrets/state are absent from the image.
- A successful push to `main` publishes multi-architecture `linux/amd64` and `linux/arm64` images to `ghcr.io/tarun-bandi/opgg-discord-game-monitor` with `edge` and commit-SHA tags.
- A successful `v1.2.3` tag publishes `1.2.3`, `1.2`, `1`, `latest`, and commit-SHA tags.
- A manual workflow run performs validation only by default. Enabling its `publish` input publishes a commit-SHA image.
- Published images include a BuildKit SBOM and a GitHub/Sigstore build-provenance attestation.

For a public repository, set the generated GHCR package visibility to public after its first publication. In **Settings → Branches**, protect `main` and require the `Delivery summary` check before merging.

Create a release after the `main` build passes:

```sh
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

The pipeline continuously delivers a deployable image; it does not assume access to a particular server. On a Docker host, replace the image owner/repository in `deploy/compose.example.yaml` and provide the ignored local configuration, state directory, and webhook secret.

```sh
docker compose -f deploy/compose.example.yaml pull
docker compose -f deploy/compose.example.yaml up -d
```

## Testing

```sh
npm test
npm run check
npm run secret-check
```

Tests cover JSON-LD parsing, public-PUUID live-game matching, cursor discovery, grouped alerts, live-to-completed edits, fallback correlation, and legacy-state preservation.

## Repository

Source code and releases are published at [tarun-bandi/opgg-discord-game-monitor](https://github.com/tarun-bandi/opgg-discord-game-monitor). Before contributing or publishing a release, run the secret audit described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
