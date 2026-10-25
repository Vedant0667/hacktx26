// Round 7: reasoning is graded once, at the end. Submit stores the call and transcript with a provisional
// rubric grade (graded_at null); the first results or leaderboard read after the reveal claims the lobby's
// grading, grades every ungraded call (Muse Spark, one call per reason, a re-ask on a grounding problem, the
// rubric scorer as fallback) plus the engine and real-team reasons for each car played (cached per decision,
// car and reasons text), and stores reasoning, verdict and points. Other readers see grading: true and poll.
import { createHash } from "node:crypto";
import {
  claimGrading,
  getBenchmarkGrades,
  getLobbyDriverCodes,
  getLobbyState,
  getRaceCalls,
  releaseGrading,
  saveBenchmarkGrade,
  saveRaceCallGrade,
  saveSubmissionGrade,
  type LobbyMeta,
  type StoredGrade,
} from "@/lib/db";
import { callMomentFrame, decisionForDriver, getAudibleTruth, getDriverAnswers, getFrames, getGroundTruth, getRaceFreezes, type DriverReveal, type RaceEntry, type RaceFreeze } from "@/lib/data";
import { gradeReason, buildRubric, isUngradeable, rubricScore, type Rubric, type RubricFacts } from "@/lib/muse";
import { pointsFor, rankLabel, rightCallOf, sharedRanks, stakesFor } from "@/lib/scoring";
import type { Call, DecisionPoint, LapFrame } from "@/lib/types";
import { HttpError, requireDecision } from "./http";
import { answerLaps, audibleRubric, clockOf, freezeRubric } from "./race";

// Calls auto-sent as the host reveals can land up to 2 s after it (REVEAL_GRACE_S in submit); grade after that.
export const GRADE_AFTER_S = 3;

export type BenchKind = "team" | "engine";
const hashOf = (reasons: string[]) => createHash("sha256").update(reasons.join("\n")).digest("hex").slice(0, 16);
const keyOf = (k: { decision_id: string; driver_code: string; kind: string; reasons_hash: string }) =>
  `${k.decision_id}|${k.driver_code}|${k.kind}|${k.reasons_hash}`;
// Round 9: a freeze as scored (race calls are graded only at the flag): the luck-aware right call in place of the
// measured one. Stakes keep the measured swing. The benchmark cache key includes the right call (benchJobs).
const atFlag = (f: RaceFreeze): RaceFreeze => ({ ...f, full: { ...f.full, correct: rightCallOf(f.full) } });

const DRY = ["SOFT", "MEDIUM", "HARD"];

// Rubric facts for one car at a moment, from the frames and the measured pit loss only (never the engine):
// position, tyres, laps left, whether a stop is still owed, and how many cars pitted on laps L to L+2.
export function momentFacts(d: DecisionPoint, frames: LapFrame[] | null, pitLossGreen: number | null): RubricFacts {
  if (!frames?.length) return { pit_loss_green_s: pitLossGreen };
  let me: LapFrame["drivers"][number] | undefined;
  let of = 0;
  try {
    const cm = callMomentFrame(frames, d.lap, null);
    me = cm.drivers.find((x) => x.number === d.player_role.number);
    of = cm.drivers.length;
  } catch {
    // frames do not cover the call lap: facts without the car
  }
  const to = d.lap + 2;
  const pitted = new Set(frames.filter((f) => f.lap >= d.lap && f.lap <= to).flatMap((f) => f.drivers.filter((x) => x.pitted_this_lap).map((x) => x.code)));
  const age = me?.tyre_age ?? null;
  return {
    position: me?.position ?? null, compound: me?.compound ?? null, tyre_age: age,
    laps_left: Math.max(0, (frames[frames.length - 1]?.lap ?? d.lap) - d.lap),
    stopped_yet: age != null && me?.compound && DRY.includes(me.compound.toUpperCase()) ? age + 1 < d.lap : null,
    pit_loss_green_s: pitLossGreen,
    field: of ? { pitted: pitted.size, of, from: d.lap, to } : null,
  };
}

export function momentRubric(d: DecisionPoint, facts: RubricFacts): Rubric {
  return buildRubric({ decision_id: d.id, factors: d.factors, correct: rightCallOf(d.ground_truth), swing_s: d.ground_truth.swing_s, trigger: d.trigger, facts });
}

const pitLossOf = (gt: Record<string, unknown> | null) => {
  const v = (gt?.pit_loss as { normal_s?: unknown } | undefined)?.normal_s;
  return typeof v === "number" ? v : null;
};

// The rubric for one car's decision, loading the frames and pit loss (cached per process by lib/data.ts).
export async function momentRubricFor(d: DecisionPoint): Promise<Rubric> {
  const [frames, gt] = await Promise.all([getFrames(d.id), getGroundTruth(d.id)]);
  return momentRubric(d, momentFacts(d, frames, pitLossOf(gt)));
}

interface BenchJob {
  key: { decision_id: string; driver_code: string; kind: BenchKind; reasons_hash: string };
  rubric: Rubric;
  call: Call;
  reasons: string[];
  situation: string;
}

function benchJobs(rubric: Rubric, car: string, situation: string, team: { call: Call; reasons: string[] }, engine: { call: Call; reasons: string[] }): BenchJob[] {
  return ([["team", team], ["engine", engine]] as const).map(([kind, b]) => ({
    key: { decision_id: rubric.decision_id, driver_code: car, kind, reasons_hash: hashOf([...b.reasons, `right:${rubric.correct}`]) },
    rubric, call: b.call, reasons: b.reasons, situation,
  }));
}

// A benchmark's grade: the cached one, else the rubric score (never a Muse call outside a claimed grading run).
function benchGrade(job: BenchJob, cache: Map<string, StoredGrade>): StoredGrade {
  const hit = cache.get(keyOf(job.key));
  if (hit) return hit;
  const g = rubricScore(job.rubric, job.reasons.join(". "));
  return { reasoning_score: g.reasoning_score, verdict: g.verdict, credited: g.credited, source: g.source };
}

async function gradeBench(job: BenchJob): Promise<void> {
  const said = job.reasons.join(". ");
  const g = await gradeReason(job.rubric, job.call, said, { purpose: "grade_benchmark", lobbyCode: null, situation: job.situation });
  // Cache only a Muse grade, or a reason Muse never sees. A rubric fallback after a failed call stays uncached,
  // so the next summary asks Muse again (a cached fallback was never regraded).
  if (g.source !== "muse" && !isUngradeable(said.trim()) && job.rubric.points.length > 0) return;
  await saveBenchmarkGrade(job.key, { reasoning_score: g.reasoning_score, verdict: g.verdict, credited: g.credited, source: g.source });
}

// ---- Moment lobbies ----

interface MomentCtx {
  decision: DecisionPoint;
  answers: DriverReveal[];
  cars: string[];
  forCar: (code: string | null) => DecisionPoint;
  rubricFor: (code: string | null) => Rubric;
  jobs: BenchJob[];
}

async function momentCtx(code: string, meta: LobbyMeta): Promise<MomentCtx> {
  const decision = await requireDecision(meta.decision_id);
  const [answers, played, frames, gt] = await Promise.all([getDriverAnswers(decision.id), getLobbyDriverCodes(code), getFrames(decision.id), getGroundTruth(decision.id)]);
  if (!answers) throw new HttpError(404, `Data for ${decision.id} not found`);
  const scorable = answers.filter((d) => d.scorable);
  const cars = played.filter((c) => scorable.some((d) => d.code === c));
  const forCar = (c: string | null) => {
    const d = scorable.find((x) => x.code === c);
    return d ? decisionForDriver(decision, d) : decision;
  };
  const rubrics = new Map<string, Rubric>();
  const rubricFor = (c: string | null) => {
    const k = c ?? "";
    if (!rubrics.has(k)) {
      const d = forCar(c);
      rubrics.set(k, momentRubric(d, momentFacts(d, frames, pitLossOf(gt))));
    }
    return rubrics.get(k)!;
  };
  const situation = decision.blind_title ?? `Lap ${decision.lap}. ${decision.trigger}.`;
  const jobs = cars.flatMap((c) => {
    const d = forCar(c);
    return benchJobs(rubricFor(c), c, situation, d.team, d.engine);
  });
  return { decision, answers: scorable, cars, forCar, rubricFor, jobs };
}

// Grades what is left to grade, if this request wins the claim. grading: true while anything is still ungraded.
export async function ensureMomentGraded(code: string, meta: LobbyMeta, ctx?: MomentCtx): Promise<{ grading: boolean; ctx: MomentCtx }> {
  const c = ctx ?? (await momentCtx(code, meta));
  const state = await getLobbyState(code);
  if (!state) throw new HttpError(404, "Lobby not found");
  const subs = state.submissions.filter((s) => !s.graded);
  const cache = await getBenchmarkGrades(c.jobs.map((j) => j.key));
  const missing = c.jobs.filter((j) => !cache.has(keyOf(j.key)));
  if (!subs.length && !missing.length) return { grading: false, ctx: c };
  if (meta.phase === "reveal" && meta.phase_elapsed_s < GRADE_AFTER_S) return { grading: true, ctx: c };
  if (!(await claimGrading(code, meta.decision_id))) return { grading: true, ctx: c };
  try {
    // Re-read after winning the claim: a grader that just finished may already have graded these.
    const fresh = await getLobbyState(code);
    subs.splice(0, subs.length, ...(fresh?.submissions ?? []).filter((s) => !s.graded));
    const situation = c.decision.blind_title ?? `Lap ${c.decision.lap}. ${c.decision.trigger}.`;
    await Promise.all([
      ...subs.map(async (s) => {
        const d = c.forCar(s.driver_code);
        const g = await gradeReason(c.rubricFor(s.driver_code), s.call, s.transcript, { purpose: "grade_call", lobbyCode: code, situation });
        const total = pointsFor(s.call, rightCallOf(d.ground_truth), stakesFor(d.ground_truth.swing_s), s.call ? g.reasoning_score : 0);
        await saveSubmissionGrade(code, s.player_name, s.decision_id, {
          score_reasoning: s.call ? g.reasoning_score : 0, total, verdict: g.verdict, credited: g.credited,
        });
      }),
      ...missing.map(gradeBench),
    ]);
  } finally {
    await releaseGrading(code, meta.decision_id);
  }
  return { grading: false, ctx: c };
}

// ---- The end-of-game summary (one shape for moment and race lobbies) ----

// Optional luck fields (Round 9, written by another pass when a red flag, a late SC/VSC or rain changed the
// result): passed through when the decision data carries them, rendered by the end screen.
export interface LuckFields {
  final_right_call?: Call;
  luck?: boolean;
  luck_events?: unknown[];
  explanation?: string | null; // Round 9: null when no accepted AI verdict
}

export interface SummaryCar {
  code: string;
  name: string;
  team: string;
  team_colour: string | null;
}

export interface MomentCar extends LuckFields {
  code: string;
  team: string;
  correct: Call;
  swing_s: number;
  stakes: number;
  team_call: Call;
}

export interface MomentEntry {
  kind: "player" | "team" | "engine";
  name: string; // player name, team name, or "Engine"
  driver_code: string | null;
  call: Call | null;
  said: string; // the player's words; for team and engine, their reasons
  right: boolean | null; // null: no call
  stakes: number;
  reasoning: number;
  verdict: string | null;
  credited: string[];
  points: number;
}

export interface SummaryMoment {
  lap: number;
  triggers: string[]; // "SC", "VSC", "RIVAL_STOP", ...
  cars: MomentCar[]; // every car with a call at this moment
  entries: MomentEntry[]; // players who owed a call here (no call: call null, 0), then engine and team rows
}

export interface SummaryAudible {
  name: string;
  driver_code: string;
  lap: number;
  status: "scored" | "unscored" | "cancelled" | "pending";
  right: boolean | null;
  stakes: number;
  reasoning: number;
  verdict: string | null;
  said: string;
  points: number;
}

export interface RankRow {
  kind: "player" | "team" | "engine";
  name: string;
  driver_code: string | null;
  points: number; // total across every moment and audible
  calls: number;
  right: number;
  rank: number;
  tied: boolean;
  rank_label: string; // "1", "=2"
}

export interface GameSummary {
  grading: boolean;
  mode: "moment" | "race";
  race: string;
  cars: SummaryCar[];
  winners: { names: string[]; points: number } | null; // top player or players (a tie)
  ranking: RankRow[]; // players, then engine and real team per car; best first, equal points share a rank
  moments: SummaryMoment[];
  audibles: SummaryAudible[];
}

export function rankEntries<T extends { kind: string; name: string; points: number }>(rows: T[]): (T & { rank: number; tied: boolean; rank_label: string })[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points || (a.kind === "player" ? 0 : 1) - (b.kind === "player" ? 0 : 1) || a.name.localeCompare(b.name));
  const ranks = sharedRanks(sorted.map((r) => r.points));
  return sorted.map((r, i) => ({ ...r, ...ranks[i], rank_label: rankLabel(ranks[i]) }));
}

const luckOf = (src: unknown): LuckFields => {
  const o = (src ?? {}) as Record<string, unknown>;
  const out: LuckFields = {};
  if (o.final_right_call === "BOX" || o.final_right_call === "STAY") out.final_right_call = o.final_right_call;
  if (typeof o.luck === "boolean") out.luck = o.luck;
  if (Array.isArray(o.luck_events)) out.luck_events = o.luck_events;
  if (typeof o.explanation === "string" || o.explanation === null) out.explanation = o.explanation;
  return out;
};

// Totals per player and benchmark across moments and audibles, ranked; the top player or players win.
function finish(base: Omit<GameSummary, "ranking" | "winners">, players: { name: string; driver_code: string | null }[]): GameSummary {
  const rows = new Map<string, Omit<RankRow, "rank" | "tied" | "rank_label">>();
  const key = (kind: string, name: string, car: string | null) => (kind === "player" ? `p:${name}` : `${kind}:${car}`);
  // Only players with a car (a call to make) get a row up front; watchers who joined late without a car don't.
  for (const p of players) if (p.driver_code) rows.set(key("player", p.name, null), { kind: "player", name: p.name, driver_code: p.driver_code, points: 0, calls: 0, right: 0 });
  const add = (kind: RankRow["kind"], name: string, car: string | null, points: number, call: boolean, right: boolean | null) => {
    const k = key(kind, name, car);
    const r = rows.get(k) ?? { kind, name, driver_code: car, points: 0, calls: 0, right: 0 };
    r.points += points;
    if (call) r.calls++;
    if (right) r.right++;
    rows.set(k, r);
  };
  for (const m of base.moments) for (const e of m.entries) add(e.kind, e.name, e.driver_code, e.points, !!e.call, e.right);
  for (const a of base.audibles) add("player", a.name, a.driver_code, a.points, a.status === "scored", a.right);
  const ranking = rankEntries([...rows.values()]);
  const top = ranking.filter((r) => r.kind === "player");
  const best = top[0]?.points;
  const winners = top.length ? { names: top.filter((r) => r.points === best).map((r) => r.name), points: best! } : null;
  return { ...base, ranking, winners };
}

const pending = (mode: GameSummary["mode"], race: string): GameSummary => ({ grading: true, mode, race, cars: [], winners: null, ranking: [], moments: [], audibles: [] });

export async function momentSummary(code: string, meta: LobbyMeta): Promise<GameSummary> {
  const { grading, ctx } = await ensureMomentGraded(code, meta);
  if (grading) return pending("moment", ctx.decision.race);
  const [state, cache] = await Promise.all([getLobbyState(code), getBenchmarkGrades(ctx.jobs.map((j) => j.key))]);
  const carOf = (name: string) => state?.players.find((p) => p.name === name)?.driver_code ?? state?.driver_code ?? null;
  const cars: SummaryCar[] = ctx.cars.map((c) => {
    const a = ctx.answers.find((x) => x.code === c)!;
    return { code: c, name: a.name, team: a.team, team_colour: a.team_colour };
  });
  const momentCars: MomentCar[] = ctx.cars.map((c) => {
    const d = ctx.forCar(c);
    const a = ctx.answers.find((x) => x.code === c)!;
    return {
      code: c, team: a.team, correct: d.ground_truth.correct, swing_s: d.ground_truth.swing_s, stakes: stakesFor(d.ground_truth.swing_s),
      team_call: d.team.call, ...luckOf(a.ground_truth),
    };
  });
  const subs = new Map((state?.submissions ?? []).map((s) => [s.player_name, s]));
  // Current players only: a player the host kicked doesn't come back through a stored call.
  const names = (state?.players ?? []).map((p) => p.name);
  const entries: MomentEntry[] = names.map((name) => {
    const s = subs.get(name);
    const car = s?.driver_code ?? carOf(name);
    const d = ctx.forCar(car);
    const stakes = stakesFor(d.ground_truth.swing_s);
    return {
      kind: "player", name, driver_code: car, call: s?.call ?? null, said: s?.transcript ?? "",
      right: s?.call ? s.call === rightCallOf(d.ground_truth) : null, stakes,
      reasoning: s?.call ? s.score_reasoning : 0, verdict: s?.call ? (s.verdict ?? null) : null, credited: s?.credited ?? [], points: s?.call ? s.total : 0,
    };
  });
  for (const j of ctx.jobs) {
    const d = ctx.forCar(j.key.driver_code);
    const g = benchGrade(j, cache);
    const stakes = stakesFor(d.ground_truth.swing_s);
    entries.push({
      kind: j.key.kind, name: j.key.kind === "engine" ? "Engine" : d.player_role.team, driver_code: j.key.driver_code, call: j.call,
      said: j.reasons.join(" "), right: j.call === rightCallOf(d.ground_truth), stakes, reasoning: g.reasoning_score, verdict: g.verdict,
      credited: g.credited, points: pointsFor(j.call, rightCallOf(d.ground_truth), stakes, g.reasoning_score),
    });
  }
  const moment: SummaryMoment = { lap: ctx.decision.lap, triggers: [ctx.decision.trigger], cars: momentCars, entries };
  return finish({ grading: false, mode: "moment", race: ctx.decision.race, cars, moments: [moment], audibles: [] }, names.map((n) => ({ name: n, driver_code: subs.get(n)?.driver_code ?? carOf(n) })));
}

// Team and engine rows for each car played in a moment lobby (leaderboard), graded the same way.
export async function momentBenchmarks(code: string, meta: LobbyMeta) {
  const ctx = await momentCtx(code, meta);
  const cache = await getBenchmarkGrades(ctx.jobs.map((j) => j.key));
  return ctx.jobs.map((j) => {
    const d = ctx.forCar(j.key.driver_code);
    const g = benchGrade(j, cache);
    const stakes = stakesFor(d.ground_truth.swing_s);
    return { job: j, decision: d, grade: g, stakes, points: pointsFor(j.call, rightCallOf(d.ground_truth), stakes, g.reasoning_score) };
  });
}

// ---- Race lobbies ----

function raceSituation(f: RaceFreeze): string {
  return f.blind.blind_title;
}

function raceJobs(raceKey: string, totalLaps: number, plan: { lap: number; drivers: string[] }[], laps: number[], cars: string[], freezes: RaceFreeze[]): BenchJob[] {
  const out: BenchJob[] = [];
  for (const entry of plan.filter((e) => laps.includes(e.lap))) {
    for (const car of cars.filter((c) => entry.drivers.includes(c))) {
      const f = freezes.find((x) => x.lap === entry.lap && x.driver_code === car);
      if (f) out.push(...benchJobs(freezeRubric(raceKey, atFlag(f), totalLaps), car, raceSituation(f), f.full.team_call, f.full.engine));
    }
  }
  return out;
}

// Round 7: nobody learns who was right until the flag, so race calls are graded once, at done: every freeze
// call and every scored audible, plus the engine and team reasons per car and freeze ('race' scope).
export async function ensureRaceGraded(code: string, meta: LobbyMeta, race: RaceEntry): Promise<{ grading: boolean }> {
  const clock = clockOf(meta);
  const done = meta.phase === "done";
  const plan = meta.freeze_plan ?? [];
  const laps = answerLaps(clock);
  if (!done) return { grading: false };
  const [calls, freezes, cars] = await Promise.all([getRaceCalls(code), getRaceFreezes(race.race_key), getLobbyDriverCodes(code)]);
  const todo = calls.filter((c) => !c.graded && ((c.kind === "freeze" && laps.includes(c.lap)) || (c.kind === "audible" && done && c.status === "scored")));
  const jobs = raceJobs(race.race_key, race.total_laps, plan, laps, cars, freezes);
  const cache = await getBenchmarkGrades(jobs.map((j) => j.key));
  const missing = jobs.filter((j) => !cache.has(keyOf(j.key)));
  if (!todo.length && !missing.length) return { grading: false };
  if (!(await claimGrading(code, "race"))) return { grading: true };
  try {
    // Re-read after winning the claim: a grader that just finished may already have graded these.
    const fresh = await getRaceCalls(code);
    const graded = new Set(fresh.filter((c) => c.graded).map((c) => `${c.player_name}:${c.kind}:${c.lap}`));
    todo.splice(0, todo.length, ...todo.filter((c) => !graded.has(`${c.player_name}:${c.kind}:${c.lap}`)));
    await Promise.all([
      ...todo.map(async (c) => {
        let rubric: Rubric | null = null;
        let situation = "";
        if (c.kind === "freeze") {
          const f = freezes.find((x) => x.lap === c.lap && x.driver_code === c.driver_code);
          if (f) [rubric, situation] = [freezeRubric(race.race_key, atFlag(f), race.total_laps), raceSituation(f)];
        } else {
          const truth = await getAudibleTruth(race.race_key, c.driver_code, c.lap);
          if (truth?.scorable && truth.correct) [rubric, situation] = [audibleRubric(c.driver_code, c.lap, truth), `Lap ${c.lap}. Green flag. Box now call.`];
        }
        if (!rubric) return;
        const g = await gradeReason(rubric, c.call, c.transcript, { purpose: "grade_call", lobbyCode: code, situation });
        const r = c.call ? g.reasoning_score : 0;
        await saveRaceCallGrade(code, c.player_name, c.kind, c.lap, {
          score_reasoning: r, total: pointsFor(c.call, rubric.correct, stakesFor(rubric.swing_s), r), verdict: g.verdict, credited: g.credited,
        });
      }),
      ...missing.map(gradeBench),
    ]);
  } finally {
    await releaseGrading(code, "race");
  }
  return { grading: false };
}

// Team and engine grades for one car's freeze (race leaderboard), from the cache or the rubric score.
export async function raceBenchmarkGrades(raceKey: string, totalLaps: number, items: { car: string; freeze: RaceFreeze }[]) {
  const jobs = items.flatMap(({ car, freeze }) => benchJobs(freezeRubric(raceKey, atFlag(freeze), totalLaps), car, raceSituation(freeze), freeze.full.team_call, freeze.full.engine));
  const cache = await getBenchmarkGrades(jobs.map((j) => j.key));
  return jobs.map((j) => {
    const g = benchGrade(j, cache);
    const stakes = stakesFor(j.rubric.swing_s);
    return { car: j.key.driver_code, lap: Number(j.rubric.decision_id.match(/-L(\d+)-/)?.[1]), kind: j.key.kind, call: j.call, grade: g, stakes, points: pointsFor(j.call, j.rubric.correct, stakes, g.reasoning_score) };
  });
}

// The race at the flag: every freeze with each car's answer and every player's call, the audibles, totals.
export async function raceSummary(code: string, meta: LobbyMeta, race: RaceEntry): Promise<GameSummary> {
  if (meta.phase !== "done") throw new HttpError(409, "The summary opens at the flag");
  const { grading } = await ensureRaceGraded(code, meta, race);
  if (grading) return pending("race", race.name);
  const [calls, freezes, played, state] = await Promise.all([getRaceCalls(code), getRaceFreezes(race.race_key), getLobbyDriverCodes(code), getLobbyState(code)]);
  const players = (state?.players ?? []).map((p) => ({ name: p.name, driver_code: p.driver_code ?? state?.driver_code ?? null }));
  const plan = meta.freeze_plan ?? [];
  const items = plan.flatMap((e) =>
    played.filter((car) => e.drivers.includes(car)).map((car) => ({ car, freeze: freezes.find((x) => x.lap === e.lap && x.driver_code === car) })),
  ).filter((x): x is { car: string; freeze: RaceFreeze } => !!x.freeze);
  const grades = await raceBenchmarkGrades(race.race_key, race.total_laps, items);
  const moments: SummaryMoment[] = plan.map((e) => {
    const here = items.filter((x) => x.freeze.lap === e.lap);
    const momentCars: MomentCar[] = here.map(({ car, freeze: f }) => ({
      code: car, team: race.drivers.find((d) => d.code === car)?.team ?? car, correct: f.full.correct, swing_s: f.full.swing_s,
      stakes: stakesFor(f.full.swing_s), team_call: f.full.team_call.call, ...luckOf(f.full),
    }));
    const entries: MomentEntry[] = players
      .filter((p) => p.driver_code && here.some((x) => x.car === p.driver_code))
      .map((p) => {
        const c = calls.find((x) => x.kind === "freeze" && x.lap === e.lap && x.player_name === p.name);
        const mc = momentCars.find((x) => x.code === (c?.driver_code ?? p.driver_code))!;
        return {
          kind: "player" as const, name: p.name, driver_code: mc.code, call: c?.call ?? null, said: c?.transcript ?? "",
          right: c?.call ? c.call === rightCallOf(mc) : null, stakes: mc.stakes, reasoning: c?.call ? c.score_reasoning : 0,
          verdict: c?.call ? (c.verdict ?? null) : null, credited: c?.credited ?? [], points: c?.call ? c.total : 0,
        };
      });
    for (const g of grades.filter((x) => x.lap === e.lap)) {
      const mc = momentCars.find((x) => x.code === g.car)!;
      const f = here.find((x) => x.car === g.car)!.freeze;
      entries.push({
        kind: g.kind, name: g.kind === "engine" ? "Engine" : mc.team, driver_code: g.car, call: g.call,
        said: (g.kind === "engine" ? f.full.engine.reasons : f.full.team_call.reasons).join(" "), right: g.call === rightCallOf(mc),
        stakes: g.stakes, reasoning: g.grade.reasoning_score, verdict: g.grade.verdict, credited: g.grade.credited, points: g.points,
      });
    }
    return { lap: e.lap, triggers: [...new Set(here.flatMap((x) => x.freeze.blind.triggers.map((t) => t.type)))], cars: momentCars, entries };
  });
  const audibles: SummaryAudible[] = [];
  for (const c of calls.filter((x) => x.kind === "audible")) {
    const truth = c.status === "scored" ? await getAudibleTruth(race.race_key, c.driver_code, c.lap) : null;
    audibles.push({
      name: c.player_name, driver_code: c.driver_code, lap: c.lap, status: c.status,
      right: truth?.correct ? truth.correct === "BOX" : null, stakes: c.score_call, reasoning: c.score_reasoning,
      verdict: c.verdict ?? null, said: c.transcript, points: c.total,
    });
  }
  const cars: SummaryCar[] = played.map((code) => {
    const d = race.drivers.find((x) => x.code === code);
    return { code, name: d?.name ?? code, team: d?.team ?? "", team_colour: d?.team_colour ?? null };
  });
  return finish({ grading: false, mode: "race", race: race.name, cars, moments, audibles }, players);
}
