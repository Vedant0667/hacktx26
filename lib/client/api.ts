// Browser-side fetchers for the lobby API (app/api/**) and the blind race data (GET /api/decisions/**).
import type { LobbyStateResponse } from "@/lib/db";
import { recallHostToken, recallName, recallPlayerToken } from "./identity";
import type { GroundTruthFile } from "./mode";
import type { Call, DecisionIndexEntry, DecisionPoint, LapFrame, Submission } from "@/lib/types";

export type { LobbyStateResponse };

export interface PitLoss {
  normal_s: number;
  n_stops: number;
  from: string;
}

// public/data/<id>/decision.json since the M2 fix: what the pit wall knows at the call, nothing about the answer.
export type BlindDecision = Omit<DecisionPoint, "team" | "engine" | "ground_truth" | "reveal_to_lap"> & {
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
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {}
    const ra = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, msg, Number.isFinite(ra) && ra > 0 ? ra : null);
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

export interface CampsResponse {
  submitted: number;
  by_call: { BOX: number; STAY: number; none: number };
  camps: { factor: string; count: number; players: string[]; quotes: string[] }[];
  no_factor: { count: number; players: string[]; quotes: string[] };
  // Camp names written by Muse Spark from the room's reasons; null when Muse was skipped.
  // MIXED: the camp's members made different calls.
  labels: { label: string; call: Call | "MIXED" | null; players: string[]; count: number }[] | null;
  labels_source: "muse" | "factors";
}

export interface LeaderboardRow {
  kind: "player" | "team" | "engine";
  name: string;
  lobby_code: string | null;
  call: Call | null;
  reasons: string[];
  factors_named: string[];
  seconds_to_call: number | null;
  // Null on every row until the viewer's lobby has revealed this decision.
  score_call: number | null;
  score_reasoning: number | null;
  total: number;
  percentile: number;
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

// Round 5: the post-reveal "defend your call" duel.
export interface DuelSide {
  name: string;
  driver_code: string | null;
  call: Call | null;
  summary: string;
}
export interface DuelResponse {
  source: "muse" | "fallback";
  pair: [DuelSide, DuelSide] | null;
  prompt: string | null;
  pending: boolean;
  votes: [number, number];
  my_vote: 0 | 1 | null;
}

export type JoinResponse = LobbyStateResponse & { player_token: string | null; rejoined: boolean };

const enc = encodeURIComponent;

// Player-only routes (the duel vote): the player token even when this browser also hosts.
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
    post<LobbyStateResponse & { host_token: string }>("/api/lobby", { decision_id, host_name, driver_mode, ...(driver_code ? { driver_code } : {}) }),
  // consent is the ticked checkbox; the route rejects a join without it. playerToken proves a rejoin.
  join: (code: string, name: string, consent: true, playerToken?: string | null, driver_code?: string | null) =>
    post<JoinResponse>(`/api/lobby/${enc(code)}/join`, { name, consent, ...(driver_code ? { driver_code } : {}) }, tokenHeader("x-player-token", playerToken)),
  // The token matters after the reveal: without it the server redacts the calls.
  lobby: (code: string) => request<LobbyStateResponse>(`/api/lobby/${enc(code)}`, { headers: lobbyAuth(code) }),
  phase: (code: string, phase: string, hostToken: string | null) =>
    post<LobbyStateResponse>(`/api/lobby/${enc(code)}/phase`, { phase }, tokenHeader("x-host-token", hostToken)),
  // `call` is the button the player picked; the route currently ignores it and parses the transcript.
  submit: (
    code: string,
    body: { player_name: string; transcript: string; seconds_to_call: number; call: Call | null },
    playerToken: string | null,
  ) => post<SubmitResponse>(`/api/lobby/${enc(code)}/submit`, body, tokenHeader("x-player-token", playerToken)),
  reveal: (code: string) => request<RevealResponse>(`/api/lobby/${enc(code)}/reveal`, { headers: lobbyAuth(code) }),
  duel: (code: string) => request<DuelResponse>(`/api/lobby/${enc(code)}/duel`, { headers: lobbyAuth(code) }),
  // Players only (x-player-token); the first vote counts.
  duelVote: (code: string, choice: 0 | 1) =>
    post<{ votes: [number, number]; my_vote: 0 | 1; duplicate: boolean }>(`/api/lobby/${enc(code)}/duel/vote`, { choice }, playerAuth(code)),
  // Host only: removes a player from the lobby (x-host-token).
  kick: (code: string, name: string, hostToken: string | null) =>
    post<LobbyStateResponse>(`/api/lobby/${enc(code)}/kick`, { name }, tokenHeader("x-host-token", hostToken)),
  parse: (transcript: string) => post<{ call: Call | null; factors_named: string[] }>("/api/parse", { transcript }),
  camps: (code: string) => request<CampsResponse>(`/api/lobby/${enc(code)}/camps`, { headers: lobbyAuth(code) }),
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
};

// The post-reveal data (full decision, every lap, ground truth). 409 until the lobby is in reveal or done;
// screens normally use useReveal (lib/client/useLobby.ts), which calls this once and retries.
export const revealData = (code: string) => api.reveal(code);
