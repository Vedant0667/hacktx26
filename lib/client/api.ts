// Browser-side fetchers for the lobby API (app/api/**) and the blind race data (GET /api/decisions/**).
import type { LobbyStateResponse, RacePhase, RaceState } from "@/lib/db";
import { recallHostToken, recallName, recallPlayerToken } from "./identity";
import type { GroundTruthFile } from "./mode";
import type { Call, DecisionIndexEntry, DecisionPoint, LapFrame, Submission, TrackStatus } from "@/lib/types";

export type { LobbyStateResponse, RacePhase, RaceState };

export interface PitLoss {
  normal_s: number;
  n_stops: number;
  from: string;
}

// public/data/<id>/decision.json since the M2 fix: what the pit wall knows at the call, nothing about the answer.
// trigger: a moment is always SC or VSC; a race freeze (Round 6) can fall under green, so the client type is wider.
export type BlindDecision = Omit<DecisionPoint, "team" | "engine" | "ground_truth" | "reveal_to_lap" | "trigger"> & {
  trigger: TrackStatus;
  total_laps: number;
  pit_loss: PitLoss;
};

// GET /api/lobby/[code]/reveal: the full decision, every lap, and the measured outcome. 409 before the reveal.
export type RevealDecision = DecisionPoint & { total_laps: number; pit_loss: PitLoss };
export interface RevealResponse {
  decision: RevealDecision;
  frames: LapFrame[];
  ground_truth: GroundTruthFile;
  drivers?: Record<string, DriverReveal>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    // Seconds from the Retry-After header on a 429; null when absent.
    public retryAfter: number | null = null,
    // The parsed error body, for routes that add fields (the audible 429 carries next_lap).
    public body: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError(0, "network");
  }
  if (!res.ok) {
    let msg = res.statusText;
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
      msg = typeof body.error === "string" ? body.error : msg;
    } catch {}
    const ra = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, msg, Number.isFinite(ra) && ra > 0 ? ra : null, body);
  }
  return (await res.json()) as T;
}

const post = <T>(url: string, body: unknown, headers?: Record<string, string>) =>
  request<T>(url, { method: "POST", body: JSON.stringify(body), headers });
const tokenHeader = (name: string, token: string | null | undefined): Record<string, string> | undefined =>
  token ? { [name]: token } : undefined;

export interface SubmitResponse {
  submission: Submission;
  // Null during the decision: the score would give away the answer.
  percentile: number | null;
  lobby_rank: number | null;
  lobby_players_submitted: number | null;
  duplicate: boolean;
}

export interface LeaderboardRow {
  kind: "player" | "team" | "engine";
  name: string;
  lobby_code: string | null;
  call: Call | null;
  reasons: string[];
  factors_named: string[];
  seconds_to_call: number | null; // Round 7: always null (time to call is not part of scoring)
  // Null on every row until the viewer's lobby has revealed this decision.
  // Round 7: score_call is the call's stakes (0–100), score_reasoning the reasoning score (0–50), total signed points.
  score_call: number | null;
  score_reasoning: number | null;
  verdict?: string | null;
  total: number;
  percentile: number;
  rank?: number; // shared on equal totals
  tied?: boolean;
  rank_label?: string; // "1", "=2"
}

export interface LeaderboardResponse {
  decision_id: string;
  total_players: number;
  // Every player's total on this decision, ascending.
  totals: number[];
  // True only when `lobby` names a lobby on this decision that is in reveal or done. When false, team and
  // engine are null and player rows carry no call, reasons or factors.
  revealed: boolean;
  team: LeaderboardRow | null;
  engine: LeaderboardRow | null;
  rows: LeaderboardRow[];
}

// GET /api/decisions/<id>/drivers: the scorable cars for the picker (blind: no answer, team call or engine).
export interface BlindDriver {
  code: string;
  number: number;
  name: string;
  team: string;
  team_colour: string | null;
  blind_title: string;
}
export interface DriversResponse {
  decision_id: string;
  default_driver: string;
  drivers: BlindDriver[];
}
// Per-car reveal data, keyed by code (Round 4).
export interface DriverReveal extends Omit<BlindDriver, "blind_title"> {
  scorable: true;
  team_call: { call: Call; reasons: string[] };
  engine: { call: Call; confidence: number; reasons: string[] };
  ground_truth: { correct: Call; swing_s: number };
  ground_truth_detail?: GroundTruthFile["seconds"];
}
export type DriverMode = "same" | "choose";

// Round 7: GET /api/lobby/[code]/reveal?part=results, the one end screen. { grading: true } with empty lists
// until every call is graded; poll about every 1.5 s.
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
  name: string;
  driver_code: string | null;
  call: Call | null;
  said: string;
  right: boolean | null;
  stakes: number;
  reasoning: number;
  verdict: string | null;
  credited: string[];
  points: number;
  rank: number;
  tied: boolean;
  rank_label: string;
}
export interface ResultsResponse {
  grading: boolean;
  decision_id: string;
  race: string;
  lap: number;
  cars: ResultCar[];
  takes: ResultEntry[];
  ranking: ResultEntry[];
}

export type JoinResponse = LobbyStateResponse & { player_token: string | null; rejoined: boolean };

// ---- Race mode (security-contract.md Round 6) ----

// GET /api/races: the race picker (blind: no freeze laps, answers, team or engine calls).
export interface RaceDriver {
  code: string;
  number: number;
  name: string;
  team: string;
  team_colour: string | null;
  freeze_count: number;
}
export interface RaceEntry {
  race_key: string;
  name: string;
  total_laps: number;
  default_driver: string;
  drivers: RaceDriver[];
}

export type TriggerType = "SC" | "VSC" | "RIVAL_STOP" | "UNDERCUT" | "FAST_DEG" | "TYRE_WINDOW" | "RAIN";
// GET /api/lobby/[code]/race/freeze: one car's freeze, numbers from the end of lap - 1 only.
export interface BlindFreeze {
  driver_code: string;
  lap: number;
  blind_title: string;
  triggers: { type: TriggerType; info: string }[];
  position: number;
  compound: string | null;
  tyre_age: number;
  pit_loss: { normal_s: number; source: string };
  options: Call[];
  factors: string[];
}
export interface FreezeResponse {
  lap: number;
  freeze_index: number;
  // Every car played in this lobby; null = no call needed for that car at this lap.
  drivers: Record<string, BlindFreeze | null>;
}

export interface RaceCall {
  kind: "freeze" | "audible";
  lap: number;
  player_name: string;
  driver_code: string;
  call: Call | null;
  reasons: string[];
  factors_named: string[];
  transcript: string;
  seconds_to_call: number | null;
  status: "pending" | "scored" | "unscored" | "cancelled";
  score_call: number;
  score_reasoning: number;
  total: number;
}

export interface FreezeReveal extends BlindFreeze {
  correct: Call;
  // null with swing_deferred when the swing is measured past a later freeze in this lobby; the full reveal at done has it.
  swing_s: number | null;
  swing_deferred?: boolean;
  window: [number, number];
  comparison: { boxed: string[]; stayed: string[] };
  team_call: { call: Call; lap: number | null; reasons: string[] };
  engine: { call: Call; confidence: number; reasons: string[] };
}
export interface FreezeRevealResponse {
  lap: number;
  drivers: Record<string, FreezeReveal | null>;
  calls: RaceCall[];
}
export interface RaceRevealResponse {
  race_key: string;
  frames: LapFrame[];
  freezes: { lap: number; drivers: Record<string, (FreezeReveal & { detail?: unknown }) | null> }[];
  calls: RaceCall[];
}
export interface RaceFramesResponse {
  visible_lap: number;
  frames: LapFrame[];
}
export interface RaceRow {
  kind: "player" | "team" | "engine";
  name: string;
  driver_code: string | null;
  lobby_code: string | null;
  total: number;
  freezes: { lap: number; call: Call | null; score_call: number; score_reasoning: number; total: number }[];
  audibles: { lap: number; status: RaceCall["status"]; total: number }[];
}
export interface RaceLeaderboardResponse {
  race_key: string;
  revealed_laps: number[];
  done: boolean;
  rows: RaceRow[];
}
export interface AudibleResponse {
  audible: RaceCall;
  next_lap: number;
}

const enc = encodeURIComponent;

// Player-only routes (audibles): the player token even when this browser also hosts.
function playerAuth(code: string): Record<string, string> | undefined {
  const name = recallName(code);
  const player = name ? recallPlayerToken(code, name) : null;
  return player ? { "x-player-token": player } : undefined;
}

// /reveal and leaderboard?lobby= need proof this device is in the lobby: the host token if it holds one,
// otherwise the player token for the name it joined as.
function lobbyAuth(code: string | null | undefined): Record<string, string> | undefined {
  if (!code) return undefined;
  const host = recallHostToken(code);
  if (host) return { "x-host-token": host };
  const name = recallName(code);
  const player = name ? recallPlayerToken(code, name) : null;
  return player ? { "x-player-token": player } : undefined;
}

export const api = {
  // host_token comes back once; keep it (identity.rememberHostToken) to advance phases.
  createLobby: (decision_id: string, host_name: string, driver_mode: DriverMode = "same", driver_code?: string | null) =>
    post<LobbyStateResponse & { host_token: string }>("/api/lobby", { decision_id, ...(host_name ? { host_name } : {}), driver_mode, ...(driver_code ? { driver_code } : {}) }),
  // consent is the ticked checkbox; the route rejects a join without it. playerToken proves a rejoin.
  join: (code: string, name: string, consent: true, playerToken?: string | null, driver_code?: string | null) =>
    post<JoinResponse>(`/api/lobby/${enc(code)}/join`, { name, consent, ...(driver_code ? { driver_code } : {}) }, tokenHeader("x-player-token", playerToken)),
  // The token matters after the reveal: without it the server redacts the calls.
  lobby: (code: string) => request<LobbyStateResponse>(`/api/lobby/${enc(code)}`, { headers: lobbyAuth(code) }),
  // freeze_index (race lobbies): the loop this click belongs to; a stale one gets 409.
  phase: (code: string, phase: string, hostToken: string | null, freezeIndex?: number) =>
    post<LobbyStateResponse>(`/api/lobby/${enc(code)}/phase`, { phase, ...(freezeIndex != null ? { freeze_index: freezeIndex } : {}) }, tokenHeader("x-host-token", hostToken)),
  // `call` is the button the player picked; the route currently ignores it and parses the transcript.
  submit: (
    code: string,
    body: { player_name: string; transcript: string; seconds_to_call: number; call: Call | null },
    playerToken: string | null,
  ) => post<SubmitResponse>(`/api/lobby/${enc(code)}/submit`, body, tokenHeader("x-player-token", playerToken)),
  reveal: (code: string) => request<RevealResponse>(`/api/lobby/${enc(code)}/reveal`, { headers: lobbyAuth(code) }),
  results: (code: string) => request<ResultsResponse>(`/api/lobby/${enc(code)}/reveal?part=results`, { headers: lobbyAuth(code) }),
  // Host only: removes a player from the lobby (x-host-token).
  kick: (code: string, name: string, hostToken: string | null) =>
    post<LobbyStateResponse>(`/api/lobby/${enc(code)}/kick`, { name }, tokenHeader("x-host-token", hostToken)),
  // Race mode (Round 6). Host token on this browser if it holds one, else the player token.
  createRaceLobby: (race_key: string, driver_mode: DriverMode = "same", driver_code?: string | null) =>
    post<LobbyStateResponse & { host_token: string }>("/api/lobby", { mode: "race", race_key, driver_mode, ...(driver_code ? { driver_code } : {}) }),
  raceFrames: (code: string, from: number) =>
    request<RaceFramesResponse>(`/api/lobby/${enc(code)}/race/frames?from=${Math.max(1, Math.floor(from))}`, { headers: lobbyAuth(code) }),
  raceFreeze: (code: string) => request<FreezeResponse>(`/api/lobby/${enc(code)}/race/freeze`, { headers: lobbyAuth(code) }),
  freezeReveal: (code: string, lap: number) => request<FreezeRevealResponse>(`/api/lobby/${enc(code)}/race/reveal?lap=${lap}`, { headers: lobbyAuth(code) }),
  raceReveal: (code: string) => request<RaceRevealResponse>(`/api/lobby/${enc(code)}/race/reveal`, { headers: lobbyAuth(code) }),
  // Player only: the token names the player and the car. 429 carries next_lap in ApiError.body.
  audible: (code: string, transcript: string) =>
    post<AudibleResponse>(`/api/lobby/${enc(code)}/audible`, { call: "BOX", ...(transcript ? { transcript } : {}) }, playerAuth(code)),
  raceLeaderboard: (raceKey: string, lobby?: string | null) =>
    request<RaceLeaderboardResponse>(`/api/leaderboard?race_key=${enc(raceKey)}${lobby ? `&lobby=${enc(lobby)}` : ""}`, { headers: lobbyAuth(lobby) }),
  parse: (transcript: string) => post<{ call: Call | null; factors_named: string[] }>("/api/parse", { transcript }),
  // Pass the viewer's lobby: team, engine and calls come back only once that lobby has revealed.
  leaderboard: (decisionId: string, lobby?: string | null) =>
    request<LeaderboardResponse>(`/api/leaderboard?decision_id=${enc(decisionId)}${lobby ? `&lobby=${enc(lobby)}` : ""}`, {
      headers: lobbyAuth(lobby),
    }),
};

const staticCache = new Map<string, Promise<unknown>>();
function staticJson<T>(path: string): Promise<T> {
  let p = staticCache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = request<T>(path, { cache: "force-cache" });
    p.catch(() => staticCache.delete(path));
    staticCache.set(path, p);
  }
  return p;
}

export const data = {
  index: async () => {
    const raw = await staticJson<DecisionIndexEntry[] | { decision_points: DecisionIndexEntry[] }>("/api/decisions");
    return Array.isArray(raw) ? raw : raw.decision_points;
  },
  // Blind: no team, engine or answer. Frames stop at the call-moment lap. The rest comes from api.reveal.
  decision: (id: string) => staticJson<BlindDecision>(`/api/decisions/${enc(id)}`),
  frames: (id: string) => staticJson<LapFrame[]>(`/api/decisions/${enc(id)}/frames`),
  // Scorable cars for the driver picker (Round 4).
  drivers: (id: string) => staticJson<DriversResponse>(`/api/decisions/${enc(id)}/drivers`),
  // Race picker (Round 6): races with the cars that get at least one freeze.
  races: () => staticJson<RaceEntry[]>("/api/races"),
};

// The post-reveal data (full decision, every lap, ground truth). 409 until the lobby is in reveal or done;
// screens normally use useReveal (lib/client/useLobby.ts), which calls this once and retries.
export const revealData = (code: string) => api.reveal(code);
