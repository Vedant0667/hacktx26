// Hermetic checks for the Muse spend caps (docs/audits/public-launch.md P1, P7, P9): env parsing, which per-lobby
// cap a call counts against, the grading order, the skip log, and source checks on the reservation and the routes.
// No network, no DB. Run: npx tsx scripts/test-spend.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { freezesFirst } from "../app/api/_lib/grading";
import { capGroupOf, envNumber, lobbyCallCap, lobbyCallCaps, logBudgetSkip, museBudgetUsd, museCreatorHourlyUsd, museHourlyUsd } from "../lib/muse/client";

const root = path.resolve(__dirname, "..");
const src = (p: string) => readFileSync(path.join(root, p), "utf8");

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Env parsing: unset, empty, junk and negative fall back; 0 is a real value (it turns that cap off entirely).
assert.equal(envNumber(undefined, 4), 4);
assert.equal(envNumber("", 4), 4);
assert.equal(envNumber("  ", 4), 4);
assert.equal(envNumber("abc", 4), 4);
assert.equal(envNumber("-1", 4), 4);
assert.equal(envNumber("Infinity", 4), 4);
assert.equal(envNumber("0", 4), 0);
assert.equal(envNumber("2.5", 4), 2.5);

withEnv({ MUSE_BUDGET_USD: undefined, MUSE_HOURLY_USD: undefined, MUSE_CREATOR_HOURLY_USD: undefined }, () => {
  assert.equal(museBudgetUsd(), 5);
  assert.equal(museHourlyUsd(), 4);
  assert.equal(museCreatorHourlyUsd(), 2);
});
withEnv({ MUSE_BUDGET_USD: "15", MUSE_HOURLY_USD: "1.5", MUSE_CREATOR_HOURLY_USD: "0.5" }, () => {
  assert.equal(museBudgetUsd(), 15);
  assert.equal(museHourlyUsd(), 1.5);
  assert.equal(museCreatorHourlyUsd(), 0.5);
});
withEnv({ MUSE_HOURLY_USD: "nope", MUSE_CREATOR_HOURLY_USD: "-3" }, () => {
  assert.equal(museHourlyUsd(), 4);
  assert.equal(museCreatorHourlyUsd(), 2);
});

// Per-lobby caps: grading 80 (race) / 30 (moment), voice 150 either way, each overridable, whole calls only.
assert.equal(capGroupOf("grade_call"), "grading");
assert.equal(capGroupOf("grade_benchmark"), "grading");
assert.equal(capGroupOf("transcribe"), "transcribe");
assert.deepEqual(lobbyCallCaps("grade_call", {}), { group: "grading", race: 80, moment: 30 });
assert.deepEqual(lobbyCallCaps("transcribe", {}), { group: "transcribe", race: 150, moment: 150 });
assert.equal(lobbyCallCap("grade_call", "race", {}), 80);
assert.equal(lobbyCallCap("grade_call", "moment", {}), 30);
assert.equal(lobbyCallCap("transcribe", "race", {}), 150);
assert.equal(lobbyCallCap("transcribe", "moment", {}), 150);
const env = { MUSE_LOBBY_MAX_CALLS_RACE: "40", MUSE_LOBBY_MAX_CALLS_MOMENT: "12.9", MUSE_LOBBY_MAX_CLIPS: "60" };
assert.equal(lobbyCallCap("grade_call", "race", env), 40);
assert.equal(lobbyCallCap("grade_call", "moment", env), 12);
assert.equal(lobbyCallCap("transcribe", "race", env), 60);
// The grading override never moves the voice cap, and the voice override never moves grading.
assert.equal(lobbyCallCap("transcribe", "moment", { MUSE_LOBBY_MAX_CALLS_MOMENT: "1" }), 150);
assert.equal(lobbyCallCap("grade_call", "race", { MUSE_LOBBY_MAX_CLIPS: "1" }), 80);

// Grading order: freezes before audibles, order kept within each.
const calls = [
  { kind: "audible" as const, id: 1 },
  { kind: "freeze" as const, id: 2 },
  { kind: "audible" as const, id: 3 },
  { kind: "freeze" as const, id: 4 },
];
const [fz, au] = freezesFirst(calls);
assert.deepEqual(fz.map((c) => c.id), [2, 4]);
assert.deepEqual(au.map((c) => c.id), [1, 3]);
assert.deepEqual(freezesFirst([]), [[], []]);
// ensureRaceGraded awaits every freeze call before any audible is graded.
const grading = src("app/api/_lib/grading.ts");
const race = grading.slice(grading.indexOf("export async function ensureRaceGraded"));
const wave1 = race.indexOf("await Promise.all([...freezeCalls.map(gradeCall)");
const wave2 = race.indexOf("await Promise.all(audibles.map(gradeCall))");
assert.ok(wave1 > 0 && wave2 > wave1, "race grading must finish freeze calls before audibles");
assert.ok(/purpose: "grade_call", lobbyCode: code/.test(race), "audibles and freezes still go to Muse");

// Skip log: one warning per lobby per reason.
const warn = console.warn;
const lines: string[] = [];
console.warn = (...a: unknown[]) => void lines.push(a.join(" "));
try {
  assert.equal(logBudgetSkip("TEST", "grade_call", "lobby_cap"), true);
  for (let i = 0; i < 79; i++) assert.equal(logBudgetSkip("TEST", "grade_call", "lobby_cap"), false);
  assert.equal(logBudgetSkip("TEST", "grade_call", "hourly"), true);
  assert.equal(logBudgetSkip("TESU", "grade_call", "lobby_cap"), true);
  assert.equal(logBudgetSkip(null, "grade_benchmark", "lifetime"), true);
  assert.equal(logBudgetSkip(null, "grade_benchmark", "lifetime"), false);
} finally {
  console.warn = warn;
}
assert.equal(lines.length, 4);
assert.match(lines[0], /budget skip \(lobby_cap\) lobby=TEST purpose=grade_call/);

// The reservation: one statement under the advisory lock, every cap in the insert's condition.
const db = src("lib/db/index.ts");
const reserve = db.slice(db.indexOf("export async function reserveMuseCall"), db.indexOf("export async function finishMuseCall"));
assert.ok(reserve.includes("pg_advisory_xact_lock(4242)"));
assert.ok(/where lifetime_ok and hourly_ok and creator_ok and lobby_ok/.test(reserve));
assert.ok(/created_at > now\(\) - interval '1 hour'/.test(reserve));
assert.ok(/l\.creator_key = \(select creator_key from lobby\)/.test(reserve));
assert.ok(/purpose = 'transcribe' else purpose <> 'transcribe'/.test(reserve));
assert.ok(/\(select mode from lobby\) = 'race'/.test(reserve));
assert.ok(/return null;/.test(reserve), "a refused reservation still returns null");
const client = src("lib/muse/client.ts");
assert.ok(/onRefused: \(reason\) => logBudgetSkip\(/.test(client));

// Lobby create stores the creator key; schema has the column and indexes.
assert.ok(src("app/api/lobby/route.ts").includes("mode, raceKey, clientIp(req)))"),"POST /api/lobby must store creator_key");
const schema = src("db/schema.sql");
assert.ok(schema.includes("alter table lobbies add column if not exists creator_key text"));
assert.ok(/create index if not exists \w+ on muse_calls \(created_at\)/.test(schema));
assert.ok(/create index if not exists \w+ on lobbies \(creator_key\)/.test(schema));
// scripts/migrate.mjs splits on ";", so the new block must not carry one inside a comment.
const tail = schema.slice(schema.indexOf("Public launch (docs/audits/public-launch.md P1)"));
assert.ok(!tail.split("\n").some((l) => l.startsWith("--") && l.includes(";")), "a ';' in a schema comment breaks migrate.mjs");

// P7: the spend endpoint needs the cron bearer.
const usage = src("app/api/muse/usage/route.ts");
assert.ok(usage.indexOf("cronAuthorized(request.headers.get(\"authorization\"))") >= 0);
assert.ok(usage.indexOf("cronAuthorized(") < usage.indexOf("getMuseSpend()"), "auth before the spend read");
assert.ok(/status: 401/.test(usage));

console.log("test-spend: all checks passed");
