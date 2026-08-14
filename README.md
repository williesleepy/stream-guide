# 📺 Stream Guide

A continuously updating Discord display for notable **Super Smash Bros. Ultimate** and **Super Smash Bros. Melee** tournaments happening during the current week.

This version is a **Node.js / JavaScript** project using `discord.js`. There is no Python runtime or Python tooling.

Stream Guide keeps **one bot-authored Discord message** updated instead of posting a new message every refresh. It uses the **start.gg GraphQL API** for tournament discovery, Smash event metadata, registered broadcasts, stream queues, rounds, players, and queued/active sets. When configured, Twitch is used only to verify the live/offline state of Twitch channels already associated with a tournament. A small explicit override file can provide official broadcast evidence when a major organizer publishes broadcasts outside start.gg.

## What it shows

- Notable Ultimate and Melee tournaments during the current Monday–Sunday week, **only when there is credible broadcast evidence**: either an enabled start.gg stream or an explicit official broadcast override.
- Extra emphasis on notable tournaments happening today.
- Displayed size uses the largest entrant count among the Smash bracket(s) that are still relevant now; bracket counts are never summed, so past series brackets and cross-entered players do not inflate the visible number. Tournament attendance is shown only when relevant event entrant data is unavailable.
- Concluded tournaments are removed from the guide once all listed Smash events are completed; tournaments from prior days also do not linger if completion state is stale.
- For today's tournaments:
  - every enabled broadcast start.gg lists, plus any explicit official fallback link configured for that tournament;
  - whether the channel is live (Twitch is authoritative when optional Twitch credentials are configured; otherwise start.gg's live state is used);
  - Ultimate or Melee when the queued set identifies the game;
  - stream/channel;
  - current round and players when a queued set has actually started;
  - the next queued match when start.gg supplies it.
- Graceful fallback to channel/game/status information when set-level detail is unavailable.

The bot **does not infer a current match from queue order alone**. A queue is ordered, but a set is only labeled “Now” when start.gg provides `startedAt` without `completedAt`.

## Notability

Stream Guide is intentionally conservative: it is acceptable for the guide to be empty when no sufficiently large Smash bracket with credible broadcast information is relevant.

The primary eligibility signal is the entrant count of the **relevant Ultimate/Melee event(s)**:

1. a relevant Smash event must meet the entrant threshold for its location type: `MIN_NOTABLE_OFFLINE_ENTRANTS` (default `80`) when a physical location is listed, or `MIN_NOTABLE_ONLINE_ENTRANTS` (default `128`) when the tournament resolves to `Online / location not listed`; or
2. only when start.gg provides no entrant count for the relevant Smash events, a compact tournament may fall back to `MIN_NOTABLE_ATTENDEES` tournament attendees (default `100`).

`competitionTier` no longer makes a tournament notable by itself. It is used only as a ranking signal after a tournament has already qualified.

### Reused series / long-running tournament pages

Some organizers reuse one start.gg tournament page for many brackets over months or years. Stream Guide detects these pages from their event schedule and does **not** let historical brackets inflate current notability:

- weekly notability uses only current/upcoming, non-completed Smash events from today through the end of the current week; earlier brackets from the same week are discarded;
- **Happening Today** uses only Smash events scheduled on the current local date for a reused/long-running page;
- tournament-wide attendance is ignored as a notability fallback for these pages because it can aggregate unrelated brackets.

Compact multi-day tournaments are treated differently: a genuine tournament spanning up to seven days remains one tournament, so a large main bracket can keep it notable across the days that tournament is actually running.

Today's notable tournaments are selected first, then the rest of the weekly slots are filled by the strongest remaining candidates. Ranking favors tier signal among already-qualified events, then relevant Smash entrants, then tournament attendance.

A tournament is only eligible for the guide when it has credible broadcast evidence. By default that means start.gg returns at least one enabled tournament stream. For known majors whose organizers publish broadcasts elsewhere, `config/broadcast-overrides.json` can provide an exact tournament-slug fallback to an official broadcast page or channel. Broadcast availability is checked before display slot limits are applied, so an unstreamed higher-ranked tournament does not block a lower-ranked notable tournament that does have broadcast information.

The bundled override file currently includes **CEO 2026** because CEO's official site directs viewers to its own all-in-one broadcast page while start.gg may not expose tournament-level streams. The fallback links to the official CEO broadcast hub rather than guessing which specific channel is carrying Ultimate or Melee.

## Repository layout

```text
stream-guide/
├── .github/workflows/ci.yml
├── .env.example
├── .gitignore
├── .node-version
├── README.md
├── package.json
├── render.yaml
├── config/
│   └── broadcast-overrides.json
├── src/
│   ├── bot.js
│   ├── broadcasts.js
│   ├── config.js
│   ├── display.js
│   ├── logger.js
│   ├── main.js
│   ├── models.js
│   ├── service.js
│   ├── startgg.js
│   ├── time.js
│   └── twitch.js
└── tests/
    ├── broadcasts.test.js
    ├── models.test.js
    └── service.test.js
```

## Requirements

- Node.js **24.17+**. The repository pins Node **24.19.0 LTS** in `.node-version` for consistent local/Render builds.
- A Discord bot token.
- A start.gg API token.

## Discord setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Invite the bot to the target server.
3. Give it these channel permissions:
   - View Channel
   - Send Messages
   - Read Message History
4. Copy the server (guild) ID and channel ID.

No privileged Message Content intent is required.

### Why Read Message History matters

There is deliberately no database. On startup the bot scans up to the latest **1,000 messages** in the configured channel for its own **📺 Stream Guide** display. It recognizes both the current Components V2 display and the previous embed-based version, so the first V2 deployment can migrate the existing message in place instead of posting a duplicate. If the message was deleted—or history cannot be read—it creates a replacement.

That makes restarts and Render redeployments self-healing without persistent storage.

## start.gg behavior

The API has rate/complexity limits, so discovery is less frequent than the live refresh:

- Discord/live refresh: about every `60` seconds.
- Full weekly discovery: every `300` seconds by default. Discovery is scoped to tournament start dates in the current Monday–Sunday week instead of scanning the prior week too, which keeps the result set and API pagination substantially smaller.
- Broadcast presence is verified for notable candidates during discovery. An enabled start.gg stream or an exact official override is sufficient.
- Only today's selected tournaments have full stream details re-fetched every minute. Start.gg streams are merged with official overrides; if optional Twitch verification is enabled, Twitch live/offline state is refreshed at the same time.
- Reused/series-like tournament pages are re-fetched with their full Smash event schedule before notability is evaluated. For those pages, brackets from prior local calendar days—and brackets already marked completed—are excluded before entrant counts and notability are calculated.
- Broadcast metadata and stream queues are requested separately, so a queue/complexity failure can still fall back to reliable channel/live-state information.

## Environment variables

Copy `.env.example` to `.env` for local development. Node 24's built-in environment-file loader is used, so no dotenv package is required. Never commit `.env`.

### Required

```dotenv
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_CHANNEL_ID=
STARTGG_API_TOKEN=
```

### Optional

```dotenv
DISPLAY_TIMEZONE=America/New_York
REFRESH_SECONDS=60
DISCOVERY_REFRESH_SECONDS=300
MIN_NOTABLE_OFFLINE_ENTRANTS=80
MIN_NOTABLE_ONLINE_ENTRANTS=128
MIN_NOTABLE_ATTENDEES=100
MAX_WEEKLY_TOURNAMENTS=10
MAX_TODAY_TOURNAMENTS=5
STARTGG_MAX_DISCOVERY_PAGES=30
BROADCAST_OVERRIDES_PATH=config/broadcast-overrides.json
# TWITCH_CLIENT_ID=
# TWITCH_CLIENT_SECRET=
LOG_LEVEL=INFO
```

`DISPLAY_TIMEZONE` controls the guide’s Monday–Sunday week boundary and refresh-time display. “Happening Today” is evaluated in each tournament’s own start.gg timezone when available, falling back to `DISPLAY_TIMEZONE` only when necessary.


### Broadcast overrides

`config/broadcast-overrides.json` is deliberately explicit and slug-scoped. It is for exceptional cases where an organizer has published an official broadcast destination but has not attached streams to start.gg. Example:

```json
[
  {
    "tournamentSlug": "tournament/ceo-2026",
    "broadcasts": [
      {
        "streamName": "Official CEO 2026 broadcast hub",
        "streamSource": "WEB",
        "url": "https://ceogaming.org/tv/"
      }
    ]
  }
]
```

Overrides are **not** fuzzy tournament-name guesses unless you intentionally configure `namePattern`. Prefer exact `tournamentSlug` values and official organizer URLs.

### Optional Twitch live verification

If `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are both set, Stream Guide obtains a Twitch app access token and checks Twitch channels through Helix. Twitch then overrides stale start.gg `isOnline` values for those channels. If Twitch verification fails, the bot keeps the existing start.gg/override broadcast information rather than hiding the tournament.

These credentials are optional. Create a Twitch developer application and add the two values to Render manually if you want platform-authoritative live/offline status. Do **not** commit the client secret.

## Local run

```bash
npm install
cp .env.example .env
# Fill in .env
npm start
```

Run tests and syntax checks with:

```bash
npm test
npm run check
```

## Deploy to Render as a Background Worker

This repo includes `render.yaml` for a Render Background Worker.

1. Push the repository to GitHub.
2. In Render, create a **Blueprint** from the repository, or create a Background Worker manually.
3. Set the four secret environment variables in Render:
   - `DISCORD_BOT_TOKEN`
   - `DISCORD_GUILD_ID`
   - `DISCORD_CHANNEL_ID`
   - `STARTGG_API_TOKEN`
4. Deploy.

Render will use:

```text
Build: npm install --omit=dev
Start: npm start
```

No web port, database, Redis instance, or persistent disk is required.

## Behavior during API failures

- start.gg requests have bounded retries for transient network/server errors and 429 responses.
- If a refresh fails after a successful prior refresh, the bot keeps the last good data and adds a warning to the display rather than replacing it with guesses or an empty state.
- If the richer queue/detail request for a selected tournament fails after its broadcast association was already verified, the bot keeps the start.gg/official-override broadcast metadata and falls back gracefully on match-level detail.
- Twitch verification is optional and fail-open: a Twitch outage or credential problem does not erase otherwise credible broadcast information.

## Broadcast URLs and authority

start.gg remains the primary source for tournament→stream associations and stream queues. Twitch channel URLs can be constructed reliably. For YouTube, organizer data can represent different identifier shapes, so Stream Guide uses a YouTube search URL instead of assuming every `streamName` is a channel ID.

Explicit overrides are a narrow fallback for official organizer broadcast destinations when start.gg is incomplete. They do not fabricate round/player data. When an override supplies only a broadcast hub, the display labels it **Broadcast info** and leaves live status unknown instead of guessing.

When optional Twitch verification is configured, Twitch is authoritative only for whether an attached Twitch channel is live. start.gg remains authoritative for Smash bracket/queue/set information.

## Security

- Credentials are read only from environment variables.
- `.env` is ignored by Git.
- `render.yaml` declares secret values with `sync: false` instead of embedding them.
- Tokens are never logged by the application.


### Today / concluded behavior

**Happening Today** is evaluated in each tournament’s own start.gg timezone (falling back to `DISPLAY_TIMEZONE` when unavailable). A tournament is removed when all Smash events are `COMPLETED` or when it is at least **4 hours past its scheduled end**, which prevents stale unfinished brackets from lingering overnight.
