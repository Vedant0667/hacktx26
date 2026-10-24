// End-screen arithmetic, client side. The server sends each call's stakes, reasoning score and signed points;
// this splits the points into the call part and the reasoning part with the weights in lib/scoring.ts, so
// a row can read "Right call +20 · Reasoning 27/50 +31 = +51". The two parts always add up to the points shown.
import { BASE_PENALTY, CALL_WEIGHT, REASONING_MAX, REASONING_WEIGHT, sharedRanks } from "@/lib/scoring";
import type { RankRow } from "./api";

// Same symmetric rounding as lib/scoring.ts, so +x and -x round alike.
const roundAbs = (x: number) => Math.sign(x) * Math.round(Math.abs(x)) || 0;

export interface Split {
  right: boolean;
  call: number; // stakes × (CALL_WEIGHT × right − BASE_PENALTY), rounded
  reasoning: number; // the rest of the points: stakes × REASONING_WEIGHT × r / 50 after rounding
  r: number;
  total: number;
}

export function splitPoints(stakes: number, right: boolean, r: number, total: number): Split {
  const call = stakes > 0 ? roundAbs(stakes * (CALL_WEIGHT * (right ? 1 : 0) - BASE_PENALTY)) : 0;
  return { right, call, reasoning: total - call, r, total };
}

// Percent of the stakes, for the one-line rule: right call, wrong call, best reasoning.
export const WEIGHTS = {
  right: Math.round((CALL_WEIGHT - BASE_PENALTY) * 100),
  wrong: Math.round(-BASE_PENALTY * 100),
  reasoning: Math.round(REASONING_WEIGHT * 100),
  reasoningMax: REASONING_MAX,
};

// Ranks among human players only. Engine and the real team are benchmarks: no rank, no "wins".
export type PlayerRank = { rank: number; tied: boolean; of: number };
export function playerRanks(ranking: RankRow[]): Map<string, PlayerRank> {
  const players = ranking.filter((r) => r.kind === "player").sort((a, b) => b.points - a.points);
  const ranks = sharedRanks(players.map((p) => p.points));
  return new Map(players.map((p, i) => [p.name, { ...ranks[i], of: players.length }]));
}

export const rankText = (r: { rank: number; tied: boolean }) => `${r.tied ? "=" : ""}${r.rank}`;
