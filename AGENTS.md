# AGENTS.md

HackTX 2026 hackathon project. Reference docs live in `docs/`; ideas in `ideas.md`; plan in `tasks/todo.md`.

## Commands
- `npm run dev`: local dev at http://localhost:3000 (mic works on the laptop only).
- `npm run dev:lan`: HTTPS dev on the LAN with a self-signed cert, so phones on the same Wi-Fi can use the mic. Open the host screen at https://<laptop LAN IP>:3000 so the QR code points phones there; phones must accept the certificate warning once.
- `.claude/verify.sh`: the gate (tsc, eslint, engine tests). Hermetic, ~3 s.
- `python3 engine/build.py`: rebuild public/data from data/ (Jolpica + OpenF1 + manual).
- `node --env-file=.env.local scripts/migrate.mjs`: apply db/schema.sql to Neon.
- Muse spend: GET /api/muse/usage; cap via MUSE_BUDGET_USD (default 5).

## Conventions
- Read `docs/` before making scope decisions; the judging criteria and submission rules live there.

## Next.js notes (from create-next-app)
<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
