// Hermetic checks for Round 9, luck-aware verdicts (no network, no DB). Run: npx tsx scripts/test-luck.ts
// Luck events on the cached races (from engine/build.py's build/race-data/load.json, built here when missing), the
// verdict rules in lib/luck.ts (no flip without luck, grounding), the merge in lib/data.ts, scoring with
// final_right_call, and that nothing about luck is served before the end of a game.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { freezeReveal } from "../app/api/_lib/race";
import { driverFullWithVerdict, freezeFullWithVerdict, type FullFreeze, type RaceFreeze } from "../lib/data";
import { applyVerdict, luckView, verdictInput, verdictProblems, type LuckEvent, type StoredVerdict } from "../lib/luck";
import { rightCallOf, scoreCall, stakesFor } from "../lib/scoring";

const root = path.resolve(__dirname, "..");
const out = path.join(root, "build/race-data");
if (!existsSync(path.join(out, "load.json"))) execFileSync("python3", ["engine/build.py"], { cwd: root, stdio: "ignore" });
type Full = FullFreeze & { luck_events: LuckEvent[]; luck_facts?: { call: unknown; after_call: unknown; measured: unknown } };
const load = JSON.parse(readFileSync(path.join(out, "load.json"), "utf8")) as {
  race_freezes: (RaceFreeze & { race_key: string; full: Full })[];
  decision_points: { id: string; blind: Record<string, unknown>; full: Record<string, unknown>; drivers: { code: string; scorable: boolean; blind: Record<string, unknown>; full: Record<string, unknown> & { luck_events: LuckEvent[] } }[] }[];
};
const src = (p: string) => readFileSync(path.join(root, p), "utf8");

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}\n`, err);
  }
}

const VSC39: LuckEvent[] = [{ lap: 39, kind: "VSC" }];
const verdict = (v: Partial<StoredVerdict>): StoredVerdict => ({
  status: "accepted", measured_correct: "BOX", luck_events: VSC39, final_right_call: "STAY", luck_changed_outcome: true,
  explanation: "the lap 39 VSC gave the cars that stayed out a cheaper stop", ...v,
});

test("luck events on known laps (Qatar SC lap 7, Singapore VSC lap 39)", () => {
  const fz = load.race_freezes;
  assert.ok(fz.every((f) => Array.isArray(f.full.luck_events)), "every freeze carries luck_events");
  assert.equal(fz.filter((f) => f.race_key === "2025-qatar" && f.full.luck_events.length).length, 0, "Qatar: the only SC (lap 7) is the lap-7 freezes' own trigger");
  const lec = fz.find((f) => f.race_key === "2026-singapore" && f.driver_code === "LEC" && f.lap === 24)!;
  assert.deepEqual(lec.full.luck_events, VSC39);
  const lucky = fz.filter((f) => f.full.luck_events.length);
  assert.ok(lucky.every((f) => f.race_key === "2026-singapore" && f.lap < 39 && f.full.luck_events.every((e) => e.kind === "VSC" && e.lap === 39)));
  // A freeze measured to before lap 39, or at the lap-39 VSC itself, has no luck.
  for (const f of fz.filter((x) => x.race_key === "2026-singapore")) {
    const end = Math.max(f.full.window[1], Number((f.full.detail as { end_lap?: number }).end_lap ?? 0));
    assert.equal(f.full.luck_events.length > 0, f.lap < 39 && end >= 39, `${f.driver_code} L${f.lap}`);
  }
  assert.ok(lucky.length > 0 && lucky.length <= 40, `expected at most ~40 Muse rows, got ${lucky.length}`);
  for (const f of lucky) assert.ok(f.full.luck_facts, `${f.driver_code} L${f.lap} has facts for the prompt`);
  // Moment decisions: their own SC/VSC on the call lap is not luck, and nothing else happens before the end.
  for (const d of load.decision_points) for (const x of d.drivers) assert.deepEqual(x.full.luck_events, [], `${d.id} ${x.code}`);
});

test("applyVerdict: measured unless an accepted, current verdict; never flips without luck", () => {
  const none = applyVerdict("BOX", VSC39, null);
  assert.deepEqual(none, { final_right_call: "BOX", luck: false, luck_events: VSC39, explanation: null, verdict_source: "measured" });
  const flip = applyVerdict("BOX", VSC39, verdict({}));
  assert.equal(flip.final_right_call, "STAY");
  assert.equal(flip.luck, true);
  assert.equal(flip.verdict_source, "ai");
  assert.match(flip.explanation!, /lap 39 VSC/);
  assert.equal(applyVerdict("BOX", VSC39, verdict({ luck_changed_outcome: false })).final_right_call, "BOX", "flip without luck");
  assert.equal(applyVerdict("BOX", VSC39, verdict({ status: "rejected" })).final_right_call, "BOX");
  assert.equal(applyVerdict("BOX", VSC39, verdict({ status: "no_answer" })).final_right_call, "BOX");
  assert.equal(applyVerdict("STAY", VSC39, verdict({ measured_correct: "BOX" })).verdict_source, "measured", "stale: measured changed");
  assert.equal(applyVerdict("BOX", [{ lap: 40, kind: "VSC" }], verdict({})).verdict_source, "measured", "stale: events changed");
  assert.equal(applyVerdict("BOX", [], verdict({})).verdict_source, "measured", "no luck events: no verdict");
  const agree = applyVerdict("BOX", VSC39, verdict({ final_right_call: "BOX", luck_changed_outcome: false, explanation: "the BOX group led before the lap 39 VSC" }));
  assert.equal(agree.final_right_call, "BOX");
  assert.equal(agree.luck, false);
  assert.equal(agree.verdict_source, "ai");
});

test("verdictProblems: reject disagreement without luck, and ungrounded explanations", () => {
  const lec = load.race_freezes.find((f) => f.race_key === "2026-singapore" && f.driver_code === "LEC" && f.lap === 24)!;
  const input = verdictInput(lec.full.luck_facts!);
  const measured = lec.full.correct;
  const other = measured === "BOX" ? "STAY" : "BOX";
  const good = { right_call: other, luck_changed_outcome: true, explanation: "the lap 39 VSC gave LEC and RUS a cheaper stop" } as const;
  assert.deepEqual(verdictProblems(good, input, measured), []);
  assert.deepEqual(verdictProblems({ ...good, right_call: measured, luck_changed_outcome: false }, input, measured), []);
  assert.ok(verdictProblems({ ...good, luck_changed_outcome: false }, input, measured).some((p) => p.includes("disagrees")));
  assert.ok(verdictProblems({ ...good, explanation: "the lap 41 VSC gave LEC a cheaper stop" }, input, measured).some((p) => p.includes("number 41")));
  assert.ok(verdictProblems({ ...good, explanation: "the lap 39 VSC gave HAM a cheaper stop" }, input, measured).some((p) => p.includes("car HAM")));
  assert.ok(verdictProblems({ ...good, explanation: "the lap 39 red flag gave everyone a free stop" }, input, measured).some((p) => p.includes("red flag")));
  assert.ok(verdictProblems({ ...good, explanation: "rain on lap 39 helped the cars that stayed out" }, input, measured).some((p) => p.includes("rain")));
  assert.ok(verdictProblems({ ...good, explanation: "the lap 39 safety car helped LEC" }, input, measured).some((p) => p.includes("safety car")));
  assert.ok(verdictProblems({ ...good, explanation: "the lap 39 VSC helped LEC onto hards" }, input, measured).some((p) => p.includes("compound hard")));
  assert.ok(verdictProblems({ ...good, explanation: "word ".repeat(21).trim() }, input, measured).some((p) => p.includes("over 20 words")));
  assert.ok(verdictProblems({ ...good, explanation: "the lap 39 VSC — a cheap stop" }, input, measured).includes("explanation punctuation"));
  assert.ok(verdictProblems({ ...good, explanation: "  " }, input, measured).includes("explanation empty"));
  // The prompt input holds only call-moment facts, the post-call events and the measured result.
  assert.deepEqual(Object.keys(JSON.parse(input)), ["at_the_call", "after_the_call", "measured"]);
});

test("data merge: final_right_call on full rows, prompt facts never kept", () => {
  const lec = load.race_freezes.find((f) => f.race_key === "2026-singapore" && f.driver_code === "LEC" && f.lap === 24)!;
  const merged = freezeFullWithVerdict(lec.full, verdict({ measured_correct: lec.full.correct, final_right_call: lec.full.correct === "BOX" ? "STAY" : "BOX" }));
  assert.ok(!("luck_facts" in merged));
  assert.notEqual(merged.final_right_call, merged.correct);
  assert.equal(merged.swing_s, lec.full.swing_s, "stakes keep the measured swing");
  const plain = freezeFullWithVerdict(load.race_freezes.find((f) => f.race_key === "2025-qatar")!.full, null);
  assert.equal(plain.final_right_call, plain.correct);
  assert.equal(plain.explanation, null);
  const dd = load.decision_points[0].drivers.find((x) => x.scorable)!;
  const d = driverFullWithVerdict(dd.full as never, null);
  assert.ok(!("luck_facts" in d) && !("luck_events" in d), "driver luck fields live under ground_truth");
  assert.equal(d.ground_truth.final_right_call, d.ground_truth.correct);
  assert.deepEqual(d.ground_truth.luck_events, []);
});

test("scoring uses final_right_call; stakes from the measured swing", () => {
  const measured = { ground_truth: { correct: "BOX" as const, swing_s: 16.5 } };
  const flipped = { ground_truth: { correct: "BOX" as const, swing_s: 16.5, final_right_call: "STAY" as const } };
  assert.equal(rightCallOf(measured.ground_truth), "BOX");
  assert.equal(rightCallOf(flipped.ground_truth), "STAY");
  const a = scoreCall(flipped, "STAY", 30);
  const b = scoreCall(measured, "STAY", 30);
  assert.equal(a.score_call, stakesFor(16.5));
  assert.equal(a.score_call, b.score_call, "same stakes");
  assert.ok(a.total > b.total, "the luck-aware right call earns the right-call share");
  assert.ok(scoreCall(flipped, "BOX", 30).total < a.total);
  // grading.ts scores every moment and race call through rightCallOf / atFlag, never the bare measured answer.
  const g = src("app/api/_lib/grading.ts");
  assert.ok(!/pointsFor\([^)]*ground_truth\.correct/.test(g), "grading.ts scores against ground_truth.correct");
  assert.ok(!/freezeRubric\([^,]+, (f|freeze),/.test(g), "grading.ts builds a race rubric without atFlag");
  assert.ok(/right: [^,]*=== mc\.correct/.test(g) === false, "race summary marks right against the measured call");
});

test("no luck before the end of the game", () => {
  for (const f of load.race_freezes) assert.ok(!Object.keys(f.blind).some((k) => /luck|explanation|final/.test(k)), `${f.driver_code} L${f.lap} blind`);
  for (const d of load.decision_points) {
    assert.ok(!Object.keys(d.blind).some((k) => /luck|explanation|final/.test(k)), `${d.id} blind`);
    for (const x of d.drivers) assert.ok(!Object.keys(x.blind).some((k) => /luck|explanation|final/.test(k)), `${d.id} ${x.code} blind`);
  }
  // The freeze view has an explicit field list: luck fields are added only by the race reveal at done.
  const lec = load.race_freezes.find((f) => f.race_key === "2026-singapore" && f.driver_code === "LEC" && f.lap === 24)!;
  const full = freezeFullWithVerdict(lec.full, verdict({ measured_correct: lec.full.correct }));
  const view = freezeReveal({ blind: lec.blind, full }) as Record<string, unknown>;
  for (const k of ["final_right_call", "luck", "luck_events", "explanation", "verdict_source", "luck_facts"]) assert.ok(!(k in view), `freezeReveal leaks ${k}`);
  const route = src("app/api/lobby/[code]/race/reveal/route.ts");
  assert.match(route, /drivers\[car\] = atEnd \? \{ \.\.\.view, \.\.\.luckView\(row\.full\) \} : view;/);
  assert.match(route, /revealEntry\(entry, cars, freezes, false, done\)/);
  assert.match(route, /const done = meta\.phase === "done";/);
  // Blind loaders and the freeze route never read ai_verdicts or full.
  const data = src("lib/data.ts");
  for (const fn of ["getBlindDecision", "getBlindFrames", "getBlindDrivers", "getRaceList"]) {
    const body = data.slice(data.indexOf(`export async function ${fn}`)).split("\n}\n")[0];
    assert.ok(!/ai_verdicts|VERDICT_JSON|"full"/.test(body), `${fn} reads answer data`);
  }
  assert.match(src("app/api/lobby/[code]/race/freeze/route.ts"), /drivers\[car\] = row \? row\.blind : null;/);
  // luckView fills every field for the end screen.
  assert.deepEqual(luckView({ correct: "STAY" }), { final_right_call: "STAY", luck: false, luck_events: [], explanation: null, verdict_source: "measured" });
});

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
