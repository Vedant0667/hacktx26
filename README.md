# OutpaceF1

OutpaceF1 is a party game for F1 race nights. Friends watch together on one big screen, and at each strategy moment everyone calls box or stay out from their phone and says why. Calls are scored at the flag against what actually happened, and Meta's Muse Spark grades the reasoning.

Live timing isn't built yet. For the demo, the game replays a real past race (the 2025 Qatar Grand Prix or the 2026 Singapore Grand Prix) through the same flow.

Built at HackTX 2026 (October 24–25, 2026). Everything in this repository was written during the event.

## How a game works

1. The host opens a lobby on a laptop or TV and picks a race. Players scan the QR code and join on their phones with a nickname. The host picks one driver for everyone, or lets each player pick their own; several players can follow the same driver.
2. The race replays lap by lap. The host screen shows the real circuit outline with every car placed from its gap, a timing tower with tyre compound and age, and each followed car's gaps to the cars ahead and behind with their trend.
3. The replay freezes at decision moments: a safety car or VSC, a rival stopping nearby, an undercut window, tyres fading, the tyre window, or rain. Each player has 40 seconds to call BOX or STAY OUT and record a voice note of up to 30 seconds (tap to start, tap to stop) or type why. The map marks where a stop would put the car back on track. Between freezes, any player can call "box now" on their own.
4. At the flag, the host steps through each moment: the right call, how much it was worth, and every player's call, reasoning score, points and Muse Spark's one-line verdict on their reason. A podium follows. Each phone shows the player's own result, with everyone's calls one tap away.

A quick single-moment mode (the lap 7 safety car in Qatar, or the lap 39 VSC in Singapore) uses the same end screens. The host screen has a Simple view and an Advanced view with the undercut clock, intervals, pit loss and stint data. The original layout is still available with `?ui=classic`.

## How a call is scored

- **The right answer** comes from the race itself. For each driver we take the cars within three places that made the other call, then compare how the gap changed once all of them had made their next stop. The call whose cars gained time is correct. For Piastri at Qatar, boxing was worth 15.6 s.
- **Luck is handled separately.** When a safety car, VSC, red flag or rain after the call changed the result, a Muse Spark verdict precomputed from the facts known at the call decides what was right, and the end screen says why.
- **Points:** stakes = how much the call was worth (swing seconds × 5, up to 100). A call scores stakes × (0.37 if right + 0.78 × reasoning/50 − 0.15). Reasoning counts for more than the call: a wrong call argued well beats a right call with no reason.
- **Reasoning** is graded out of 50 by Muse Spark against the facts of that moment (tyre age and stops still owed, the cheaper stop under a safety car, what similar cars did, track position). Credit has to be grounded in what the player actually said, and talking to the grader earns nothing. It's a party game, so a real attempt earns something and scores centre around 25.
- **Our engine is just another player.** It is scored with the same formula and never decides the right answer. The real team's call is scored the same way.
- **No hindsight.** During the game, players see only what a pit wall could see at the moment of the call. Answers and scores stay on the server until the end.

## AI used

We built OutpaceF1 with AI coding tools and say so everywhere, including in every commit's co-author line.

- **Building the project:** Claude Code (Anthropic) wrote most of the code, research notes and documents in this repository, directed and reviewed by the team. OpenAI Codex ran some of the code reviews.
- **Inside the product:**
  - Meta Muse Voice Transcribe (`muse-voice-transcribe-1.0`) turns each voice note into text. If it's unavailable, the browser's own speech recognition is used (in Chrome that sends audio to Google).
  - Meta Muse Spark (`muse-spark-1.3`, falling back to `muse-spark-1.2`) grades each reason out of 50 at the end of the game, writes the one-line verdict shown on the reveal, and decides the right call for moments where luck changed the result.
  - When Muse is unavailable or a spend cap is reached, the game grades with a keyword rubric instead.
- **Not AI:** the engine's pit calls, the measured right answers and the points arithmetic are plain Python and TypeScript over lap data.

## Data

- Lap times, positions and pit stops: [Jolpica F1 API](https://api.jolpi.ca/ergast/f1/) (the Ergast successor).
- Tyre stints, race control, intervals and car locations: [OpenF1](https://openf1.org/).
- Circuit outlines for Lusail and Marina Bay: [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT), projected to SVG in `lib/tracks.ts`.
- A few hand-entered facts, each with a source URL, in `data/manual/`.

The data is cached in `data/`, built by `engine/build.py`, and loaded into Postgres (`races`, `race_laps`, `decision_points`, `decision_drivers`) by `scripts/seed-db.mjs`. The app reads it only from Postgres, through `lib/data.ts`.

OutpaceF1 is a fan project with no affiliation to Formula 1, the FIA or any team. Team colours appear only as plain colour fields and data markers, never logos or livery.

## Stack

- Next.js 16 (App Router) and React 19, Tailwind CSS 4
- Neon Postgres via `@neondatabase/serverless`
- Python 3 for the data build and the engine (`engine/`)
- Hosted on Vercel, with the Vercel Firewall in front of the API

## Run it locally

Requirements: Node 20 or later, Python 3 (tested on 3.13), a Postgres database (Neon works).

```bash
npm install
cp .env.example .env.local       # fill in DATABASE_URL, SITE_PASSWORD and CRON_SECRET; MODEL_API_KEY is optional
node --env-file=.env.local scripts/migrate.mjs
node --env-file=.env.local scripts/seed-db.mjs
npm run dev:lan                   # HTTPS on your Wi-Fi so phones can use the mic
```

Open the host screen at `https://<your laptop's LAN IP>:3000`, enter the password from `SITE_PASSWORD`, and create a lobby. Phones on the same Wi-Fi join with the QR code and accept the self-signed certificate once. Without `MODEL_API_KEY`, reasoning is graded by the keyword rubric.

Checks:

- `.claude/verify.sh` is the hermetic gate (no network, no database): type-check, lint, engine and trigger tests, and the gate, security, scoring, data, race, luck, voice, track, nickname and spend tests.
- `scripts/e2e/game.mjs` plays a full race game and a quick moment with a host page and two phones in headless Chrome. `scripts/e2e/room.mjs` plays a race with 6 to 12 phones, including a kick and a "box now" call. Both check the database, Muse grading, the console and the layout, so they need a running server, a database and `puppeteer-core` (pass its path with `--puppeteer`). Usage is at the top of each file.

## Security and privacy

- **Answers stay secret.** Hosts and players get random 192-bit tokens on create and join; only their hashes are stored. Every route that could reveal an answer checks the token, and an unknown lobby code gets the same refusal as a wrong token.
- **Spend is capped.** Every Muse call reserves its worst-case cost first. Calls stop at a lifetime budget, at $4 an hour across the site, and at $2 an hour per lobby creator. Each race lobby gets up to 80 grading calls (30 for a quick moment) and 150 voice clips. Past a cap, the game falls back as described above.
- **Rate limits** are counted in Postgres per IP: 30 lobbies an hour; 2,400 requests a minute per lobby, so several rooms can share one venue's Wi-Fi; 30 joins under new names per lobby every 10 minutes; and 20 lookups of codes that don't exist every 10 minutes. Request bodies are capped at 16 KB. Firewall rules on Vercel add per-IP limits at the edge.
- **Nicknames** are normalised and checked before they reach a shared screen: no invisible, control or direction-changing characters, no stacked accents, no profanity (including spelled-out and look-alike spellings), and no names that impersonate the engine or a team.
- **Privacy.** Joining requires consent to show your nickname and reasons to the room and on the public leaderboard, and to send reasons to Meta's Muse AI and voice notes to Meta's speech service. Audio is never stored. A daily job deletes lobbies, names, calls and rate-limit rows (which hold IP addresses) once they are more than a day old, so nothing stays longer than about two days. The public leaderboard shows other lobbies' names and totals only, never their reasons.
- **Optional password gate.** `SITE_PASSWORD` puts the whole site behind a shared password; `SITE_GATE=off` runs it open. Security headers (a strict Content Security Policy, HSTS, no framing, microphone for this site only) apply either way.
- The code went through five rounds of security review, including one for running without the password, and every finding was fixed or accepted in writing.

## Repository map

| Path | What it holds |
|---|---|
| `app/`, `components/`, `lib/client/` | Screens for the host, phone, leaderboard and gate; `components/rn/` is the Race Night look |
| `app/api/` | Lobby, join, submit, transcribe, reveal, leaderboard and data routes, with shared auth and rate limits in `app/api/_lib/` |
| `lib/db/`, `db/schema.sql` | Postgres queries and schema |
| `lib/muse/` | Muse Spark and Voice Transcribe clients, grading prompts, rubric and spend caps |
| `lib/tracks.ts`, `lib/names.ts` | Circuit outlines and car placement; nickname checks |
| `engine/` | Data build, engine, ground truth and race-mode trigger detection, with tests |
| `scripts/` | Migrate, seed and test scripts; `scripts/e2e/` holds the browser tests |

## Open source used

Next.js, React, Tailwind CSS, `@neondatabase/serverless`, zod, qrcode, obscenity, ESLint and TypeScript, each under its own license; `puppeteer-core` for the browser tests. Fonts (Saira, Saira Condensed, Schibsted Grotesk) come from Google Fonts through `next/font`.

Circuit outlines: bacinger/f1-circuits, Copyright (c) 2019-2025 Tomislav Bacinger, MIT License.
