# OutpaceF1

OutpaceF1 is a party game where friends replay a real F1 race on a shared screen and, when the safety car comes out, each person makes the pit call for their driver out loud from their phone: box or stay out, and why. Meta's Muse Spark grades each player's reasoning and groups the room into camps, then every call is scored against what actually happened to comparable cars, alongside the real team's call and our engine's.

Built at HackTX 2026 (October 24–25, 2026). Everything in this repository was written during the event.

## How a round works

1. The host opens a lobby on a laptop. Players scan the QR code and join on their phones with a nickname. The host picks one driver for everyone, or lets each player pick their own.
2. The race replays lap by lap with a timing tower and telemetry for each player's car: lap times against the cars ahead and behind, gaps and their trend, tyre compound and age.
3. When the safety car or virtual safety car comes out, the replay freezes. Each player has 40 seconds to call BOX or STAY OUT and record a voice note of up to 30 seconds explaining why. The screen shows where a stop would put them back on track, and their gap to any rival who has already pitted.
4. The reveal shows everyone's call and reason, the camps Muse found in the room, what the real team did, what our engine called, and how much time each call was worth.

Two moments ship with the game: the lap 7 safety car at the 2025 Qatar Grand Prix, and the lap 39 virtual safety car at the 2026 Singapore Grand Prix.

## How a call is scored

- **The right answer** comes from the race itself. For each driver we take the cars within three places that made the other call, then compare how the gap changed by the lap all of them had made their next stop. The call whose cars gained time is correct, and the average gain is the swing shown on screen. For Piastri at Qatar, boxing was worth 15.6 s.
- **Points:** 100 for the right call, plus up to 50 for reasoning, split across four published factors: tyre age, a cheaper stop under the safety car, what similar cars did, and track position.
- **No hindsight on screen.** Before the reveal, players and the engine see only what a pit wall could see at the moment of the call: the order and gaps at the end of the previous lap. The full race and the answers stay on the server until the lobby reaches the reveal.

## AI used

We built OutpaceF1 with AI coding tools and we say so everywhere, including in every commit's co-author line.

- **Building the project:** Claude Code (Anthropic) wrote most of the code, research notes and documents in this repository, directed and reviewed by the team.
- **Inside the product:** Meta Muse Spark (`muse-spark-1.3`, via the Meta Model API) reads each player's transcript and decides which scoring factors they actually named, then labels the room's camps after the reveal. A server-side cap stops all Muse calls once logged spend reaches a set budget (default $5), and the game falls back to a keyword parser.
- **Speech to text** uses the browser's built-in speech recognition. In Chrome that sends audio to Google.
- **Not AI:** the engine's pit call and the scoring are plain Python and TypeScript arithmetic over lap data.

## Data

- Lap times, positions and pit stops: [Jolpica F1 API](https://api.jolpi.ca/ergast/f1/) (the Ergast successor).
- Tyre stints, race control and team radio metadata: [OpenF1](https://openf1.org/).
- A few hand-entered facts, each with a source URL, in `data/manual/`.

The data is cached in `data/`, built by `engine/build.py`, and loaded into Postgres (`races`, `race_laps`, `decision_points`, `decision_drivers`) by `scripts/seed-db.mjs`. The app reads it through `/api/decisions`.

OutpaceF1 is a fan project with no affiliation to Formula 1, the FIA or any team. Team colours appear only as small data markers.

## Stack

- Next.js 16 (App Router) and React 19, Tailwind CSS 4
- Neon Postgres via `@neondatabase/serverless`
- Python 3 for the data build and the engine (`engine/`)
- Hosted on Vercel

## Run it locally

Requirements: Node 20 or later, Python 3 (tested on 3.13), a Postgres database (Neon works).

```bash
npm install
cp .env.example .env.local       # fill in DATABASE_URL, SITE_PASSWORD, CRON_SECRET; MODEL_API_KEY is optional
node --env-file=.env.local scripts/migrate.mjs
node --env-file=.env.local scripts/seed-db.mjs
npm run dev:lan                   # HTTPS on your Wi-Fi so phones can use the mic
```

Open the host screen at `https://<your laptop's LAN IP>:3000`, enter the password from `SITE_PASSWORD`, and create a lobby. Phones on the same Wi-Fi join with the QR code. Without `MODEL_API_KEY`, reasoning is graded by the keyword parser.

Checks: `.claude/verify.sh` runs the type-check, lint, engine tests, trigger tests, gate tests, security tests and data tests.

## Security and privacy

- The test deployment sits behind a shared password. Every page, API route and data route is gated.
- Hosts and players get random tokens on create and join. Only hashes are stored.
- Joining requires consent to show your nickname and spoken reasons to the room and on the leaderboard. A daily job deletes lobbies, names and calls once they are more than 24 hours old, so nothing stays longer than about 48 hours.
- The code went through three rounds of security review before the first deploy, and every finding was fixed.

## Repository map

| Path | What it holds |
|---|---|
| `app/`, `components/`, `lib/client/` | Screens for the host, phone, leaderboard and gate |
| `app/api/` | Lobby, submit, reveal, leaderboard and data routes |
| `lib/db/`, `db/schema.sql` | Postgres queries and schema |
| `lib/muse/` | Muse Spark client, prompts and spend cap |
| `engine/` | Data build, engine, ground truth and race-mode trigger detection, with tests |
| `scripts/` | Migrate, seed, purge and test scripts |

## Open source used

Next.js, React, Tailwind CSS, `@neondatabase/serverless`, zod, qrcode, ESLint and TypeScript, each under its own license. Fonts come from Google Fonts.
