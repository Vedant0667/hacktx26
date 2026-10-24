// Scoring rules from docs/05-build-plan.md: call 100, reasoning 0–50 (factors the player named, out of the decision's factor list).
import type { Call, DecisionPoint, Score } from "./types";

export const CALL_WINDOW_S = 20;
export const CALL_POINTS = 100;
export const REASONING_MAX = 50;

export function scoreCall(decision: DecisionPoint, call: Call | null, factorsNamed: string[]): Score {
  const score_call = call === decision.ground_truth.correct ? CALL_POINTS : 0;
  const valid = new Set(decision.factors);
  const named = new Set(factorsNamed.filter((f) => valid.has(f)));
  const perFactor = REASONING_MAX / Math.min(decision.factors.length, 4);
  const score_reasoning = call ? Math.min(REASONING_MAX, Math.round(named.size * perFactor)) : 0;
  return { score_call, score_reasoning, total: score_call + score_reasoning };
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
