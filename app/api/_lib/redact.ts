import type { LobbyStateResponse } from "@/lib/db";

// Calls stay hidden until the reveal: before that, clients only learn who has called.
export function isRevealed(phase: string): boolean {
  return phase === "reveal" || phase === "done";
}

export function redactForPhase(state: LobbyStateResponse): LobbyStateResponse {
  if (isRevealed(state.phase)) return state;
  return redactSubmissions(state);
}

// The pre-reveal view in any phase: who has called, nothing about what or why.
export function redactSubmissions(state: LobbyStateResponse): LobbyStateResponse {
  return {
    ...state,
    // Re-sorted by name: the stored order is by score, which would give the answer away.
    submissions: [...state.submissions]
      .sort((a, b) => a.player_name.localeCompare(b.player_name))
      .map((s) => ({
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
