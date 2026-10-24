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
import { decisionForDriver, getAudibleTruth, getDriverAnswers, getRaceFreezes, type DriverReveal, type RaceEntry, type RaceFreeze } from "@/lib/data";
import { gradeReason, buildRubric, rubricScore, type Rubric } from "@/lib/muse";
import { pointsFor, rankLabel, sharedRanks, stakesFor } from "@/lib/scoring";
import type { Call, DecisionPoint } from "@/lib/types";
import { HttpError, requireDecision } from "./http";
import { audibleRubric, clockOf, freezeRubric, revealedLaps } from "./race";

// Calls auto-sent as the host reveals can land up to 2 s after it (REVEAL_GRACE_S in submit); grade after that.
export const GRADE_AFTER_S = 3;

export type BenchKind = "team" | "engine";
const hashOf = (reasons: string[]) => createHash("sha256").update(reasons.join("\n")).digest("hex").slice(0, 16);
const keyOf = (k: { decision_id: string; driver_code: string; kind: string; reasons_hash: string }) =>
  `${k.decision_id}|${k.driver_code}|${k.kind}|${k.reasons_hash}`;

export function momentRubric(d: DecisionPoint): Rubric {
  return buildRubric({
    decision_id: d.id, factors: d.factors, correct: d.ground_truth.correct, swing_s: d.ground_truth.swing_s,
    trigger: d.trigger, engine_reasons: d.engine.reasons,
  });
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
    key: { decision_id: rubric.decision_id, driver_code: car, kind, reasons_hash: hashOf(b.reasons) },
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
  const g = await gradeReason(job.rubric, job.call, job.reasons.join(". "), { purpose: "grade_benchmark", lobbyCode: null, situation: job.situation });
  await saveBenchmarkGrade(job.key, { reasoning_score: g.reasoning_score, verdict: g.verdict, credited: g.credited, source: g.source });
}

// ---- Moment lobbies ----

interface MomentCtx {
  decision: DecisionPoint;
  answers: DriverReveal[];
  cars: string[];
  forCar: (code: string | null) => DecisionPoint;
  jobs: BenchJob[];
}

async function momentCtx(code: string, meta: LobbyMeta): Promise<MomentCtx> {
  const decision = await requireDecision(meta.decision_id);
  const [answers, played] = await Promise.all([getDriverAnswers(decision.id), getLobbyDriverCodes(code)]);
  if (!answers) throw new HttpError(404, `Data for ${decision.id} not found`);
  const scorable = answers.filter((d) => d.scorable);
  const cars = played.filter((c) => scorable.some((d) => d.code === c));
  const forCar = (c: string | null) => {
    const d = scorable.find((x) => x.code === c);
    return d ? decisionForDriver(decision, d) : decision;
  };
  const situation = decision.blind_title ?? `Lap ${decision.lap}. ${decision.trigger}.`;
  const jobs = cars.flatMap((c) => {
    const d = forCar(c);
    return benchJobs(momentRubric(d), c, situation, d.team, d.engine);
  });
  return { decision, answers: scorable, cars, forCar, jobs };
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
    const situation = c.decision.blind_title ?? `Lap ${c.decision.lap}. ${c.decision.trigger}.`;
    await Promise.all([
      ...subs.map(async (s) => {
        const d = c.forCar(s.driver_code);
        const g = await gradeReason(momentRubric(d), s.call, s.transcript, { purpose: "grade_call", lobbyCode: code, situation });
        const total = pointsFor(s.call, d.ground_truth.correct, stakesFor(d.ground_truth.swing_s), s.call ? g.reasoning_score : 0);
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

// ---- The end screen payload ----

export interface ResultCar {
  code: string;
  name: string;
  team: string;
  team_colour: string | null;
  correct: Call;
  swing_s: number;
  stakes: number;
  reveal_to_lap: number;
  team_call: Call;
}

export interface ResultEntry {
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
  rank: number;
  tied: boolean;
  rank_label: string; // "1", "=2"
}

export interface ResultsResponse {
  grading: boolean;
  decision_id: string;
  race: string;
  lap: number;
  cars: ResultCar[];
  takes: ResultEntry[]; // players in join order, including any who made no call
  ranking: ResultEntry[]; // players, engine and real team, best first; equal points share a rank
}

export function rankEntries<T extends { kind: string; name: string; points: number }>(rows: T[]): (T & { rank: number; tied: boolean; rank_label: string })[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points || (a.kind === "player" ? 0 : 1) - (b.kind === "player" ? 0 : 1) || a.name.localeCompare(b.name));
  const ranks = sharedRanks(sorted.map((r) => r.points));
  return sorted.map((r, i) => ({ ...r, ...ranks[i], rank_label: rankLabel(ranks[i]) }));
}

export async function momentResults(code: string, meta: LobbyMeta): Promise<ResultsResponse> {
  const { grading, ctx } = await ensureMomentGraded(code, meta);
  const base = { grading, decision_id: ctx.decision.id, race: ctx.decision.race, lap: ctx.decision.lap };
  if (grading) return { ...base, cars: [], takes: [], ranking: [] };
  const [state, cache] = await Promise.all([getLobbyState(code), getBenchmarkGrades(ctx.jobs.map((j) => j.key))]);
  const cars: ResultCar[] = ctx.cars.map((c) => {
    const a = ctx.answers.find((x) => x.code === c)!;
    const d = ctx.forCar(c);
    return {
      code: c, name: a.name, team: a.team, team_colour: a.team_colour, correct: d.ground_truth.correct, swing_s: d.ground_truth.swing_s,
      stakes: stakesFor(d.ground_truth.swing_s), reveal_to_lap: d.reveal_to_lap, team_call: d.team.call,
    };
  });
  const subs = new Map((state?.submissions ?? []).map((s) => [s.player_name, s]));
  const carOf = (name: string) => state?.players.find((p) => p.name === name)?.driver_code ?? state?.driver_code ?? null;
  const players = (state?.players ?? []).map((p) => {
    const s = subs.get(p.name);
    const d = ctx.forCar(s?.driver_code ?? carOf(p.name));
    return {
      kind: "player" as const, name: p.name, driver_code: s?.driver_code ?? carOf(p.name), call: s?.call ?? null, said: s?.transcript ?? "",
      right: s?.call ? s.call === d.ground_truth.correct : null, stakes: stakesFor(d.ground_truth.swing_s),
      reasoning: s?.call ? s.score_reasoning : 0, verdict: s?.call ? (s.verdict ?? null) : null, credited: s?.credited ?? [], points: s?.call ? s.total : 0,
    };
  });
  // A call from a player who has since been removed still counts (kick after the reveal keeps the row).
  for (const s of state?.submissions ?? []) {
    if (players.some((p) => p.name === s.player_name)) continue;
    const d = ctx.forCar(s.driver_code);
    players.push({
      kind: "player", name: s.player_name, driver_code: s.driver_code, call: s.call, said: s.transcript,
      right: s.call ? s.call === d.ground_truth.correct : null, stakes: stakesFor(d.ground_truth.swing_s),
      reasoning: s.score_reasoning, verdict: s.verdict ?? null, credited: s.credited ?? [], points: s.total,
    });
  }
  const benches = ctx.jobs.map((j) => {
    const d = ctx.forCar(j.key.driver_code);
    const g = benchGrade(j, cache);
    return {
      kind: j.key.kind, name: j.key.kind === "engine" ? "Engine" : d.player_role.team, driver_code: j.key.driver_code, call: j.call,
      said: j.reasons.join(" "), right: j.call === d.ground_truth.correct, stakes: stakesFor(d.ground_truth.swing_s),
      reasoning: g.reasoning_score, verdict: g.verdict, credited: g.credited,
      points: pointsFor(j.call, d.ground_truth.correct, stakesFor(d.ground_truth.swing_s), g.reasoning_score),
    };
  });
  const ranking = rankEntries([...players, ...benches]);
  const byName = new Map(ranking.filter((r) => r.kind === "player").map((r) => [r.name, r]));
  return { ...base, cars, takes: players.map((p) => byName.get(p.name)!), ranking };
}

// Team and engine rows for each car played in a moment lobby (leaderboard), graded the same way.
export async function momentBenchmarks(code: string, meta: LobbyMeta) {
  const ctx = await momentCtx(code, meta);
  const cache = await getBenchmarkGrades(ctx.jobs.map((j) => j.key));
  return ctx.jobs.map((j) => {
    const d = ctx.forCar(j.key.driver_code);
    const g = benchGrade(j, cache);
    const stakes = stakesFor(d.ground_truth.swing_s);
    return { job: j, decision: d, grade: g, stakes, points: pointsFor(j.call, d.ground_truth.correct, stakes, g.reasoning_score) };
  });
}

// ---- Race lobbies ----

function raceSituation(f: RaceFreeze): string {
  return f.blind.blind_title;
}

function raceJobs(raceKey: string, plan: { lap: number; drivers: string[] }[], laps: number[], cars: string[], freezes: RaceFreeze[]): BenchJob[] {
  const out: BenchJob[] = [];
  for (const entry of plan.filter((e) => laps.includes(e.lap))) {
    for (const car of cars.filter((c) => entry.drivers.includes(c))) {
      const f = freezes.find((x) => x.lap === entry.lap && x.driver_code === car);
      if (f) out.push(...benchJobs(freezeRubric(raceKey, f), car, raceSituation(f), f.full.team_call, f.full.engine));
    }
  }
  return out;
}

// Freeze calls on revealed freezes, and at done the scored audibles, graded once per lobby ('race' scope).
// The current freeze waits GRADE_AFTER_S into reveal_freeze for calls still in flight.
export async function ensureRaceGraded(code: string, meta: LobbyMeta, race: RaceEntry): Promise<{ grading: boolean }> {
  const clock = clockOf(meta);
  const revealed = revealedLaps(clock);
  const done = meta.phase === "done";
  const plan = meta.freeze_plan ?? [];
  const current = meta.phase === "reveal_freeze" ? plan[meta.freeze_index]?.lap : undefined;
  const settling = current !== undefined && meta.phase_elapsed_s < GRADE_AFTER_S;
  const laps = revealed.filter((l) => !(settling && l === current));
  const [calls, freezes, cars] = await Promise.all([getRaceCalls(code), getRaceFreezes(race.race_key), getLobbyDriverCodes(code)]);
  const todo = calls.filter((c) => !c.graded && ((c.kind === "freeze" && laps.includes(c.lap)) || (c.kind === "audible" && done && c.status === "scored")));
  const jobs = raceJobs(race.race_key, plan, laps, cars, freezes);
  const cache = await getBenchmarkGrades(jobs.map((j) => j.key));
  const missing = jobs.filter((j) => !cache.has(keyOf(j.key)));
  const waiting = settling && calls.some((c) => c.kind === "freeze" && c.lap === current && !c.graded);
  if (!todo.length && !missing.length) return { grading: waiting };
  if (!(await claimGrading(code, "race"))) return { grading: true };
  try {
    await Promise.all([
      ...todo.map(async (c) => {
        let rubric: Rubric | null = null;
        let situation = "";
        if (c.kind === "freeze") {
          const f = freezes.find((x) => x.lap === c.lap && x.driver_code === c.driver_code);
          if (f) [rubric, situation] = [freezeRubric(race.race_key, f), raceSituation(f)];
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
  return { grading: waiting };
}

// Team and engine grades for one car's freeze (race leaderboard), from the cache or the rubric score.
export async function raceBenchmarkGrades(raceKey: string, items: { car: string; freeze: RaceFreeze }[]) {
  const jobs = items.flatMap(({ car, freeze }) => benchJobs(freezeRubric(raceKey, freeze), car, raceSituation(freeze), freeze.full.team_call, freeze.full.engine));
  const cache = await getBenchmarkGrades(jobs.map((j) => j.key));
  return jobs.map((j) => {
    const g = benchGrade(j, cache);
    const stakes = stakesFor(j.rubric.swing_s);
    return { car: j.key.driver_code, lap: Number(j.rubric.decision_id.match(/-L(\d+)-/)?.[1]), kind: j.key.kind, call: j.call, grade: g, stakes, points: pointsFor(j.call, j.rubric.correct, stakes, g.reasoning_score) };
  });
}
