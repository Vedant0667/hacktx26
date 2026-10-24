import type { LobbyMeta } from "@/lib/db";
import { CALL_WINDOW_S } from "@/lib/scoring";
import type { DecisionPoint, LobbyPhase } from "@/lib/types";

// Server-side minimum time in each phase before the host may leave it (re-audit R2): the replay plays at
// least 1 s per lap, the call window stays open 40 s unless every player has called, the reveal shows 5 s.
export const REPLAY_S_PER_LAP = 1.0;
export const REVEAL_MIN_S = 5;

export function minPhaseSeconds(from: LobbyPhase, decision: Pick<DecisionPoint, "lap" | "replay_from_lap">, meta: Pick<LobbyMeta, "player_count" | "submitted_count">): number {
  if (from === "replay") return Math.max(0, decision.lap - decision.replay_from_lap) * REPLAY_S_PER_LAP;
  if (from === "decision") return meta.player_count > 0 && meta.submitted_count >= meta.player_count ? 0 : CALL_WINDOW_S;
  if (from === "reveal") return REVEAL_MIN_S;
  return 0;
}
