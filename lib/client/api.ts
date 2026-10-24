// Browser-side fetchers for the lobby API (app/api/**) and the static race data (public/data/**).
import type { LobbyStateResponse } from "@/lib/db";
import type { Call, DecisionIndexEntry, DecisionPoint, LapFrame, Submission } from "@/lib/types";

export type { LobbyStateResponse };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

const post = <T>(url: string, body: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body) });

export interface SubmitResponse {
  submission: Submission;
  percentile: number;
  lobby_rank: number;
  lobby_players_submitted: number;
  duplicate: boolean;
}

export interface CampsResponse {
  submitted: number;
  by_call: { BOX: number; STAY: number; none: number };
  camps: { factor: string; count: number; players: string[]; quotes: string[] }[];
  no_factor: { count: number; players: string[]; quotes: string[] };
}

export interface LeaderboardRow {
  kind: "player" | "team" | "engine";
  name: string;
  lobby_code: string | null;
  call: Call | null;
  reasons: string[];
  factors_named: string[];
  seconds_to_call: number | null;
  score_call: number;
  score_reasoning: number;
  total: number;
  percentile: number;
}

export interface LeaderboardResponse {
  decision_id: string;
  total_players: number;
  // Every player's total on this decision, ascending.
  totals: number[];
  team: LeaderboardRow;
  engine: LeaderboardRow;
  rows: LeaderboardRow[];
}

const enc = encodeURIComponent;

export const api = {
  createLobby: (decision_id: string, host_name: string) => post<LobbyStateResponse>("/api/lobby", { decision_id, host_name }),
  join: (code: string, name: string) => post<LobbyStateResponse>(`/api/lobby/${enc(code)}/join`, { name }),
  lobby: (code: string) => request<LobbyStateResponse>(`/api/lobby/${enc(code)}`),
  phase: (code: string, phase: string) => post<LobbyStateResponse>(`/api/lobby/${enc(code)}/phase`, { phase }),
  // `call` is the button the player picked; the route currently ignores it and parses the transcript.
  submit: (code: string, body: { player_name: string; transcript: string; seconds_to_call: number; call: Call | null }) =>
    post<SubmitResponse>(`/api/lobby/${enc(code)}/submit`, body),
  parse: (transcript: string) => post<{ call: Call | null; factors_named: string[] }>("/api/parse", { transcript }),
  camps: (code: string) => request<CampsResponse>(`/api/lobby/${enc(code)}/camps`),
  leaderboard: (decisionId: string) => request<LeaderboardResponse>(`/api/leaderboard?decision_id=${enc(decisionId)}`),
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
    const raw = await staticJson<DecisionIndexEntry[] | { decision_points: DecisionIndexEntry[] }>("/data/index.json");
    return Array.isArray(raw) ? raw : raw.decision_points;
  },
  decision: (id: string) => staticJson<DecisionPoint>(`/data/${enc(id)}/decision.json`),
  frames: (id: string) => staticJson<LapFrame[]>(`/data/${enc(id)}/frames.json`),
};
