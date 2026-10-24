// Shared contracts. public/data/<id>/{decision,frames}.json are written by engine/build.py.

export type Call = "BOX" | "STAY";
export type TrackStatus = "GREEN" | "SC" | "VSC";

export interface DecisionPoint {
  id: string;
  race: string;
  // Neutral title without race or team names, in case the race is hidden until the reveal.
  blind_title?: string;
  lap: number;
  trigger: "SC" | "VSC";
  player_role: { team: string; driver: string; number: number };
  options: Call[];
  replay_from_lap: number;
  reveal_to_lap: number;
  // swing_s: mean seconds the winning call gained vs nearby cars (±3 positions at the decision lap) that made the other call.
  ground_truth: { correct: Call; swing_s: number };
  factors: string[];
  team: { call: Call; reasons: string[] };
  engine: { call: Call; confidence: number; reasons: string[] };
}

export interface DriverFrame {
  code: string;
  number: number;
  team: string;
  team_colour: string | null;
  position: number;
  gap_to_leader_s: number | null;
  compound: string | null;
  tyre_age: number | null;
  pitted_this_lap: boolean;
  // This driver's time for this lap in seconds (the call-moment frame carries lap L-1's time).
  lap_time_s: number | null;
}

export interface LapFrame {
  lap: number;
  track_status: TrackStatus;
  drivers: DriverFrame[];
}

export interface DecisionIndexEntry {
  id: string;
  race: string;
  lap: number;
  title: string;
}

// What the voice layer returns for one spoken (or typed) call.
export interface ParsedCall {
  call: Call | null;
  reasons: string[];
  factors_named: string[];
  transcript: string;
}

export interface Score {
  score_call: number;
  score_reasoning: number;
  total: number;
}

export interface Submission extends Score {
  lobby_code: string;
  player_name: string;
  decision_id: string;
  call: Call | null;
  reasons: string[];
  factors_named: string[];
  transcript: string;
  seconds_to_call: number;
}

export type LobbyPhase = "waiting" | "replay" | "decision" | "reveal" | "done";

export interface LobbyState {
  code: string;
  decision_id: string;
  phase: LobbyPhase;
  // Server time (ms) when the current phase started; clients derive the replay clock from it.
  phase_started_at: number;
  players: { name: string; joined_at: number }[];
  submissions: Submission[];
}
