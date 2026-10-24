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

export async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql().query(text, params)) as T[];
}

export const PHASES: LobbyPhase[] = ["waiting", "replay", "decision", "reveal", "done"];

const CURRENT_FREEZE_LAP = `(l.freeze_plan->l.freeze_index->>'lap')::int`;

export type DriverMode = "same" | "choose";
export type LobbyMode = "moment" | "race";
// Race lobby phases (Round 6). A moment lobby uses LobbyPhase.
export type RacePhase = "waiting" | "replay" | "freeze" | "reveal_freeze" | "done";
export type AnyPhase = LobbyPhase | RacePhase;

// One entry of a race lobby's freeze plan: the lap and the lobby cars with a call there.
export interface FreezePlanEntry {
  lap: number;
  drivers: string[];
}

// Raw race fields read with the lobby; app/api/_lib/redact.ts turns them into RaceState for clients.
export interface RaceLobbyRaw {
  race_key: string;
  name: string;
  total_laps: number;
  freeze_plan: FreezePlanEntry[] | null;
  freeze_index: number;
  phase_elapsed_s: number;
  called: string[]; // players with a call in on the current freeze
}

// What clients get (security-contract.md Round 6, 6.3).
export interface RaceState {
  race_key: string;
  name: string;
  total_laps: number;
  lap_s: number;
  freeze_count: number | null;
  freeze_index: number;
  freeze_lap: number | null;
  past_freeze_laps: number[];
  segment_start_lap: number;
  visible_lap: number;
  segment_end_lap: number | null;
  calls_needed: string[] | null;
  called: string[];
}

// A submission and the car it was scored against (Round 4; null only for rows from before per-driver play).
// Round 7: verdict and credited come from the reasoning grade; graded is false until the reveal grading ran
// (until then the row holds the provisional rubric grade).
export type DriverSubmission = Submission & { driver_code: string | null; verdict?: string | null; credited?: string[]; graded?: boolean };

// LobbyState plus the server clock (ms), taken from the same now() that sets phase_started_at, and the
// per-driver fields (docs/audits/security-contract.md Round 4, 4.3).
// phase: typed LobbyPhase for the existing client code; in a race lobby it holds a RacePhase value
// ("freeze", "reveal_freeze" included, security-contract.md Round 6, 6.3). Check `mode` before switching on it.
export type LobbyStateResponse = Omit<LobbyState, "players" | "submissions"> & {
  now: number;
  mode: LobbyMode;
  race: RaceState | null; // null in a moment lobby (Round 6)
  _race?: RaceLobbyRaw | null; // server-only, removed by present() before the response
  driver_mode: DriverMode;
  driver_code: string | null; // the lobby's car in "same" mode; null in "choose"
  players: { name: string; joined_at: number; driver_code: string | null }[];
  submissions: DriverSubmission[];
};

const ms = (col: string) => `round(extract(epoch from ${col}) * 1000)::float8`;

const SUBMISSION_JSON = `json_build_object(
  'lobby_code', s.lobby_code, 'player_name', s.player_name, 'decision_id', s.decision_id,
  'call', s.call, 'reasons', s.reasons, 'factors_named', s.factors_named, 'transcript', s.transcript,
  'seconds_to_call', s.seconds_to_call, 'score_call', s.score_call, 'score_reasoning', s.score_reasoning,
  'total', s.total, 'driver_code', s.driver_code, 'verdict', s.verdict, 'credited', s.credited,
  'graded', s.graded_at is not null)`;

const SUBMISSION_COLS = `lobby_code, player_name, decision_id, call, reasons, factors_named, transcript,
  seconds_to_call, score_call, score_reasoning, total, driver_code, verdict, credited`;

// Players best first; equal totals share a rank and are listed by name. Time to call never breaks a tie.
const SUBMISSION_ORDER = "s.total desc, s.player_name asc";

function isPgError(err: unknown, code: string): boolean {
  return err instanceof NeonDbError ? err.code === code : (err as { code?: string })?.code === code;
}

// Returns false if the code is already taken (caller retries with a new code).
// The host runs the shared screen and is not a player; players join from their phones.
// Only the SHA-256 of the host token is stored. driverCode: the car everyone plays ("same"), null for "choose".
export async function createLobby(
  code: string,
  decisionId: string,
  hostTokenHash: string,
  driverMode: DriverMode = "same",
  driverCode: string | null = null,
  mode: LobbyMode = "moment",
  raceKey: string | null = null,
): Promise<boolean> {
  const rows = await query<{ code: string }>(
    `insert into lobbies (code, decision_id, host_token_hash, driver_mode, driver_code, mode, race_key)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (code) do nothing returning code`,
    [code, decisionId, hostTokenHash, driverMode, driverCode, mode, raceKey],
  );
  return rows.length === 1;
}

// Retention: games (lobbies, and by cascade players, submissions, claims, kicks, camp labels) live 24 hours;
// rate-limit windows (IP addresses) a day. Runs daily from the Vercel Cron (/api/cron/purge) and
// opportunistically on lobby creation. muse_calls holds no player text and stays for the spend cap.
export async function purgeExpired(): Promise<{ lobbies: number; rate_limits: number }> {
  const [lobbies, limits] = (await sql().transaction([
    sql().query(`delete from lobbies where created_at < now() - interval '24 hours' returning code`),
    sql().query(`delete from rate_limits where window_start < now() - interval '1 day' returning bucket`),
  ])) as unknown as [unknown[], unknown[]];
  return { lobbies: lobbies.length, rate_limits: limits.length };
}

// ---- Rate limits (table rate_limits: fixed windows, one row per bucket, key and window) ----

const WINDOW = (secParam: string) =>
  `to_timestamp(floor(extract(epoch from now()) / ${secParam}::int) * ${secParam}::int)`;

// Counts one hit and returns the new count in the current window. One upsert, so concurrent hits each
// see their own count. retry_after_s: seconds until the window rolls over.
export async function hitRateLimit(bucket: string, key: string, windowS: number): Promise<{ count: number; retry_after_s: number }> {
  const rows = await query<{ count: number; retry_after_s: number }>(
    `insert into rate_limits (bucket, key, window_start, count) values ($1, $2, ${WINDOW("$3")}, 1)
     on conflict (bucket, key, window_start) do update set count = rate_limits.count + 1
     returning count, ceil($3::int - mod(extract(epoch from now()), $3::int))::int as retry_after_s`,
    [bucket, key, windowS],
  );
  return rows[0];
}

export interface LobbyReadGuard {
  found: boolean; // the lobby code exists
  reads: number; // requests from this IP in the current read window
  misses: number; // lookups of codes that do not exist from this IP in the current miss window (this one included)
  retry_after_s: number;
  state: LobbyStateResponse | null;
}

// Rate-limit check and lobby read in one transaction, serialised per IP by an advisory lock, so a burst of
// guesses cannot slip past the miss count. A miss is counted only when the code does not exist.
export async function guardedLobbyRead(
  ip: string,
  code: string,
  opts: { readWindowS: number; missWindowS: number; withState: boolean },
): Promise<LobbyReadGuard> {
  const results = (await sql().transaction([
    sql().query(`select pg_advisory_xact_lock(hashtext($1))`, [`lobby-read:${ip}`]),
    sql().query(
      `insert into rate_limits (bucket, key, window_start, count) values ('lobby_read', $1, ${WINDOW("$2")}, 1)
       on conflict (bucket, key, window_start) do update set count = rate_limits.count + 1
       returning count, ceil($2::int - mod(extract(epoch from now()), $2::int))::int as retry_after_s`,
      [ip, opts.readWindowS],
    ),
    sql().query(
      `with found as (select exists(select 1 from lobbies where code = $2) as f),
       ins as (
         insert into rate_limits (bucket, key, window_start, count)
         select 'lobby_miss', $1, ${WINDOW("$3")}, 1 from found where not found.f
         on conflict (bucket, key, window_start) do update set count = rate_limits.count + 1
         returning count
       )
       select (select f from found) as found,
         coalesce((select count from ins),
                  (select count from rate_limits where bucket = 'lobby_miss' and key = $1 and window_start = ${WINDOW("$3")}),
                  0)::int as misses,
         ceil($3::int - mod(extract(epoch from now()), $3::int))::int as miss_retry_s`,
      [ip, code, opts.missWindowS],
    ),
  ])) as unknown as [unknown, { count: number; retry_after_s: number }[], { found: boolean; misses: number; miss_retry_s: number }[]];
  const read = results[1][0];
  const miss = results[2][0];
  const state = miss.found && opts.withState ? await getLobbyState(code) : null;
  return {
    found: miss.found,
    reads: read.count,
    misses: miss.misses,
    retry_after_s: Math.max(read.retry_after_s, miss.misses > 0 ? miss.miss_retry_s : 0),
    state,
  };
}

// One round trip: lobby, players, this decision's submissions, and the DB clock.
export async function getLobbyState(code: string): Promise<LobbyStateResponse | null> {
  const rows = await query<LobbyStateResponse>(
    `select l.code, l.decision_id, l.phase, l.driver_mode, l.driver_code, l.mode, null::json as race,
       ${ms("l.phase_started_at")} as phase_started_at,
       ${ms("now()")} as now,
       case when l.mode = 'race' then json_build_object(
         'race_key', l.race_key, 'name', r.name, 'total_laps', r.total_laps, 'freeze_plan', l.freeze_plan,
         'freeze_index', l.freeze_index,
         'phase_elapsed_s', extract(epoch from now() - l.phase_started_at)::float8,
         'called', coalesce((select json_agg(c.player_name order by c.player_name) from race_calls c
                             where c.lobby_code = l.code and c.kind = 'freeze' and c.lap = ${CURRENT_FREEZE_LAP}), '[]'::json))
       end as _race,
       coalesce((select json_agg(json_build_object('name', p.name, 'joined_at', ${ms("p.joined_at")},
                                                   'driver_code', p.driver_code)
                   order by p.joined_at, p.name)
                 from players p where p.lobby_code = l.code), '[]'::json) as players,
       coalesce((select json_agg(${SUBMISSION_JSON} order by ${SUBMISSION_ORDER})
                 from submissions s where s.lobby_code = l.code and s.decision_id = l.decision_id),
                '[]'::json) as submissions
     from lobbies l left join races r on r.key = l.race_key where l.code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

export const MAX_PLAYERS = 12;

// Adds a player (token hash and consent time stored) unless the lobby is full, the name is taken, or the host
// removed that name or the presented device token from this lobby (kicked_players).
// Serialised per lobby with an advisory lock so concurrent joins cannot pass the cap or race a kick.
// "taken" carries the stored token hash so the route can allow a rejoin by the same device. driverCode is stored
// only on a new row: a rejoin keeps the car picked at the first join.
export async function addPlayer(
  code: string,
  name: string,
  tokenHash: string,
  presentedTokenHash: string | null = null,
  driverCode: string | null = null,
): Promise<{ result: "ok" } | { result: "taken"; token_hash: string | null } | { result: "full" | "no_lobby" | "kicked" }> {
  try {
    const results = (await sql().transaction([
      sql().query(`select pg_advisory_xact_lock(hashtext($1))`, [`lobby-join:${code}`]),
      sql().query(
        `select exists(select 1 from kicked_players
                       where lobby_code = $1 and (name = $2 or ($3::text is not null and token_hash = $3))) as kicked`,
        [code, name, presentedTokenHash],
      ),
      sql().query(
        `insert into players (lobby_code, name, token_hash, consent_at, driver_code)
         select $1, $2, $3, now(), $6 where (select count(*) from players where lobby_code = $1) < $4
           and not exists(select 1 from kicked_players
                          where lobby_code = $1 and (name = $2 or ($5::text is not null and token_hash = $5)))
         on conflict (lobby_code, name) do nothing returning name`,
        [code, name, tokenHash, MAX_PLAYERS, presentedTokenHash, driverCode],
      ),
      sql().query(`select token_hash from players where lobby_code = $1 and name = $2`, [code, name]),
    ])) as unknown as [unknown, { kicked: boolean }[], { name: string }[], { token_hash: string | null }[]];
    if (results[1][0]?.kicked) return { result: "kicked" };
    if (results[2].length === 1) return { result: "ok" };
    if (results[3].length === 1) return { result: "taken", token_hash: results[3][0].token_hash };
    return { result: "full" };
  } catch (err) {
    if (isPgError(err, "23503")) return { result: "no_lobby" }; // foreign key: lobby does not exist
    throw err;
  }
}

// Host removes a player: records the name and device token in kicked_players (so neither can rejoin), and,
// before the reveal, deletes that player's submission and grading claim. False when no player has that name.
export async function kickPlayer(code: string, name: string): Promise<boolean> {
  const beforeReveal = `exists(select 1 from lobbies where code = $1 and mode = 'moment' and phase in ('waiting', 'replay', 'decision'))`;
  // Race lobby: only the call on the current, unrevealed freeze goes (and its grading claim).
  const raceFreezeOpen = `exists(select 1 from lobbies l where l.code = $1 and l.mode = 'race' and l.phase = 'freeze'
    and ${CURRENT_FREEZE_LAP} = race_calls.lap)`;
  const results = (await sql().transaction([
    sql().query(`select pg_advisory_xact_lock(hashtext($1))`, [`lobby-join:${code}`]),
    sql().query(
      `insert into kicked_players (lobby_code, name, token_hash)
       select lobby_code, name, token_hash from players where lobby_code = $1 and name = $2
       on conflict (lobby_code, name) do update set token_hash = excluded.token_hash, created_at = now()`,
      [code, name],
    ),
    sql().query(`delete from submissions where lobby_code = $1 and player_name = $2 and ${beforeReveal}`, [code, name]),
    sql().query(`delete from submission_claims where lobby_code = $1 and player_name = $2 and ${beforeReveal}`, [code, name]),
    sql().query(
      `delete from submission_claims where lobby_code = $1 and player_name = $2 and decision_id = (
         select 'race:' || l.race_key || ':L' || ${CURRENT_FREEZE_LAP} from lobbies l
         where l.code = $1 and l.mode = 'race' and l.phase = 'freeze')`,
      [code, name],
    ),
    sql().query(`delete from race_calls where lobby_code = $1 and player_name = $2 and kind = 'freeze' and ${raceFreezeOpen}`, [code, name]),
    sql().query(`delete from players where lobby_code = $1 and name = $2 returning name`, [code, name]),
  ])) as unknown as [unknown, unknown, unknown, unknown, unknown, unknown, { name: string }[]];
  return results[6].length === 1;
}

export interface LobbyMeta {
  decision_id: string;
  phase: AnyPhase;
  mode: LobbyMode;
  race_key: string | null;
  freeze_plan: FreezePlanEntry[] | null;
  freeze_index: number;
  total_laps: number | null; // race lobbies
  phase_elapsed_s: number;
  host_token_hash: string | null;
  is_player: boolean;
  player_token_hash: string | null;
  has_submitted: boolean;
  player_count: number; // players in the lobby now
  submitted_count: number; // of those, how many have a call in on the current decision
  token_player: string | null; // the player whose token hash is `playerTokenHash`, if any
  driver_mode: DriverMode;
  driver_code: string | null; // the lobby's car ("same" mode)
  player_driver_code: string | null; // the car of `playerName`, if that player exists
}

export async function getLobbyMeta(code: string, playerName?: string, playerTokenHash?: string | null): Promise<LobbyMeta | null> {
  const rows = await query<LobbyMeta>(
    `select l.decision_id, l.phase, l.host_token_hash, l.driver_mode, l.driver_code,
       l.mode, l.race_key, l.freeze_plan, l.freeze_index,
       (select r.total_laps from races r where r.key = l.race_key) as total_laps,
       extract(epoch from now() - l.phase_started_at)::float8 as phase_elapsed_s,
       (select p.driver_code from players p where p.lobby_code = l.code and p.name = $2) as player_driver_code,
       exists(select 1 from players p where p.lobby_code = l.code and p.name = $2) as is_player,
       (select p.token_hash from players p where p.lobby_code = l.code and p.name = $2) as player_token_hash,
       exists(select 1 from submissions s where s.lobby_code = l.code and s.player_name = $2
              and s.decision_id = l.decision_id) as has_submitted,
       (select count(*) from players p where p.lobby_code = l.code)::int as player_count,
       (select count(*) from players p where p.lobby_code = l.code and exists(
          select 1 from submissions s where s.lobby_code = l.code and s.player_name = p.name
          and s.decision_id = l.decision_id))::int as submitted_count,
       (select p.name from players p where p.lobby_code = l.code and $3::text is not null and p.token_hash = $3
        limit 1) as token_player
     from lobbies l where l.code = $1`,
    [code, playerName ?? "", playerTokenHash ?? null],
  );
  return rows[0] ?? null;
}

export async function getSubmission(code: string, playerName: string, decisionId: string): Promise<DriverSubmission | null> {
  const rows = await query<{ row: DriverSubmission }>(
    `select ${SUBMISSION_JSON} as row from submissions s
     where s.lobby_code = $1 and s.player_name = $2 and s.decision_id = $3`,
    [code, playerName, decisionId],
  );
  return rows[0]?.row ?? null;
}

// ---- Race lobbies (Round 6) ----

// waiting -> replay with the freeze plan fixed (compare-and-set on the phase).
export async function startRace(code: string, plan: FreezePlanEntry[]): Promise<boolean> {
  const rows = await query(
    `update lobbies set phase = 'replay', phase_started_at = now(), freeze_plan = $2::jsonb, freeze_index = 0
     where code = $1 and mode = 'race' and phase = 'waiting' returning code`,
    [code, JSON.stringify(plan)],
  );
  return rows.length === 1;
}

// Compare-and-set on phase and freeze index, so a stale click from the previous loop cannot move the lobby.
export async function advanceRacePhase(code: string, from: RacePhase, to: RacePhase, fromIndex: number, toIndex: number): Promise<boolean> {
  const rows = await query(
    `update lobbies set phase = $3, phase_started_at = now(), freeze_index = $5
     where code = $1 and mode = 'race' and phase = $2 and freeze_index = $4 returning code`,
    [code, from, to, fromIndex, toIndex],
  );
  return rows.length === 1;
}

export interface RaceCallRow {
  kind: "freeze" | "audible";
  lap: number;
  player_name: string;
  driver_code: string;
  call: "BOX" | "STAY" | null;
  reasons: string[];
  factors_named: string[];
  transcript: string;
  seconds_to_call: number | null;
  status: "pending" | "scored" | "unscored" | "cancelled";
  score_call: number; // Round 7: the call's stakes (0–100)
  score_reasoning: number; // reasoning 0–50
  total: number; // signed points
  verdict?: string | null; // Round 7: one line on the reasoning score
  credited?: string[];
  graded?: boolean; // false until the reveal grading ran (provisional rubric grade until then)
}

const RACE_CALL_COLS = `kind, lap, player_name, driver_code, call, reasons, factors_named, transcript, seconds_to_call,
  status, score_call, score_reasoning, total`;
const RACE_CALL_SELECT = `${RACE_CALL_COLS}, verdict, credited, graded_at is not null as graded`;

export async function getRaceCalls(code: string): Promise<RaceCallRow[]> {
  return query<RaceCallRow>(
    `select ${RACE_CALL_SELECT} from race_calls where lobby_code = $1 order by lap, kind, created_at, player_name`,
    [code],
  );
}

export async function getRaceCall(code: string, player: string, kind: "freeze" | "audible", lap: number): Promise<RaceCallRow | null> {
  const rows = await query<RaceCallRow>(
    `select ${RACE_CALL_SELECT} from race_calls where lobby_code = $1 and player_name = $2 and kind = $3 and lap = $4`,
    [code, player, kind, lap],
  );
  return rows[0] ?? null;
}

// First call per player and freeze wins; a repeat returns the stored row with duplicate = true.
export async function insertRaceCall(code: string, c: RaceCallRow): Promise<{ call: RaceCallRow; duplicate: boolean }> {
  const rows = await query<RaceCallRow>(
    `insert into race_calls (lobby_code, ${RACE_CALL_COLS}, verdict, credited)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
     on conflict (lobby_code, player_name, kind, lap) do nothing returning ${RACE_CALL_SELECT}`,
    [code, c.kind, c.lap, c.player_name, c.driver_code, c.call, JSON.stringify(c.reasons), JSON.stringify(c.factors_named),
      c.transcript, c.seconds_to_call, c.status, c.score_call, c.score_reasoning, c.total, c.verdict ?? null, JSON.stringify(c.credited ?? [])],
  );
  if (rows[0]) return { call: rows[0], duplicate: false };
  return { call: (await getRaceCall(code, c.player_name, c.kind, c.lap))!, duplicate: true };
}

// An audible, only if this player has none within `gap - 1` laps of it. Serialised per player with an
// advisory lock so two quick taps cannot both pass. Returns the stored row (null when refused) and the laps
// of this player's audibles after the attempt.
export async function insertAudible(code: string, c: RaceCallRow, gap: number): Promise<{ call: RaceCallRow | null; laps: number[] }> {
  const results = (await sql().transaction([
    sql().query(`select pg_advisory_xact_lock(hashtext($1))`, [`audible:${code}:${c.player_name}`]),
    sql().query(
      `insert into race_calls (lobby_code, ${RACE_CALL_COLS}, verdict, credited)
       select $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $16, $17::jsonb
       where not exists(select 1 from race_calls where lobby_code = $1 and player_name = $4 and kind = 'audible'
                        and abs(lap - $3::int) < $15::int)
       on conflict (lobby_code, player_name, kind, lap) do nothing returning ${RACE_CALL_SELECT}`,
      [code, c.kind, c.lap, c.player_name, c.driver_code, c.call, JSON.stringify(c.reasons), JSON.stringify(c.factors_named),
        c.transcript, c.seconds_to_call, c.status, c.score_call, c.score_reasoning, c.total, gap, c.verdict ?? null, JSON.stringify(c.credited ?? [])],
    ),
    sql().query(
      `select coalesce(json_agg(lap order by lap), '[]'::json) as laps from race_calls
       where lobby_code = $1 and player_name = $2 and kind = 'audible'`,
      [code, c.player_name],
    ),
  ])) as unknown as [unknown, RaceCallRow[], { laps: number[] }[]];
  return { call: results[1][0] ?? null, laps: results[2][0]?.laps ?? [] };
}

export async function getAudibleLaps(code: string, player: string): Promise<number[]> {
  const rows = await query<{ laps: number[] }>(
    `select coalesce(json_agg(lap order by lap), '[]'::json) as laps from race_calls
     where lobby_code = $1 and player_name = $2 and kind = 'audible'`,
    [code, player],
  );
  return rows[0]?.laps ?? [];
}

// Players whose car has a call at this freeze, and how many of them have called.
export async function raceFreezeProgress(code: string, lap: number, drivers: string[]): Promise<{ needed: number; called: number }> {
  const rows = await query<{ needed: number; called: number }>(
    `select count(*)::int as needed,
       count(*) filter (where exists(select 1 from race_calls c where c.lobby_code = p.lobby_code
         and c.player_name = p.name and c.kind = 'freeze' and c.lap = $2))::int as called
     from players p where p.lobby_code = $1 and p.driver_code = any($3::text[])`,
    [code, lap, drivers],
  );
  return rows[0] ?? { needed: 0, called: 0 };
}

// Finished race lobbies on a race: each player's summed score (global race leaderboard, names and totals only).
export async function raceGlobalTotals(raceKey: string, limit = 50): Promise<{ name: string; driver_code: string | null; total: number }[]> {
  return query<{ name: string; driver_code: string | null; total: number }>(
    `select c.player_name as name, max(c.driver_code) as driver_code, sum(c.total)::int as total
     from race_calls c join lobbies l on l.code = c.lobby_code
     where l.mode = 'race' and l.race_key = $1 and l.phase = 'done'
     group by c.lobby_code, c.player_name order by total desc, name limit $2`,
    [raceKey, limit],
  );
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
// True only for the first request per player and decision, so concurrent submits can't each pay for grading.
export async function claimSubmission(code: string, playerName: string, decisionId: string): Promise<boolean> {
  const rows = await query(
    `insert into submission_claims (lobby_code, player_name, decision_id) values ($1, $2, $3)
     on conflict do nothing returning lobby_code`,
    [code, playerName, decisionId],
  );
  return rows.length === 1;
}

export async function insertSubmission(s: DriverSubmission): Promise<{ submission: DriverSubmission; duplicate: boolean }> {
  const inserted = await query<{ row: DriverSubmission }>(
    `insert into submissions as s (${SUBMISSION_COLS})
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
     on conflict (lobby_code, player_name, decision_id) do nothing
     returning ${SUBMISSION_JSON} as row`,
    [
      s.lobby_code, s.player_name, s.decision_id, s.call,
      JSON.stringify(s.reasons), JSON.stringify(s.factors_named), s.transcript,
      s.seconds_to_call, s.score_call, s.score_reasoning, s.total, s.driver_code,
      s.verdict ?? null, JSON.stringify(s.credited ?? []),
    ],
  );
  if (inserted.length === 1) return { submission: inserted[0].row, duplicate: false };
  const existing = await query<{ row: DriverSubmission }>(
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

export async function topSubmissions(decisionId: string, limit = 50): Promise<DriverSubmission[]> {
  const rows = await query<{ row: DriverSubmission }>(
    `select ${SUBMISSION_JSON} as row from submissions s
     where s.decision_id = $1 and exists (select 1 from lobbies l where l.code = s.lobby_code and l.phase in ('reveal','done')) order by ${SUBMISSION_ORDER} limit $2`,
    [decisionId, limit],
  );
  return rows.map((r) => r.row);
}

// Every car played in a lobby: the lobby's car, each player's car and each stored call's car.
export async function getLobbyDriverCodes(code: string): Promise<string[]> {
  const rows = await query<{ driver_code: string }>(
    `select driver_code from lobbies where code = $1 and driver_code is not null
     union select driver_code from players where lobby_code = $1 and driver_code is not null
     union select driver_code from submissions where lobby_code = $1 and driver_code is not null
     order by 1`,
    [code],
  );
  return rows.map((r) => r.driver_code);
}

// ---- Muse Spark spend log (table muse_calls) ----

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

// Atomic budget reservation: under one advisory lock, a 'reserved' row priced at the worst case is inserted
// only if total spend plus that worst case stays within the budget and the lobby is under its call cap.
// Returns the row id, or null when the call must not be made.
export async function reserveMuseCall(r: {
  purpose: string;
  lobby_code: string | null;
  decision_id: string | null;
  model: string;
  worst_cost_usd: number;
  budget_usd: number;
  lobby_max_calls: number;
}): Promise<number | null> {
  const results = (await sql().transaction([
    sql().query(`select pg_advisory_xact_lock(4242)`),
    sql().query(
      `insert into muse_calls (purpose, lobby_code, decision_id, model, ok, status, cost_usd)
       select $1, $2, $3, $4, false, 'reserved', $5
       where (select coalesce(sum(cost_usd), 0) from muse_calls) + $5::numeric <= $6::numeric
         and ($2::text is null or (select count(*) from muse_calls where lobby_code = $2) < $7::int)
       returning id`,
      [r.purpose, r.lobby_code, r.decision_id, r.model, r.worst_cost_usd, r.budget_usd, r.lobby_max_calls],
    ),
  ])) as unknown as [unknown, { id: string | number }[]];
  const row = results[1][0];
  return row ? Number(row.id) : null;
}

// Replaces the reservation with the call's real usage and cost.
export async function finishMuseCall(id: number, c: MuseCallLog): Promise<void> {
  await query(
    `update muse_calls set ok = $2, status = $3, error = $4, input_tokens = $5, cached_tokens = $6,
       output_tokens = $7, reasoning_tokens = $8, cost_usd = $9, latency_ms = $10
     where id = $1`,
    [
      id, c.ok, c.status, c.error?.slice(0, 500) ?? null,
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

// ---- Round 7: reasoning grades (tables grading_claims, benchmark_grades) ----

export interface StoredGrade {
  reasoning_score: number;
  verdict: string;
  credited: string[];
  source: string;
}

// One grader per lobby and scope. Wins on a new row, on a finished row (more calls to grade), or on a pending
// row abandoned for over 30 s.
export async function claimGrading(code: string, scope: string): Promise<boolean> {
  const rows = await query(
    `insert into grading_claims as g (lobby_code, scope) values ($1, $2)
     on conflict (lobby_code, scope) do update set status = 'pending', updated_at = now()
       where g.status <> 'pending' or g.updated_at < now() - interval '30 seconds'
     returning lobby_code`,
    [code, scope],
  );
  return rows.length === 1;
}

export async function releaseGrading(code: string, scope: string): Promise<void> {
  await query(`update grading_claims set status = 'done', updated_at = now() where lobby_code = $1 and scope = $2`, [code, scope]);
}

// The graded row: reasoning, verdict, credited ideas (also in factors_named), points, and graded_at.
export async function saveSubmissionGrade(
  code: string,
  player: string,
  decisionId: string,
  g: { score_reasoning: number; total: number; verdict: string; credited: string[] },
): Promise<void> {
  await query(
    `update submissions set score_reasoning = $4, total = $5, verdict = $6, credited = $7::jsonb, factors_named = $7::jsonb,
       graded_at = now()
     where lobby_code = $1 and player_name = $2 and decision_id = $3`,
    [code, player, decisionId, g.score_reasoning, g.total, g.verdict, JSON.stringify(g.credited)],
  );
}

export async function saveRaceCallGrade(
  code: string,
  player: string,
  kind: "freeze" | "audible",
  lap: number,
  g: { score_reasoning: number; total: number; verdict: string; credited: string[] },
): Promise<void> {
  await query(
    `update race_calls set score_reasoning = $5, total = $6, verdict = $7, credited = $8::jsonb, factors_named = $8::jsonb,
       graded_at = now()
     where lobby_code = $1 and player_name = $2 and kind = $3 and lap = $4`,
    [code, player, kind, lap, g.score_reasoning, g.total, g.verdict, JSON.stringify(g.credited)],
  );
}

export async function getBenchmarkGrades(keys: { decision_id: string; driver_code: string; kind: string; reasons_hash: string }[]): Promise<Map<string, StoredGrade>> {
  const out = new Map<string, StoredGrade>();
  if (!keys.length) return out;
  const rows = await query<StoredGrade & { decision_id: string; driver_code: string; kind: string; reasons_hash: string }>(
    `select b.decision_id, b.driver_code, b.kind, b.reasons_hash, b.reasoning_score, b.verdict, b.credited, b.source
     from benchmark_grades b join json_to_recordset($1::json) as k(decision_id text, driver_code text, kind text, reasons_hash text)
       using (decision_id, driver_code, kind, reasons_hash)`,
    [JSON.stringify(keys)],
  );
  for (const r of rows) out.set(`${r.decision_id}|${r.driver_code}|${r.kind}|${r.reasons_hash}`, r);
  return out;
}

export async function saveBenchmarkGrade(
  k: { decision_id: string; driver_code: string; kind: string; reasons_hash: string },
  g: StoredGrade,
): Promise<void> {
  await query(
    `insert into benchmark_grades (decision_id, driver_code, kind, reasons_hash, reasoning_score, verdict, credited, source)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) on conflict do nothing`,
    [k.decision_id, k.driver_code, k.kind, k.reasons_hash, g.reasoning_score, g.verdict, JSON.stringify(g.credited), g.source],
  );
}
