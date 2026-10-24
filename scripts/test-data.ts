// Hermetic checks for the DB race-data path (no network, no DB). Run: npx tsx scripts/test-data.ts
// Reads engine/build.py output (build/race-data, gitignored; built here when missing): load.json holds the
// exact rows scripts/seed-db.mjs inserts, blind/ and full/ hold build.py's own blind and full files.
// OLD_PUBLIC_DATA=<dir> also compares against a copy of the pre-DB public/data tree.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blindFrames, callMomentFrame, decisionForDriver, rowsToFrames, type DriverReveal } from "../lib/data";
import type { DecisionPoint, LapFrame } from "../lib/types";

const root = path.resolve(__dirname, "..");
const out = path.join(root, "build/race-data");
if (!existsSync(path.join(out, "load.json"))) execFileSync("python3", ["engine/build.py"], { cwd: root, stdio: "ignore" });
const json = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

interface LoadDriver {
  decision_id: string; code: string; number: number; name: string; team: string; team_colour: string | null;
  position: number; scorable: boolean; blind: Record<string, unknown>; full: Omit<DriverReveal, "code" | "number" | "name" | "team" | "team_colour" | "scorable">;
}
interface LoadDecision {
  id: string; race_key: string; lap: number; player_number: number; player_code: string;
  blind: Record<string, unknown>; full: DecisionPoint; ground_truth: { seconds: Record<string, unknown> }; drivers: LoadDriver[];
}
interface Load {
  races: { key: string; total_laps: number }[];
  race_laps: (Parameters<typeof rowsToFrames>[0][number] & { race_key: string; driver_id: string; stint: number })[];
  decision_points: LoadDecision[];
}
const load = json<Load>(path.join(out, "load.json"));
const BLIND_KEYS = ["id", "race", "blind_title", "lap", "trigger", "player_role", "options", "replay_from_lap", "factors", "total_laps", "pit_loss"];
const ANSWER = /"correct"|swing|"team_call"|"engine"|ground_truth|reveal_to_lap/;

assert.ok(load.races.length > 0 && load.decision_points.length > 0);
for (const dp of load.decision_points) {
  const rows = load.race_laps
    .filter((r) => r.race_key === dp.race_key)
    .sort((a, b) => a.lap - b.lap || a.position - b.position);
  const frames = rowsToFrames(rows);

  // race_laps rows rebuild build.py's full frames exactly.
  const fullFrames = json<LapFrame[]>(path.join(out, "full", dp.id, "frames.json"));
  assert.deepStrictEqual(frames, fullFrames, `${dp.id}: frames from race_laps differ from build.py's`);
  assert.equal(frames.length, load.races.find((r) => r.key === dp.race_key)!.total_laps);

  // The TypeScript call-moment port matches build.py's call_moment_frame for the decision's own car.
  const pyBlind = json<LapFrame[]>(path.join(out, "blind", dp.id, "frames.json"));
  assert.deepStrictEqual(blindFrames(frames, dp.lap, dp.player_number), pyBlind, `${dp.id}: blind frames differ from build.py`);
  if (process.env.OLD_PUBLIC_DATA) {
    const old = path.join(process.env.OLD_PUBLIC_DATA, dp.id);
    assert.deepStrictEqual(blindFrames(frames, dp.lap, dp.player_number), json(path.join(old, "frames.json")), `${dp.id}: differs from old public frames`);
    assert.deepStrictEqual(dp.blind, json(path.join(old, "decision.json")), `${dp.id}: differs from old public decision`);
    console.log(`ok ${dp.id}: matches ${old}`);
  }

  // Round 4 strict call moment: same frame, no lap-L stops at all, and nothing after lap L-1 is needed.
  const strict = blindFrames(frames, dp.lap, null);
  const last = strict[strict.length - 1];
  assert.equal(strict.length, dp.lap);
  assert.equal(last.lap, dp.lap);
  assert.ok(last.drivers.every((d) => !d.pitted_this_lap), `${dp.id}: strict call moment shows a lap-L stop`);
  assert.deepStrictEqual(
    last.drivers.map((d) => ({ ...d, pitted_this_lap: false })),
    pyBlind[pyBlind.length - 1].drivers.map((d) => ({ ...d, pitted_this_lap: false })),
  );
  const cut = [...frames.slice(0, dp.lap - 1), { lap: dp.lap, track_status: frames[dp.lap - 1].track_status, drivers: [] }];
  assert.deepStrictEqual(callMomentFrame(cut, dp.lap, null), last, `${dp.id}: strict call moment reads lap L's cars`);
  assert.throws(() => callMomentFrame(frames, dp.lap, 999), /not in lap/);

  // The blind column holds the blind keys only and no answer.
  assert.deepStrictEqual(Object.keys(dp.blind).sort(), [...BLIND_KEYS].sort(), `${dp.id}: blind keys`);
  assert.ok(!ANSWER.test(JSON.stringify(dp.blind)), `${dp.id}: blind decision mentions the answer`);
  assert.ok(dp.full.engine && dp.full.team && dp.full.ground_truth, `${dp.id}: full decision is incomplete`);

  // Per-driver answers (Round 4).
  const scorable = dp.drivers.filter((d) => d.scorable);
  assert.ok(scorable.length > 0, `${dp.id}: no scorable cars`);
  const mine = dp.drivers.find((d) => d.code === dp.player_code)!;
  assert.ok(mine.scorable, `${dp.id}: the decision's own car is not scorable`);
  assert.deepStrictEqual(mine.full.ground_truth, dp.full.ground_truth, `${dp.id}: own car's answer differs from the decision's`);
  assert.deepStrictEqual(mine.full.ground_truth_detail, dp.ground_truth.seconds);
  for (const d of dp.drivers) {
    assert.deepStrictEqual(Object.keys(d.blind).sort(), ["blind_title", "code", "name", "number", "team", "team_colour"]);
    assert.ok(!ANSWER.test(JSON.stringify(d.blind)), `${dp.id}/${d.code}: blind driver mentions the answer`);
    assert.ok(!String(d.blind.blind_title).includes(String(dp.full.race)), `${dp.id}/${d.code}: blind title names the race`);
    const gt = d.full.ground_truth_detail as { group_player_call: string[]; group_other_call: string[]; pairs: unknown[] };
    if (d.scorable) {
      assert.ok(gt.group_player_call.length > 0 && gt.group_other_call.length > 0, `${dp.id}/${d.code}: scorable without both groups`);
      assert.ok(gt.pairs.length > 0, `${dp.id}/${d.code}: scorable without a complete pair`);
      assert.ok(["BOX", "STAY"].includes(d.full.ground_truth.correct));
    }
    const asDecision = decisionForDriver(dp.full, { code: d.code, number: d.number, name: d.name, team: d.team, team_colour: d.team_colour, scorable: d.scorable, ...d.full });
    assert.equal(asDecision.ground_truth.correct, d.full.ground_truth.correct);
    assert.equal(asDecision.player_role.number, d.number);
    assert.equal(asDecision.team.call, d.full.team_call.call);
  }
  const blindList = json<{ default_driver: string; drivers: { code: string }[] }>(path.join(out, "blind", dp.id, "drivers.json"));
  assert.equal(blindList.default_driver, dp.player_code);
  assert.deepStrictEqual(blindList.drivers.map((d) => d.code), scorable.map((d) => d.code));
  console.log(`ok ${dp.id}: ${frames.length} laps, blind cut at ${dp.lap}, ${scorable.length}/${dp.drivers.length} cars scorable`);
}

// No static race data in the repo or in public/.
assert.ok(!existsSync(path.join(root, "public/data")), "public/data still exists");
assert.ok(!existsSync(path.join(root, "server-data")), "server-data still exists");
const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
assert.match(gitignore, /^\/build$/m, "build/ is not gitignored");

// The blind routes import only blind loaders; the reveal route is the only API route that reads answers.
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));
const FULL_LOADERS = /\b(getDecision|getFrames|getGroundTruth|getDriverAnswers?)\b/;
for (const f of walk(path.join(root, "app/api/decisions"))) {
  const src = readFileSync(f, "utf8");
  assert.ok(!FULL_LOADERS.test(src), `${path.relative(root, f)} reads full data`);
  assert.match(src, /private, max-age=/, `${path.relative(root, f)}: no private Cache-Control`);
}
console.log("ok data");
