import type { LobbyStateResponse } from "@/lib/db";

// Calls stay hidden until the reveal: before that, clients only learn who has called.
export function isRevealed(phase: string): boolean {
  return phase === "reveal" || phase === "done";
}

export function redactForPhase(state: LobbyStateResponse): LobbyStateResponse {
  if (isRevealed(state.phase)) return state;
  return {
    ...state,
    submissions: state.submissions.map((s) => ({
      ...s,
      call: null,
      reasons: [],
      factors_named: [],
      transcript: "",
      score_call: 0,
      score_reasoning: 0,
      total: 0,
    })),
  };
}
