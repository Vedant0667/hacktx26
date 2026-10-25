#!/usr/bin/env bash
# Hermetic gate (no network, no DB): types, lint, engine tests.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsc --noEmit
npx eslint . --max-warnings=0
python3 engine/test_engine.py
python3 engine/test_triggers.py
npx tsx scripts/test-gate.ts
npx tsx scripts/test-security.ts
npx tsx scripts/test-scoring.ts
npx tsx scripts/test-data.ts
npx tsx scripts/test-race.ts
npx tsx scripts/test-luck.ts
npx tsx lib/client/race.check.ts
npx tsx scripts/test-voice.ts
npx tsx lib/tracks.check.ts
npx tsx scripts/test-names.ts
