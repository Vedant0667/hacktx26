# AGENTS.md

HackTX 2026 hackathon project. Planning docs (`docs/`, `PRODUCT.md`, `tasks/`, `ideas.md`) are local-only and not committed.

## Commands
- `npm run dev`: local dev at http://localhost:3000 (mic works on the laptop only).
- `npm run dev:lan`: HTTPS dev on the LAN with a self-signed cert, so phones on the same Wi-Fi can use the mic. Open the host screen at https://<laptop LAN IP>:3000 so the QR code points phones there; phones must accept the certificate warning once.
- `.claude/verify.sh`: the gate (tsc, eslint, engine tests). Hermetic, ~3 s.
- `node --env-file=.env.local scripts/migrate.mjs`: apply db/schema.sql to Neon.
- `node --env-file=.env.local scripts/seed-db.mjs`: race data ingest. Runs `python3 engine/build.py` (data/ = cached Jolpica + OpenF1 + hand-entered facts -> build/race-data/, gitignored), then upserts races, race_laps, decision_points and decision_drivers and prints row counts. Idempotent; `--skip-build` reuses the last build. Run after migrate and after any change to data/ or engine/.
- `npx tsx scripts/test-data.ts`: hermetic data checks (race_laps rebuild the frames, the TypeScript call-moment port matches build.py, blind columns hold no answer, per-driver answers).
- Muse spend: GET /api/muse/usage; cap via MUSE_BUDGET_USD (default 5).

## Conventions
- Read `docs/` before making scope decisions; the judging criteria and submission rules live there.
- Race data is read only from Postgres through lib/data.ts. Blind loaders (`getIndex`, `getBlindDecision`, `getBlindFrames`, `getBlindDrivers`) serve GET /api/decisions/**; anything with the answer (`getDecision`, `getFrames`, `getGroundTruth`, `getDriverAnswers`) is for scoring and GET /api/lobby/[code]/reveal only. docs/audits/security-contract.md (Rounds 3 and 4) is the contract. Do not bring back public/data or server-data.

## Next.js notes (from create-next-app)
<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
