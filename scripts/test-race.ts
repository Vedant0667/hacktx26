// Hermetic checks for race mode (no network, no DB). Run: npx tsx scripts/test-race.ts
// Pure rules from app/api/_lib/race.ts, run against the rows engine/build.py writes to build/race-data/load.json
// (built here when missing): freeze union, no lookahead at a freeze, audible rate limit and scoring, phase loop.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  AUDIBLE_GAP_LAPS,
  audibleAllowed,
  buildFreezePlan,
  framesFor,
  freezeReveal,
  minRaceSeconds,
  nextRacePhase,
  presentCall,
  RACE_LAP_S,
  revealedLaps,
  scoreAudible,
  segment,
  visibleLap,
  type RaceClock,
  type RacePhase,
} from "../app/api/_lib/race";
import { raceStateFor } from "../app/api/_lib/redact";
import { rowsToFrames, type AudibleTruth, type RaceFreeze } from "../lib/data";
import { CALL_WINDOW_S, pointsFor, stakesFor } from "../lib/scoring";

const root = path.resolve(__dirname, "..");
const loadPath = path.join(root, "build/race-data/load.json");
if (!existsSync(loadPath)) execFileSync("python3", ["engine/build.py"], { cwd: root, stdio: "ignore" });
interface Load {
  race_laps: (Parameters<typeof rowsToFrames>[0][number] & { race_key: string })[];
  race_freezes: (RaceFreeze & { race_key: string; triggers: string[] })[];
  race_audibles: { race_key: string; driver_code: string; lap: number; truth: AudibleTruth }[];
  race_drivers: { race_key: string; code: string; freeze_count: number }[];
}
const load = JSON.parse(readFileSync(loadPath, "utf8")) as Load;
let n = 0;
const test = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("ok", name);
};

const SG = "2026-singapore";
const freezesOf = (race: string) => load.race_freezes.filter((f) => f.race_key === race);
const framesOf = (race: string) => rowsToFrames(load.race_laps.filter((r) => r.race_key === race));

test("race-mode rows exist for both cached races, both answers present", () => {
  for (const race of ["2025-qatar", SG]) {
    const fz = freezesOf(race);
    assert.ok(fz.length > 0, race);
    assert.deepEqual(new Set(fz.map((f) => f.full.correct)), new Set(["BOX", "STAY"]), race);
    assert.ok(fz.every((f) => f.full.swing_s >= 2.0), race);
    assert.ok(load.race_drivers.some((d) => d.race_key === race && d.freeze_count >= 3), race);
  }
});

test("blind freeze rows hold no answer, team call or engine call", () => {
  const banned = ["correct", "swing_s", "team_call", "engine", "comparison", "detail", "window"];
  for (const f of load.race_freezes) {
    for (const k of banned) assert.ok(!(k in f.blind), `${f.race_key} ${f.driver_code} L${f.lap} blind has ${k}`);
    const text = JSON.stringify(f.blind).toLowerCase();
    assert.ok(!/\b(boxed|stayed out|correct|swing)\b/.test(text), `${f.driver_code} L${f.lap}: ${text}`);
    assert.equal(f.blind.lap, f.lap);
    assert.ok(f.blind.triggers.length > 0);
  }
});

test("freeze union: same car = its own freezes; choose merges a shared lap and drops one inside an earlier window", () => {
  const fz = freezesOf(SG);
  const lec = fz.filter((f) => f.driver_code === "LEC").map((f) => f.lap);
  assert.deepEqual(buildFreezePlan(fz, ["LEC"]).map((p) => p.lap), lec);
  const plan = buildFreezePlan(fz, ["LEC", "HAM"]);
  // Every entry's cars really have a freeze there, entries are strictly after the previous answer window.
  let horizon = 0;
  for (const p of plan) {
    assert.ok(p.lap > horizon, `lap ${p.lap} inside the previous window (to ${horizon})`);
    for (const d of p.drivers) {
      const f = fz.find((x) => x.lap === p.lap && x.driver_code === d);
      assert.ok(f, `${d} has no freeze at ${p.lap}`);
      horizon = Math.max(horizon, f.full.window[1]);
    }
  }
  const shared = lec.filter((l) => fz.some((f) => f.driver_code === "HAM" && f.lap === l));
  for (const l of shared) assert.deepEqual(plan.find((p) => p.lap === l)?.drivers.sort(), ["HAM", "LEC"]);
  // Synthetic: B at 21 falls in A's window [20, 22] and is dropped; B at 23 is kept; SC window [30, 35] drops 34.
  const mk = (driver_code: string, lap: number, w1: number) => ({ driver_code, lap, full: { window: [lap, w1] as [number, number] } }) as unknown as RaceFreeze;
  const syn = [mk("AAA", 20, 22), mk("BBB", 21, 23), mk("BBB", 23, 25), mk("AAA", 30, 35), mk("BBB", 34, 36), mk("BBB", 30, 32)];
  assert.deepEqual(buildFreezePlan(syn, ["AAA", "BBB"]), [
    { lap: 20, drivers: ["AAA"] },
    { lap: 23, drivers: ["BBB"] },
    { lap: 30, drivers: ["AAA", "BBB"] },
  ]);
  assert.deepEqual(buildFreezePlan(syn, ["CCC"]), []);
});

const clock = (phase: RacePhase, freeze_index: number, plan: { lap: number; drivers: string[] }[], elapsed: number, total = 62): RaceClock => ({
  phase, plan, freeze_index, total_laps: total, phase_elapsed_s: elapsed,
});

test("no lookahead at a freeze: frames stop at lap F-1 plus a call-moment frame with no stops shown", () => {
  const frames = framesOf(SG);
  const plan = buildFreezePlan(freezesOf(SG), ["LEC", "HAM"]);
  plan.forEach((p, i) => {
    for (const phase of ["freeze", "reveal_freeze"] as const) {
      const out = framesFor(frames, clock(phase, i, plan, 999), 1);
      assert.equal(out.length, p.lap, `${phase} ${p.lap}`);
      assert.ok(out.slice(0, -1).every((f) => f.lap < p.lap));
      const cm = out[out.length - 1];
      assert.equal(cm.lap, p.lap);
      assert.ok(cm.drivers.every((d) => !d.pitted_this_lap), "call-moment frame shows a stop on the freeze lap");
      const prev = frames[p.lap - 2];
      assert.deepEqual(cm.drivers.map((d) => [d.code, d.position, d.gap_to_leader_s]), prev.drivers.map((d) => [d.code, d.position, d.gap_to_leader_s]));
      assert.equal(visibleLap(clock(phase, i, plan, 999)), p.lap);
    }
  });
  // Freeze blind numbers match the end-of-previous-lap frame (position, tyre age is at least laps since the stop).
  for (const f of freezesOf(SG)) {
    const prev = frames[f.lap - 2].drivers.find((d) => d.code === f.driver_code)!;
    assert.equal(f.blind.position, prev.position, `${f.driver_code} L${f.lap}`);
    assert.ok(f.blind.tyre_age >= (prev.tyre_age ?? 0), `${f.driver_code} L${f.lap} tyre age`);
  }
});

test("replay clock: frames never pass the server lap; segments start at the last freeze lap", () => {
  const frames = framesOf(SG);
  const plan = [{ lap: 24, drivers: ["LEC"] }, { lap: 39, drivers: ["LEC", "HAM"] }];
  assert.deepEqual(segment({ plan, freeze_index: 0, total_laps: 62 }), { start: 1, end: 23 });
  assert.deepEqual(segment({ plan, freeze_index: 1, total_laps: 62 }), { start: 24, end: 38 });
  assert.deepEqual(segment({ plan, freeze_index: 2, total_laps: 62 }), { start: 39, end: 62 });
  for (const t of [0, 1.1, 1.2, 5, 27.5, 1000]) {
    const c = clock("replay", 0, plan, t);
    const v = visibleLap(c);
    assert.equal(v, Math.min(23, 1 + Math.floor(t / RACE_LAP_S)));
    const out = framesFor(frames, c, 1);
    assert.equal(out[out.length - 1].lap, v);
    assert.ok(out.every((f) => f.lap <= v));
  }
  assert.equal(visibleLap(clock("replay", 1, plan, 0)), 24);
  assert.deepEqual(framesFor(frames, clock("replay", 1, plan, 2.4), 24).map((f) => f.lap), [24, 25, 26]);
  assert.equal(framesFor(frames, clock("waiting", 0, plan, 99), 1).length, 0);
  assert.equal(framesFor(frames, clock("done", 2, plan, 0), 1).length, 62);
});

test("phase loop: waiting -> replay -> (freeze -> reveal_freeze -> replay)* -> done, with minimums", () => {
  const plan = [{ lap: 24, drivers: ["LEC"] }, { lap: 39, drivers: ["LEC", "HAM"] }];
  let phase: RacePhase = "waiting";
  let idx = 0;
  const seen: string[] = [phase];
  while (phase !== "done") {
    const next: RacePhase = nextRacePhase(phase, idx, plan.length)!;
    const c = clock(phase, idx, plan, 0);
    const min = minRaceSeconds(c, { needed: 2, called: 1 });
    if (phase === "replay") {
      const { start, end } = segment(c);
      assert.equal(min, Math.round((end - start + 1) * RACE_LAP_S * 10) / 10);
    }
    if (phase === "freeze") {
      assert.equal(min, CALL_WINDOW_S);
      assert.equal(minRaceSeconds(c, { needed: 2, called: 2 }), 0);
      assert.equal(minRaceSeconds(c, { needed: 0, called: 0 }), 0);
    }
    if (phase === "reveal_freeze") idx++;
    phase = next;
    seen.push(`${phase}${phase === "freeze" ? `@${plan[idx].lap}` : ""}`);
    assert.ok(seen.length < 20);
  }
  assert.deepEqual(seen, ["waiting", "replay", "freeze@24", "reveal_freeze", "replay", "freeze@39", "reveal_freeze", "replay", "done"]);
  assert.equal(nextRacePhase("done", 2, 2), null);
  assert.equal(nextRacePhase("replay", 0, 0), "done");
  // revealed laps follow the loop
  assert.deepEqual(revealedLaps(clock("freeze", 0, plan, 0)), []);
  assert.deepEqual(revealedLaps(clock("reveal_freeze", 0, plan, 0)), [24]);
  assert.deepEqual(revealedLaps(clock("replay", 1, plan, 0)), [24]);
  assert.deepEqual(revealedLaps(clock("freeze", 1, plan, 0)), [24]);
  assert.deepEqual(revealedLaps(clock("done", 2, plan, 0)), [24, 39]);
});

test("race state: segment_end_lap (the next freeze) only for the host; calls_needed only at a freeze", () => {
  const raw = { race_key: SG, name: "x", total_laps: 62, freeze_plan: [{ lap: 24, drivers: ["LEC"] }], freeze_index: 0, phase_elapsed_s: 3, called: ["A"] };
  const phone = raceStateFor(raw, "replay", false);
  const host = raceStateFor(raw, "replay", true);
  assert.equal(phone.segment_end_lap, null);
  assert.equal(host.segment_end_lap, 23);
  assert.equal(phone.freeze_lap, null);
  assert.equal(phone.calls_needed, null);
  assert.deepEqual(phone.called, []);
  assert.equal(phone.visible_lap, 1 + Math.floor(3 / RACE_LAP_S));
  const fz = raceStateFor(raw, "freeze", false);
  assert.equal(fz.freeze_lap, 24);
  assert.deepEqual(fz.calls_needed, ["LEC"]);
  assert.deepEqual(fz.called, ["A"]);
  const waiting = raceStateFor({ ...raw, freeze_plan: null }, "waiting", true);
  assert.equal(waiting.freeze_count, null);
  assert.equal(waiting.visible_lap, 0);
});

test("audible rate limit: one per player per 5 laps", () => {
  assert.deepEqual(audibleAllowed([], 10), { ok: true, next_lap: 10 + AUDIBLE_GAP_LAPS });
  assert.deepEqual(audibleAllowed([10], 12), { ok: false, next_lap: 15 });
  assert.deepEqual(audibleAllowed([10], 14), { ok: false, next_lap: 15 });
  assert.equal(audibleAllowed([10], 15).ok, true);
  assert.equal(audibleAllowed([10, 20], 17).ok, false);
  assert.equal(audibleAllowed([10, 20], 25).ok, true);
});

test("audible scoring: right BOX, wrong BOX, no split, cancelled near a freeze", () => {
  const rows = load.race_audibles.filter((a) => a.race_key === SG);
  const right = rows.find((a) => a.truth.scorable && a.truth.correct === "BOX")!;
  const wrong = rows.find((a) => a.truth.scorable && a.truth.correct === "STAY")!;
  const none = rows.find((a) => !a.truth.scorable)!;
  assert.ok(right && wrong && none, "fixtures");
  // Round 7: stakes from the audible's own swing; points = round(stakes × (0.40 × right + 0.75 × r/50 − 0.15)).
  const s1 = scoreAudible(right.lap, right.driver_code, [], right.truth, "box, the tyres are old and worn");
  assert.equal(s1.status, "scored");
  assert.equal(s1.score_call, stakesFor(right.truth.swing_s));
  assert.ok(s1.score_reasoning > 0 && s1.score_reasoning <= 50);
  assert.equal(s1.total, pointsFor("BOX", "BOX", s1.score_call, s1.score_reasoning));
  assert.ok(s1.verdict && s1.verdict.length > 0);
  const bare = scoreAudible(right.lap, right.driver_code, [], right.truth, "");
  assert.deepEqual([bare.score_reasoning, bare.total, bare.verdict], [0, pointsFor("BOX", "BOX", bare.score_call, 0), "No reason given."]);
  const s2 = scoreAudible(wrong.lap, wrong.driver_code, [], wrong.truth, "");
  assert.equal(s2.status, "scored");
  assert.ok(s2.total < 0, "a wrong box with no reason loses points");
  assert.equal(s2.total, pointsFor("BOX", "STAY", stakesFor(wrong.truth.swing_s), 0));
  const s3 = scoreAudible(none.lap, none.driver_code, [], none.truth, "box");
  assert.deepEqual([s3.status, s3.total], ["unscored", 0]);
  assert.equal(scoreAudible(5, "LEC", [], null, "").status, "unscored");
  const plan = [{ lap: right.lap + 2, drivers: [right.driver_code] }];
  assert.equal(scoreAudible(right.lap, right.driver_code, plan, right.truth, "").status, "cancelled");
  assert.equal(scoreAudible(right.lap, right.driver_code, [{ lap: right.lap + 3, drivers: [right.driver_code] }], right.truth, "").status, "scored");
  assert.equal(scoreAudible(right.lap, right.driver_code, [{ lap: right.lap, drivers: ["ZZZ"] }], right.truth, "").status, "scored");
});

test("scores stay hidden until revealed: freeze calls at their reveal, audibles at done", () => {
  const call = { kind: "freeze" as const, lap: 24, status: "scored", score_call: 100, score_reasoning: 25, total: 125 };
  assert.equal(presentCall(call, [], false).total, 0);
  assert.equal(presentCall(call, [24], false).total, 125);
  const aud = { kind: "audible" as const, lap: 30, status: "scored", score_call: -50, score_reasoning: 0, total: -50 };
  assert.deepEqual([presentCall(aud, [24], false).status, presentCall(aud, [24], false).total], ["pending", 0]);
  assert.equal(presentCall(aud, [24], true).total, -50);
});

test("freeze reveal carries no pair-by-pair future gaps", () => {
  const f = freezesOf(SG)[0];
  const r = freezeReveal(f) as Record<string, unknown>;
  assert.ok(!("detail" in r) && !("engine_inputs" in r));
  assert.ok(["BOX", "STAY"].includes(r.correct as string));
});

console.log(`${n} race-mode checks passed`);
