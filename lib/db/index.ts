// Neon (Postgres over HTTP) client and typed queries for lobbies, players and submissions.
// Schema: db/schema.sql. Timestamps are returned as epoch milliseconds.
import { neon, NeonDbError } from "@neondatabase/serverless";
import type { LobbyPhase, LobbyState, Submission } from "../types";

let client: ReturnType<typeof neon> | null = null;

function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql().query(text, params)) as T[];
}

export const PHASES: LobbyPhase[] = ["waiting", "replay", "decision", "reveal", "done"];

// LobbyState plus the server clock (ms), taken from the same now() that sets phase_started_at.
export type LobbyStateResponse = LobbyState & { now: number };

const ms = (col: string) => `round(extract(epoch from ${col}) * 1000)::float8`;

const SUBMISSION_JSON = `json_build_object(
  'lobby_code', s.lobby_code, 'player_name', s.player_name, 'decision_id', s.decision_id,
  'call', s.call, 'reasons', s.reasons, 'factors_named', s.factors_named, 'transcript', s.transcript,
  'seconds_to_call', s.seconds_to_call, 'score_call', s.score_call, 'score_reasoning', s.score_reasoning,
  'total', s.total)`;

const SUBMISSION_COLS = `lobby_code, player_name, decision_id, call, reasons, factors_named, transcript,
  seconds_to_call, score_call, score_reasoning, total`;

// Players best first; ties go to the faster call, then the earlier row.
const SUBMISSION_ORDER = "s.total desc, s.seconds_to_call asc, s.created_at asc";

function isPgError(err: unknown, code: string): boolean {
  return err instanceof NeonDbError ? err.code === code : (err as { code?: string })?.code === code;
}

// Returns false if the code is already taken (caller retries with a new code).
// The host runs the shared screen and is not a player; players join from their phones.
export async function createLobby(code: string, decisionId: string): Promise<boolean> {
  const rows = await query<{ code: string }>(
    `insert into lobbies (code, decision_id) values ($1, $2) on conflict (code) do nothing returning code`,
    [code, decisionId],
  );
  return rows.length === 1;
}

// One round trip: lobby, players, this decision's submissions, and the DB clock.
export async function getLobbyState(code: string): Promise<LobbyStateResponse | null> {
  const rows = await query<LobbyStateResponse>(
    `select l.code, l.decision_id, l.phase,
       ${ms("l.phase_started_at")} as phase_started_at,
       ${ms("now()")} as now,
       coalesce((select json_agg(json_build_object('name', p.name, 'joined_at', ${ms("p.joined_at")})
                   order by p.joined_at, p.name)
                 from players p where p.lobby_code = l.code), '[]'::json) as players,
       coalesce((select json_agg(${SUBMISSION_JSON} order by ${SUBMISSION_ORDER})
                 from submissions s where s.lobby_code = l.code and s.decision_id = l.decision_id),
                '[]'::json) as submissions
     from lobbies l where l.code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

export async function addPlayer(code: string, name: string): Promise<"ok" | "taken" | "no_lobby"> {
  try {
    const rows = await query(
      `insert into players (lobby_code, name) values ($1, $2)
       on conflict (lobby_code, name) do nothing returning name`,
      [code, name],
    );
    return rows.length === 1 ? "ok" : "taken";
  } catch (err) {
    if (isPgError(err, "23503")) return "no_lobby"; // foreign key: lobby does not exist
    throw err;
  }
}

export async function getLobbyMeta(
  code: string,
  playerName?: string,
): Promise<{ decision_id: string; phase: LobbyPhase; is_player: boolean; phase_elapsed_s: number } | null> {
  const rows = await query<{ decision_id: string; phase: LobbyPhase; is_player: boolean; phase_elapsed_s: number }>(
    `select l.decision_id, l.phase,
       extract(epoch from now() - l.phase_started_at)::float8 as phase_elapsed_s,
       exists(select 1 from players p where p.lobby_code = l.code and p.name = $2) as is_player
     from lobbies l where l.code = $1`,
    [code, playerName ?? ""],
  );
  return rows[0] ?? null;
}

// Compare-and-set so two hosts clicking at once cannot skip a phase.
export async function advancePhase(code: string, from: LobbyPhase, to: LobbyPhase): Promise<boolean> {
  const rows = await query(
    `update lobbies set phase = $3, phase_started_at = now()
     where code = $1 and phase = $2 returning code`,
    [code, from, to],
  );
  return rows.length === 1;
}

// First submission wins: a re-submit returns the stored row with duplicate = true.
export async function insertSubmission(s: Submission): Promise<{ submission: Submission; duplicate: boolean }> {
  const inserted = await query<{ row: Submission }>(
    `insert into submissions as s (${SUBMISSION_COLS})
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11)
     on conflict (lobby_code, player_name, decision_id) do nothing
     returning ${SUBMISSION_JSON} as row`,
    [
      s.lobby_code, s.player_name, s.decision_id, s.call,
      JSON.stringify(s.reasons), JSON.stringify(s.factors_named), s.transcript,
      s.seconds_to_call, s.score_call, s.score_reasoning, s.total,
    ],
  );
  if (inserted.length === 1) return { submission: inserted[0].row, duplicate: false };
  const existing = await query<{ row: Submission }>(
    `select ${SUBMISSION_JSON} as row from submissions s
     where s.lobby_code = $1 and s.player_name = $2 and s.decision_id = $3`,
    [s.lobby_code, s.player_name, s.decision_id],
  );
  return { submission: existing[0].row, duplicate: true };
}

// Totals for percentile (every lobby) and lobby rank (this lobby) on one decision.
export async function getTotals(decisionId: string, lobbyCode: string): Promise<{ global: number[]; lobby: number[] }> {
  const rows = await query<{ global: number[]; lobby: number[] }>(
    `select
       coalesce((select json_agg(total) from submissions s where s.decision_id = $1 and exists (select 1 from lobbies l where l.code = s.lobby_code and l.phase in ('reveal','done'))), '[]'::json) as global,
       coalesce((select json_agg(total) from submissions where decision_id = $1 and lobby_code = $2), '[]'::json) as lobby`,
    [decisionId, lobbyCode],
  );
  return rows[0];
}

export async function getDecisionTotals(decisionId: string): Promise<number[]> {
  const rows = await query<{ totals: number[] }>(
    `select coalesce(json_agg(total), '[]'::json) as totals from submissions s where s.decision_id = $1 and exists (select 1 from lobbies l where l.code = s.lobby_code and l.phase in ('reveal','done'))`,
    [decisionId],
  );
  return rows[0].totals;
}

export async function topSubmissions(decisionId: string, limit = 50): Promise<Submission[]> {
  const rows = await query<{ row: Submission }>(
    `select ${SUBMISSION_JSON} as row from submissions s
     where s.decision_id = $1 and exists (select 1 from lobbies l where l.code = s.lobby_code and l.phase in ('reveal','done')) order by ${SUBMISSION_ORDER} limit $2`,
    [decisionId, limit],
  );
  return rows.map((r) => r.row);
}

// ---- Muse Spark spend log and camp cache (tables muse_calls, muse_camps) ----

export interface MuseCallLog {
  purpose: string;
  lobby_code: string | null;
  decision_id: string | null;
  model: string;
  ok: boolean;
  status: string | null;
  error: string | null;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cost_usd: number;
  latency_ms: number;
}

export async function logMuseCall(c: MuseCallLog): Promise<void> {
  await query(
    `insert into muse_calls (purpose, lobby_code, decision_id, model, ok, status, error,
       input_tokens, cached_tokens, output_tokens, reasoning_tokens, cost_usd, latency_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      c.purpose, c.lobby_code, c.decision_id, c.model, c.ok, c.status, c.error?.slice(0, 500) ?? null,
      c.input_tokens, c.cached_tokens, c.output_tokens, c.reasoning_tokens, c.cost_usd, c.latency_ms,
    ],
  );
}

// Total calls and spend across every lobby, plus calls made for one lobby (0 when none given).
export async function getMuseSpend(lobbyCode?: string | null): Promise<{ calls: number; cost_usd: number; lobby_calls: number }> {
  const rows = await query<{ calls: number; cost_usd: number; lobby_calls: number }>(
    `select count(*)::int as calls, coalesce(sum(cost_usd), 0)::float8 as cost_usd,
       count(*) filter (where lobby_code = $1)::int as lobby_calls
     from muse_calls`,
    [lobbyCode ?? null],
  );
  return rows[0];
}

export interface MuseCampsRow {
  status: "pending" | "done" | "failed";
  submitted: number;
  camps: unknown;
}

export async function getMuseCamps(code: string, decisionId: string): Promise<MuseCampsRow | null> {
  const rows = await query<MuseCampsRow>(
    `select status, submitted, camps from muse_camps where lobby_code = $1 and decision_id = $2`,
    [code, decisionId],
  );
  return rows[0] ?? null;
}

// Claims the right to make the camps call. Only one caller wins: a new row, a finished row with
// fewer submissions than now (a late call landed), or a pending row abandoned for over 30 s.
export async function claimMuseCamps(code: string, decisionId: string, submitted: number): Promise<boolean> {
  const rows = await query(
    `insert into muse_camps as m (lobby_code, decision_id, status, submitted) values ($1, $2, 'pending', $3)
     on conflict (lobby_code, decision_id) do update set status = 'pending', submitted = $3, updated_at = now()
       where (m.status <> 'pending' and m.submitted < $3)
          or (m.status = 'pending' and m.updated_at < now() - interval '30 seconds')
     returning lobby_code`,
    [code, decisionId, submitted],
  );
  return rows.length === 1;
}

export async function saveMuseCamps(code: string, decisionId: string, camps: unknown | null): Promise<void> {
  await query(
    `update muse_camps set status = $3, camps = $4::jsonb, updated_at = now()
     where lobby_code = $1 and decision_id = $2`,
    [code, decisionId, camps ? "done" : "failed", camps ? JSON.stringify(camps) : null],
  );
}
