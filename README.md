# OutpaceF1

OutpaceF1 is a party game where friends replay a real F1 race on a shared screen and, at the moments a pit wall has to decide, each person makes the call for their driver from their phone: box or stay out, and why. Nobody finds out who was right until the end, when every call is scored against what actually happened in the race, with Meta's Muse Spark grading the reasoning.

Built at HackTX 2026 (October 24–25, 2026). Everything in this repository was written during the event.

## How a game works

1. The host opens a lobby on a laptop and picks a race. Players scan the QR code and join on their phones with a nickname. The host picks one driver for everyone, or lets each player pick their own.
2. The race replays lap by lap with a timing tower and telemetry for each player's car: lap times against the cars ahead and behind, gaps and their trend, tyre compound and age.
3. The replay freezes at decision moments: a safety car or VSC, a rival stopping nearby, an undercut window, tyres fading, the tyre window, or rain. Each player has 40 seconds to call BOX or STAY OUT and record a voice note of up to 30 seconds (tap to start, tap to stop) or type why. The screen shows where a stop would put them back on track and their gap to any rival who has already pitted. Between freezes, any player can call "box now" on their own.
4. At the flag, one end screen shows the final ranking and each moment: the right call, how much it was worth, and everyone's call, reasoning score and points.

A quick single-moment mode (the lap 7 safety car at the 2025 Qatar Grand Prix, or the lap 39 VSC at the 2026 Singapore Grand Prix) uses the same end screen.

## How a call is scored

- **The right answer** comes from the race itself. For each driver we take the cars within three places that made the other call, then compare how the gap changed once all of them had made their next stop. The call whose cars gained time is correct. For Piastri at Qatar, boxing was worth 15.6 s.
- **Luck is handled separately.** When a safety car, VSC, red flag or rain after the call changed the result, a Muse Spark verdict precomputed from the facts known at the call decides what was right, and the end screen says why.
- **Points:** stakes = how much the call was worth (swing seconds × 5, up to 100). A call scores stakes × (0.37 if right + 0.78 × reasoning/50 − 0.15). Reasoning counts for more than the call: a wrong call argued well beats a right call with no reason.
- **Reasoning** is graded out of 50 by Muse Spark against the facts of that moment (tyre age and stops still owed, the cheaper stop under a safety car, what similar cars did, track position). It's a party game, so any attempt earns something and scores centre around 25.
- **Our engine is just another player.** It is scored with the same formula and never decides the right answer.
- **No hindsight.** During the game, players see only what a pit wall could see at the moment of the call. Answers and scores stay on the server until the end.

## AI used

We built OutpaceF1 with AI coding tools and we say so everywhere, including in every commit's co-author line.

- **Building the project:** Claude Code (Anthropic) wrote most of the code, research notes and documents in this repository, directed and reviewed by the team.
- **Inside the product:**
  - Meta Muse Voice Transcribe turns each voice note into text. If it's unavailable, the browser's own speech recognition is used (in Chrome that sends audio to Google).
  - Meta Muse Spark (`muse-spark-1.3`) grades each reason out of 50 at the end of the game, and decides the right call for moments where luck changed the result.
  - A server-side cap stops all Muse calls once logged spend reaches a set budget, and the game falls back to a keyword grader.
- **Not AI:** the engine's pit calls, the measured right answers and the points arithmetic are plain Python and TypeScript over lap data.

## Data

- Lap times, positions and pit stops: [Jolpica F1 API](https://api.jolpi.ca/ergast/f1/) (the Ergast successor).
- Tyre stints, race control and team radio metadata: [OpenF1](https://openf1.org/).
- A few hand-entered facts, each with a source URL, in `data/manual/`.

The data is cached in `data/`, built by `engine/build.py`, and loaded into Postgres (`races`, `race_laps`, `decision_points`, `decision_drivers`) by `scripts/seed-db.mjs`. The app reads it through `/api/decisions`.

OutpaceF1 is a fan project with no affiliation to Formula 1, the FIA or any team. Team colours appear only as plain colour fields and data markers, never logos or livery.

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
