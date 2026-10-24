#!/usr/bin/env bash
# Hermetic gate (no network, no DB): types, lint, engine tests.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsc --noEmit
npx eslint . --max-warnings=0
python3 engine/test_engine.py
