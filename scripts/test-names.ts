// Hermetic checks for nickname rules and public leaderboard row shaping. Run: npx tsx scripts/test-names.ts
import assert from "node:assert/strict";
import { checkName, shapeMomentDetail } from "../lib/names";

const teams = ["McLaren", "Red Bull Racing", "Ferrari"];
const ok = (raw: string) => {
  const r = checkName(raw, teams);
  assert.ok(r.ok, `expected "${raw}" to pass, got ${JSON.stringify(r)}`);
  return r.name;
};
const bad = (raw: string, reason?: string) => {
  const r = checkName(raw, teams);
  assert.ok(!r.ok, `expected "${raw}" to be rejected`);
  if (reason && !r.ok) assert.equal(r.reason, reason, `"${raw}"`);
};

// Ordinary names, normalised
assert.equal(ok("Zoë"), "Zoë");
assert.equal(ok("Zoë"), "Zoë"); // NFD composes under NFKC
assert.equal(ok("José María"), "José María");
// Real names that contain a listed word pass; the plain word still fails.
for (const real of ["Dikshit", "Shitij", "Analise", "Cumming", "Cummings"]) assert.equal(ok(real), real, `${real} rejected`);
assert.equal(checkName("shit").ok, false);
assert.equal(ok("  Max   Power \t"), "Max Power");
assert.equal(ok("Ｓａｍ"), "Sam"); // full-width
assert.equal(ok("山田 太郎"), "山田 太郎");
assert.equal(ok("McLaren fan"), "McLaren fan"); // contains a team name: fine
assert.equal(ok("Scunthorpe"), "Scunthorpe");

// Length: 24 passes, 25 fails
assert.equal(ok("a".repeat(24)).length, 24);
bad("a".repeat(25), "length");
bad("   ", "empty");

// Control, zero-width, bidi
bad("Al​ice", "control"); // zero-width space
bad("Al‍ice", "control"); // zero-width joiner
bad("‮evil", "control"); // right-to-left override
bad("a⁦b⁩", "control"); // isolates
bad("a\u0007b", "control"); // bell
assert.equal(ok("﻿Alice"), "Alice"); // a BOM counts as whitespace in JS and is trimmed

// Zalgo
bad("Z̀́̂̃algo", "marks");
assert.equal(ok("é̂"), "é̂"); // two marks on one character is allowed

// Profanity, leet and spacing variants (built from fragments so no word sits in the repo)
const word = ["f", "u", "c", "k"].join("");
bad(word, "profanity");
bad(word.toUpperCase(), "profanity");
bad(["f", "u", "c", "k"].join(" "), "profanity");
bad(["f", "4", "c", "k"].join(""), "profanity");
bad(["f", "u", "u", "c", "k"].join(""), "profanity");
bad(["s", "h", "1", "t"].join(""), "profanity");

// Reserved names, case-insensitive, after normalisation
for (const n of ["Engine", "ENGINE", "host", "Admin", "OutPace", "muse", "Race Control", "race   control", "Ｅｎｇｉｎｅ", "H.O.S.T."]) bad(n, "reserved");
for (const n of ["McLaren", "mclaren", "RED BULL RACING", "Ferrari"]) bad(n, "reserved");
ok("Engineer");
ok("Hostess");
ok("Host 2");

// Leaderboard rows: other lobbies' rows carry no call, reasons or scores
const row = { call: "pit" as const, reasons: ["old tyres"], factors_named: ["tyre_age"], verdict: "Good", score_call: 40, score_reasoning: 30 };
const empty = { call: null, reasons: [], factors_named: [], verdict: null, score_call: null, score_reasoning: null };
assert.deepEqual(shapeMomentDetail(true, true, row), { ...row });
assert.deepEqual(shapeMomentDetail(false, true, row), empty); // other lobby, viewer revealed
assert.deepEqual(shapeMomentDetail(true, false, row), empty); // own lobby not revealed
assert.deepEqual(shapeMomentDetail(false, false, row), empty);
assert.equal(shapeMomentDetail(true, true, { ...row, verdict: undefined }).verdict, null);

console.log("test-names: ok");
