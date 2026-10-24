// Race mode (docs/09-race-mode.md, security-contract.md Round 6): pure rules, no I/O, unit-tested in
// scripts/test-race.ts. Routes load the data and call these.
import { callMomentFrame, type AudibleTruth, type BlindFreeze, type FullFreeze, type RaceFreeze } from "@/lib/data";
import { buildRubric, rubricScore, type Rubric } from "@/lib/muse/rubric";
import { CALL_WINDOW_S, pointsFor, stakesFor } from "@/lib/scoring";
import type { FreezePlanEntry } from "@/lib/db";
import type { DecisionPoint, LapFrame } from "@/lib/types";
import { REVEAL_MIN_S } from "./phases";

export type RacePhase = "waiting" | "replay" | "freeze" | "reveal_freeze" | "done";
export const RACE_PHASES: RacePhase[] = ["waiting", "replay", "freeze", "reveal_freeze", "done"];

// Seconds of replay per lap. The server clock, the frames horizon and the minimum replay time all use it,
// so the client must play at exactly this rate from phase_started_at.
export const RACE_LAP_S = 1.2;
export const AUDIBLE_GAP_LAPS = 5; // one audible per player per 5 laps
export const AUDIBLE_CANCEL_LAPS = 2; // an audible this close to a freeze for the same car is cancelled
export const AUDIBLE_FACTORS = ["tyre_age", "similar_cars_pitted", "track_position"];

export type { FreezePlanEntry } from "@/lib/db";

// Union of the lobby cars' freezes. Freezes on the same lap merge. A freeze that falls inside an earlier kept
// freeze's answer window (laps it reveals: its BOX window) is dropped, so a freeze reveal never shows stops
// that a later freeze in the same lobby would be called on.
// Last lap a freeze's swing is measured over (the swing can run to the flag). The reveal holds the swing
// back until "done" when a later freeze in the plan falls inside this span.
export function measuredTo(f: { full: { window: number[]; detail?: { end_lap?: number | null } } }): number {
  return Math.max(f.full.window[1], f.full.detail?.end_lap ?? 0);
}

export function buildFreezePlan(freezes: Pick<RaceFreeze, "driver_code" | "lap" | "full">[], cars: string[]): FreezePlanEntry[] {
  const mine = freezes
    .filter((f) => cars.includes(f.driver_code))
    .sort((a, b) => a.lap - b.lap || a.driver_code.localeCompare(b.driver_code));
  const plan: FreezePlanEntry[] = [];
  let horizon = 0;
  for (const f of mine) {
    const last = plan[plan.length - 1];
    if (last && f.lap === last.lap) {
      if (!last.drivers.includes(f.driver_code)) last.drivers.push(f.driver_code);
      horizon = Math.max(horizon, f.full.window[1]);
    } else if (f.lap > horizon) {
      plan.push({ lap: f.lap, drivers: [f.driver_code] });
      horizon = Math.max(f.lap, f.full.window[1]);
    }
  }
  return plan;
}

export interface RaceClock {
  phase: RacePhase;
  plan: FreezePlanEntry[] | null;
  freeze_index: number;
  total_laps: number;
  phase_elapsed_s: number;
}

// The replay segment the lobby is in (or, in freeze/reveal_freeze, the one that just ended).
export function segment(c: Pick<RaceClock, "plan" | "freeze_index" | "total_laps">): { start: number; end: number } {
  const plan = c.plan ?? [];
  const start = c.freeze_index === 0 ? 1 : plan[c.freeze_index - 1].lap;
  const end = c.freeze_index < plan.length ? plan[c.freeze_index].lap - 1 : c.total_laps;
  return { start, end };
}

export function currentFreeze(c: Pick<RaceClock, "phase" | "plan" | "freeze_index">): FreezePlanEntry | null {
  if (c.phase !== "freeze" && c.phase !== "reveal_freeze") return null;
  return c.plan?.[c.freeze_index] ?? null;
}

// Freezes whose answer is out: before the current index, plus the current one from reveal_freeze, all at done.
export function revealedLaps(c: Pick<RaceClock, "phase" | "plan" | "freeze_index">): number[] {
  const plan = c.plan ?? [];
  if (c.phase === "done") return plan.map((p) => p.lap);
  const n = c.phase === "reveal_freeze" ? c.freeze_index + 1 : c.freeze_index;
  return plan.slice(0, n).map((p) => p.lap);
}

// Round 7: freezes whose answer (right call, swing, scores) may be shown: none until the flag, all at done.
export function answerLaps(c: Pick<RaceClock, "phase" | "plan">): number[] {
  return c.phase === "done" ? (c.plan ?? []).map((p) => p.lap) : [];
}

export function pastFreezeLaps(c: Pick<RaceClock, "phase" | "plan" | "freeze_index">): number[] {
  return revealedLaps(c);
}

// The last lap whose frame the server hands out now. In freeze and reveal_freeze that is the call-moment
// frame of the freeze lap (laps before it are real).
export function visibleLap(c: RaceClock): number {
  if (c.phase === "waiting") return 0;
  if (c.phase === "done") return c.total_laps;
  const f = currentFreeze(c);
  if (f) return f.lap;
  const { start, end } = segment(c);
  return Math.min(end, start + Math.max(0, Math.floor(c.phase_elapsed_s / RACE_LAP_S)));
}

export function nextRacePhase(phase: RacePhase, freezeIndex: number, planLength: number): RacePhase | null {
  switch (phase) {
    case "waiting":
      return "replay";
    case "replay":
      return freezeIndex < planLength ? "freeze" : "done";
    case "freeze":
      return "reveal_freeze";
    case "reveal_freeze":
      return "replay";
    default:
      return null;
  }
}

// Minimum seconds in the current phase before the host may leave it (same idea as R2c).
export function minRaceSeconds(c: RaceClock, progress: { needed: number; called: number }): number {
  if (c.phase === "replay") {
    const { start, end } = segment(c);
    return Math.round((end - start + 1) * RACE_LAP_S * 10) / 10;
  }
  if (c.phase === "freeze") return progress.needed === 0 || progress.called >= progress.needed ? 0 : CALL_WINDOW_S;
  if (c.phase === "reveal_freeze") return REVEAL_MIN_S;
  return 0;
}

// Frames for laps from..visible: real frames up to the server clock; at a freeze, laps before it plus the
// call-moment frame (no stop on the freeze lap shown for any car, Round 4.8); everything at done.
export function framesFor(all: LapFrame[], c: RaceClock, from = 1): LapFrame[] {
  const v = visibleLap(c);
  if (v === 0) return [];
  const f = currentFreeze(c);
  if (f) {
    const real = all.filter((x) => x.lap >= from && x.lap < f.lap);
    return f.lap >= from ? [...real, callMomentFrame(all, f.lap, null)] : real;
  }
  return all.filter((x) => x.lap >= from && x.lap <= v);
}

// ---- Audibles ----

// Allowed when no other audible by this player is within AUDIBLE_GAP_LAPS - 1 laps. next_lap: the first lap allowed.
export function audibleAllowed(previousLaps: number[], lap: number): { ok: boolean; next_lap: number } {
  const blocking = previousLaps.filter((l) => Math.abs(l - lap) < AUDIBLE_GAP_LAPS);
  if (!blocking.length) return { ok: true, next_lap: lap + AUDIBLE_GAP_LAPS };
  return { ok: false, next_lap: Math.max(...blocking) + AUDIBLE_GAP_LAPS };
}

export interface AudibleScore {
  status: "scored" | "unscored" | "cancelled";
  score_call: number; // Round 7: the stakes, from the audible's own measured swing
  score_reasoning: number;
  total: number;
  factors_named: string[];
  verdict: string | null;
}

// The rubric for a BOX audible: a green-flag call on tyre life, what nearby cars did and track position.
export function audibleRubric(car: string, lap: number, truth: AudibleTruth): Rubric {
  return buildRubric({
    decision_id: `audible-L${lap}-${car}`, factors: AUDIBLE_FACTORS, correct: truth.correct ?? "BOX",
    swing_s: truth.swing_s ?? 0, trigger: "GREEN", facts: { comparison: { boxed: truth.n_box, stayed: truth.n_stay } },
  });
}

// A BOX audible on `lap` for `car`: cancelled within 2 laps of one of that car's freezes in this lobby,
// unscored without a comparison split (0), otherwise the Round 7 formula on its own swing, with the
// deterministic rubric grade (the reveal grading may replace it with a Muse grade). Never from the engine's model.
export function scoreAudible(
  lap: number,
  car: string,
  plan: FreezePlanEntry[],
  truth: AudibleTruth | null,
  transcript: string,
): AudibleScore {
  const none = { score_call: 0, score_reasoning: 0, total: 0, factors_named: [], verdict: null };
  if (plan.some((p) => p.drivers.includes(car) && Math.abs(p.lap - lap) <= AUDIBLE_CANCEL_LAPS)) return { status: "cancelled", ...none };
  if (!truth || !truth.scorable || !truth.correct) return { status: "unscored", ...none };
  const g = rubricScore(audibleRubric(car, lap, truth), transcript);
  const stakes = stakesFor(truth.swing_s);
  return {
    status: "scored", score_call: stakes, score_reasoning: g.reasoning_score,
    total: pointsFor("BOX", truth.correct, stakes, g.reasoning_score), factors_named: g.credited, verdict: g.verdict,
  };
}

// ---- Freezes as decisions (for Muse grading and scoreCall) ----

// A DecisionPoint view of one car's freeze, so parseCall and scoreCall work unchanged. trigger is only a
// label for those helpers (they read id, factors and ground_truth); green-flag freezes are typed as "SC".
export function freezeDecision(raceKey: string, raceName: string, f: { blind: BlindFreeze; full: FullFreeze }): DecisionPoint {
  const types = f.blind.triggers.map((t) => t.type);
  return {
    id: `race-${raceKey}-L${f.blind.lap}-${f.blind.driver_code}`,
    race: raceName,
    blind_title: f.blind.blind_title,
    lap: f.blind.lap,
    trigger: types.includes("VSC") ? "VSC" : "SC",
    player_role: { team: "", driver: f.blind.driver_code, number: 0 },
    options: ["BOX", "STAY"],
    replay_from_lap: 1,
    reveal_to_lap: f.full.window[1],
    ground_truth: { correct: f.full.correct, swing_s: f.full.swing_s },
    factors: f.blind.factors,
    team: { call: f.full.team_call.call, reasons: f.full.team_call.reasons },
    engine: f.full.engine,
  };
}

// What a freeze reveal may show for one car: no pair-by-pair gaps or lap times after the window.
export function freezeReveal(f: { blind: BlindFreeze; full: FullFreeze }) {
  const { correct, swing_s, window, comparison, team_call, engine } = f.full;
  return {
    ...f.blind,
    correct,
    swing_s,
    window,
    comparison: { boxed: comparison.boxed, stayed: comparison.stayed },
    team_call,
    engine,
  };
}

export type FreezeRevealView = ReturnType<typeof freezeReveal>;

const DRY = ["SOFT", "MEDIUM", "HARD"];

// The rubric for one car's freeze, from the race data only (no engine fields): position, tyres, laps left,
// whether a stop is still owed, pit loss, the comparison cars and the measured answer. A car whose tyres are
// older than the laps run has not stopped yet; in a dry race it still owes a stop (two compounds).
export function freezeRubric(raceKey: string, f: { blind: BlindFreeze; full: FullFreeze }, totalLaps: number | null): Rubric {
  const types = f.blind.triggers.map((t) => t.type);
  const b = f.blind;
  return buildRubric({
    decision_id: `race-${raceKey}-L${f.blind.lap}-${f.blind.driver_code}`,
    factors: f.blind.factors,
    correct: f.full.correct,
    swing_s: f.full.swing_s,
    trigger: types.includes("SC") ? "SC" : types.includes("VSC") ? "VSC" : "GREEN",
    facts: {
      position: b.position, compound: b.compound, tyre_age: b.tyre_age,
      laps_left: totalLaps != null ? Math.max(0, totalLaps - b.lap) : null,
      stopped_yet: b.compound && DRY.includes(b.compound.toUpperCase()) ? b.tyre_age + 1 < b.lap : null,
      pit_loss_green_s: b.pit_loss?.normal_s ?? null,
      comparison: { boxed: f.full.comparison.boxed.length, stayed: f.full.comparison.stayed.length },
    },
  });
}

// The race clock from a lobby's meta row.
export function clockOf(meta: { phase: string; freeze_plan: FreezePlanEntry[] | null; freeze_index: number; total_laps: number | null; phase_elapsed_s: number }): RaceClock {
  return {
    phase: meta.phase as RacePhase,
    plan: meta.freeze_plan,
    freeze_index: meta.freeze_index,
    total_laps: meta.total_laps ?? 0,
    phase_elapsed_s: meta.phase_elapsed_s,
  };
}

// A race call as clients may see it: scores hidden until revealed (freeze calls at their reveal, audibles at done).
export function presentCall<T extends { kind: "freeze" | "audible"; lap: number; status: string; score_call: number; score_reasoning: number; total: number }>(
  c: T,
  revealed: number[],
  done: boolean,
): T {
  const open = c.kind === "freeze" ? revealed.includes(c.lap) : done;
  if (open) return c;
  // Round 7: the verdict and credited ideas are part of the grade and stay hidden with the scores.
  const extra = "verdict" in c ? { verdict: null, credited: [], factors_named: [] } : {};
  return { ...c, ...extra, status: c.kind === "audible" ? "pending" : c.status, score_call: 0, score_reasoning: 0, total: 0 };
}
