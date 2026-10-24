// Scoring (Round 7, security-contract.md). One formula for every call: moment freezes, race freezes, audibles,
// and the engine and real-team rows.
//   stakes = min(100, round(swing_s × 5))      how much the call was worth in the real race
//   r      = reasoning score, an integer 0–50  graded against the decision's rubric (lib/muse/rubric.ts)
//   points = round(stakes × (0.37 × right + 0.78 × r/50 − 0.15)), right = 1 or 0
//   right 50 → 100%, wrong 50 → +60%, right 10 → +40%, right 0 → +25%, wrong 0 → −15% of stakes.
//   Great reasoning counts even when the call was wrong; at equal reasoning a right call beats a wrong one.
//   no call: 0
// Time to call is stored for display only; it never affects points or rank.
import type { Call, DecisionPoint, Score } from "./types";

// 30 s of talking (VOICE_NOTE_MAX_S) plus time to tap BOX or STAY OUT.
export const CALL_WINDOW_S = 40;
export const VOICE_NOTE_MAX_S = 30;
export const REASONING_MAX = 50;
export const STAKES_MAX = 100;
export const STAKES_PER_SECOND = 5;

// Reasoning outweighs the call: a wrong call overtakes a right one once its reasoning is ~24/50 higher.
// Right at 50/50 = 100% of stakes; right at 0 = +22%; wrong at 50/50 = +63%; wrong at 0 = -15%.
export const CALL_WEIGHT = 0.37;
export const REASONING_WEIGHT = 0.78;
export const BASE_PENALTY = 0.15;

export function stakesFor(swingS: number | null | undefined): number {
  if (swingS == null || !Number.isFinite(swingS) || swingS <= 0) return 0;
  return Math.min(STAKES_MAX, Math.round(swingS * STAKES_PER_SECOND));
}

export function clampReasoning(r: number): number {
  return Number.isFinite(r) ? Math.max(0, Math.min(REASONING_MAX, Math.round(r))) : 0;
}

// Math.round on a negative half rounds toward +inf; round the magnitude so +x and -x are symmetric.
const roundAbs = (x: number) => Math.sign(x) * Math.round(Math.abs(x));

export function pointsFor(call: Call | null, correct: Call, stakes: number, reasoning: number): number {
  if (!call || stakes <= 0) return 0;
  const right = call === correct ? 1 : 0;
  return roundAbs(stakes * (CALL_WEIGHT * right + (REASONING_WEIGHT * clampReasoning(reasoning)) / REASONING_MAX - BASE_PENALTY)) || 0;
}

// Round 9: the call scored as right. final_right_call (the luck-aware verdict, lib/luck.ts) when the data carries
// it, else the measured answer. Stakes always come from the measured swing.
export function rightCallOf(gt: { correct: Call; final_right_call?: Call }): Call {
  return gt.final_right_call ?? gt.correct;
}

// score_call holds the stakes, score_reasoning the reasoning score, total the signed points.
export function scoreCall(decision: Pick<DecisionPoint, "ground_truth">, call: Call | null, reasoning: number): Score {
  const stakes = stakesFor(decision.ground_truth.swing_s);
  const r = call ? clampReasoning(reasoning) : 0;
  return { score_call: stakes, score_reasoning: r, total: pointsFor(call, rightCallOf(decision.ground_truth), stakes, r) };
}

// Shared ranks: equal totals share a rank ("=1"), the next distinct total skips ahead (1, =2, =2, 4).
// Rows must already be sorted by total, highest first.
export function sharedRanks(totals: number[]): { rank: number; tied: boolean }[] {
  return totals.map((t) => ({ rank: totals.indexOf(t) + 1, tied: totals.filter((x) => x === t).length > 1 }));
}

export function rankLabel(r: { rank: number; tied: boolean }): string {
  return r.tied ? `=${r.rank}` : String(r.rank);
}

// Share of other players' scores at or below `total`, as a 0–100 percentile.
// `all` includes the player's own score; a lone player is 100th.
export function percentile(total: number, all: number[]): number {
  const others = [...all];
  const self = others.indexOf(total);
  if (self !== -1) others.splice(self, 1);
  if (others.length === 0) return 100;
  const atOrBelow = others.filter((s) => s <= total).length;
  return Math.round((atOrBelow / others.length) * 100);
}
