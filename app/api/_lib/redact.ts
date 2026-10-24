import type { LobbyStateResponse, RaceLobbyRaw, RaceState } from "@/lib/db";
import { currentFreeze, pastFreezeLaps, RACE_LAP_S, segment, visibleLap, type RacePhase } from "./race";

// Calls stay hidden until the reveal: before that, clients only learn who has called.
export function isRevealed(phase: string): boolean {
  return phase === "reveal" || phase === "done";
}

// Round 6: the client view of a race lobby's raw fields. segment_end_lap (where the replay will stop next,
// that is the next freeze lap) goes to the host screen only.
export function raceStateFor(raw: RaceLobbyRaw, phase: string, isHost: boolean): RaceState {
  const c = {
    phase: phase as RacePhase,
    plan: raw.freeze_plan,
    freeze_index: raw.freeze_index,
    total_laps: raw.total_laps,
    phase_elapsed_s: raw.phase_elapsed_s,
  };
  const started = phase !== "waiting" && raw.freeze_plan !== null;
  const f = currentFreeze(c);
  const seg = started ? segment(c) : { start: 1, end: raw.total_laps };
  return {
    race_key: raw.race_key,
    name: raw.name,
    total_laps: raw.total_laps,
    lap_s: RACE_LAP_S,
    freeze_count: started ? raw.freeze_plan!.length : null,
    freeze_index: raw.freeze_index,
    freeze_lap: f?.lap ?? null,
    past_freeze_laps: started ? pastFreezeLaps(c) : [],
    segment_start_lap: seg.start,
    visible_lap: started ? visibleLap(c) : 0,
    segment_end_lap: isHost && started && phase === "replay" ? seg.end : null,
    calls_needed: f ? f.drivers : null,
    called: f ? raw.called : [],
  };
}

// Strips the server-only raw race fields and adds `mode` and `race` (null for a moment lobby).
export function decorate(state: LobbyStateResponse, isHost = false): LobbyStateResponse {
  const { _race, ...rest } = state;
  return { ...rest, mode: state.mode ?? "moment", race: _race ? raceStateFor(_race, state.phase, isHost) : null };
}

export function redactForPhase(state: LobbyStateResponse, isHost = false): LobbyStateResponse {
  if (isRevealed(state.phase) && state.mode !== "race") return decorate(state, isHost);
  return redactSubmissions(state, isHost);
}

// The pre-reveal view in any phase: who has called, nothing about what or why.
export function redactSubmissions(state: LobbyStateResponse, isHost = false): LobbyStateResponse {
  return decorate(
    {
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
          verdict: null, // Round 7: the grade gives the answer away too
          credited: [],
          graded: false,
        })),
    },
    isHost,
  );
}
