// Server-side loader for race data, read from Postgres (db/schema.sql: races, race_laps, decision_points,
// decision_drivers; loaded by scripts/seed-db.mjs from engine/build.py output).
//
// Two sides, kept apart (docs/audits/security-contract.md, Round 3 and Round 4):
// - Blind: getIndex, getBlindDecision, getBlindFrames, getBlindDrivers. They read only the blind columns and
//   race_laps before the call lap, and are what GET /api/decisions/** serves before the reveal.
// - Full: getDecision, getFrames, getGroundTruth, getDriverAnswers. They hold the answer and are only for
//   scoring, phase timing and GET /api/lobby/[code]/reveal.
//
// Round 9: full answers also carry the luck-aware verdict from table ai_verdicts (scripts/ai-verdicts.mjs), merged
// by freezeFullWithVerdict / driverFullWithVerdict; luck fields reach clients only at the end of a game.
//
// Each process caches successful reads in memory (the data changes only when the seed or ai-verdicts runs). An id that is
// not in the table is answered from the cached list without a query, and the list is re-read at most every 30 s.
import { query } from "./db";
import { applyVerdict, type LuckEvent, type LuckVerdict, type StoredVerdict } from "./luck";
import type { Call, DecisionIndexEntry, DecisionPoint, DriverFrame, LapFrame, TrackStatus } from "./types";

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const CODE_RE = /^[A-Z]{3}$/;
const LIST_TTL_MS = 30_000;

// Same shape as the old public/data/<id>/decision.json (security-contract.md section 5).
export type BlindDecision = Omit<DecisionPoint, "team" | "engine" | "ground_truth" | "reveal_to_lap"> & {
  total_laps: number;
  pit_loss: { normal_s: number; n_stops: number; from: string };
};

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

// One car's answer for a decision (Round 4). ground_truth_detail has the shape of ground_truth.seconds.
// Round 9: ground_truth also carries the luck-aware verdict (final_right_call, luck, luck_events, explanation);
// correct and swing_s stay the measured outcome.
export interface DriverReveal extends Omit<BlindDriver, "blind_title"> {
  scorable: boolean;
  team_call: { call: Call; reasons: string[] };
  engine: { call: Call; confidence: number; reasons: string[] };
  ground_truth: { correct: Call; swing_s: number } & Partial<LuckVerdict>;
  ground_truth_detail: Record<string, unknown>;
}

type DriverFull = Omit<DriverReveal, keyof BlindDriver | "scorable"> & { luck_events?: LuckEvent[]; luck_facts?: unknown };

interface DecisionRow {
  id: string;
  race: string;
  race_key: string;
  lap: number;
  title: string;
  player_code: string | null;
  blind: BlindDecision;
}

interface LapRow {
  lap: number;
  track_status: TrackStatus;
  driver_code: string;
  driver_number: number;
  team: string;
  team_colour: string | null;
  position: number;
  gap_to_leader_s: number | null;
  compound: string | null;
  tyre_age: number | null;
  pitted: boolean;
  lap_time_s: number | null;
}

const LAP_SELECT = `select lap, track_status, driver_code, driver_number, team, team_colour, position,
  gap_to_leader_s, compound, tyre_age, pitted, lap_time_s from race_laps`;

// ---- Pure helpers (unit-tested in scripts/test-data.ts) ----

// race_laps rows (ordered by lap, then position) to the frames shape engine/build.py writes.
export function rowsToFrames(rows: LapRow[]): LapFrame[] {
  const frames: LapFrame[] = [];
  for (const r of rows) {
    let f = frames[frames.length - 1];
    if (!f || f.lap !== r.lap) {
      f = { lap: r.lap, track_status: r.track_status, drivers: [] };
      frames.push(f);
    }
    const d: DriverFrame = {
      code: r.driver_code,
      number: r.driver_number,
      team: r.team,
      position: r.position,
      gap_to_leader_s: r.gap_to_leader_s,
      compound: r.compound,
      tyre_age: r.tyre_age,
      pitted_this_lap: r.pitted,
      lap_time_s: r.lap_time_s,
      team_colour: r.team_colour,
    };
    f.drivers.push(d);
  }
  return frames;
}

// Port of engine/build.py call_moment_frame: what the pit wall sees when the call is due. The order and gaps
// at the end of lap L-1, tyre ages +1, lap L's track status, and stops on lap L only by cars ahead of the
// player (frames[L-1] is lap L). With playerNumber null no lap-L stop is shown at all (Round 4, 4.8): with
// players on different cars, any one car's view would show other players' cars stopping.
export function callMomentFrame(frames: LapFrame[], lap: number, playerNumber: number | null): LapFrame {
  const prev = frames[lap - 2];
  const now = frames[lap - 1];
  if (!prev || !now || prev.lap !== lap - 1 || now.lap !== lap) throw new Error(`frames do not cover laps ${lap - 1} and ${lap}`);
  const me = playerNumber === null ? null : prev.drivers.find((d) => d.number === playerNumber);
  if (playerNumber !== null && !me) throw new Error(`car ${playerNumber} is not in lap ${lap - 1}`);
  const pittedNow = new Set(now.drivers.filter((d) => d.pitted_this_lap).map((d) => d.code));
  return {
    lap,
    track_status: now.track_status,
    drivers: prev.drivers.map((d) => ({
      ...d,
      tyre_age: d.tyre_age === null ? null : d.tyre_age + 1,
      pitted_this_lap: me !== null && me !== undefined && d.position < me.position && pittedNow.has(d.code),
    })),
  };
}

// Laps 1..L-1 plus the call-moment frame.
export function blindFrames(frames: LapFrame[], lap: number, playerNumber: number | null): LapFrame[] {
  return [...frames.slice(0, lap - 1), callMomentFrame(frames, lap, playerNumber)];
}

// The full decision as one car's player sees it: that car's role, answer, team call and engine call.
export function decisionForDriver(decision: DecisionPoint, driver: DriverReveal): DecisionPoint {
  return {
    ...decision,
    player_role: { team: driver.team, driver: driver.name, number: driver.number },
    ground_truth: driver.ground_truth,
    team: driver.team_call,
    engine: driver.engine,
  };
}

// Round 9: a stored full row with its luck-aware verdict merged in (ai_verdicts row or null). luck_facts is the
// build-time prompt input for scripts/ai-verdicts.mjs and is dropped here, so no route can serve it.
export function freezeFullWithVerdict(full: FullFreeze & { luck_facts?: unknown }, verdict: StoredVerdict | null): FullFreeze {
  const { luck_facts: _facts, ...rest } = full;
  void _facts;
  return { ...rest, ...applyVerdict(rest.correct, rest.luck_events, verdict) };
}

export function driverFullWithVerdict(full: DriverFull, verdict: StoredVerdict | null): Omit<DriverReveal, keyof BlindDriver | "scorable"> {
  const { luck_events, luck_facts: _facts, ...rest } = full;
  void _facts;
  return { ...rest, ground_truth: { ...rest.ground_truth, ...applyVerdict(rest.ground_truth.correct, luck_events, verdict) } };
}

// ---- Cached reads ----

let listCache: { at: number; rows: Promise<DecisionRow[]> } | null = null;
const fullCache = new Map<string, Promise<{ full: DecisionPoint; ground_truth: Record<string, unknown> } | null>>();
const raceFrames = new Map<string, Promise<LapFrame[]>>();
const blindFrameCache = new Map<string, Promise<LapFrame[]>>();
const driversCache = new Map<string, Promise<DriverReveal[]>>();
const blindDriversCache = new Map<string, Promise<DriversResponse>>();

// Drops a failed promise so the next call retries the query.
function remember<K, V>(map: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  let p = map.get(key);
  if (!p) {
    p = load();
    p.catch(() => map.delete(key));
    map.set(key, p);
  }
  return p;
}

function loadList(): Promise<DecisionRow[]> {
  return query<DecisionRow>(
    `select d.id, r.name as race, d.race_key, d.lap, d.title, d.player_code, d.blind
     from decision_points d join races r on r.key = d.race_key
     order by r.season, r.round, d.lap, d.id`,
  );
}

async function decisionList(): Promise<DecisionRow[]> {
  if (!listCache) {
    const rows = loadList();
    listCache = { at: Date.now(), rows };
    rows.catch(() => (listCache = null));
  }
  return listCache.rows;
}

// The listed row for an id; an unknown id re-reads the list only when it is older than LIST_TTL_MS.
async function decisionRow(id: string): Promise<DecisionRow | null> {
  if (!ID_RE.test(id)) return null;
  const hit = (await decisionList()).find((d) => d.id === id);
  if (hit || !listCache || Date.now() - listCache.at < LIST_TTL_MS) return hit ?? null;
  listCache = null;
  return (await decisionList()).find((d) => d.id === id) ?? null;
}

export async function getIndex(): Promise<DecisionIndexEntry[] | null> {
  const rows = await decisionList();
  return rows.map(({ id, race, lap, title }) => ({ id, race, lap, title }));
}

export async function getBlindDecision(id: string): Promise<BlindDecision | null> {
  return (await decisionRow(id))?.blind ?? null;
}

// Laps 1..L-1 and lap L's track status only: the blind route never reads a lap after the call.
export async function getBlindFrames(id: string): Promise<LapFrame[] | null> {
  const row = await decisionRow(id);
  if (!row) return null;
  return remember(blindFrameCache, id, async () => {
    const [before, status] = await Promise.all([
      query<LapRow>(`${LAP_SELECT} where race_key = $1 and lap < $2 order by lap, position`, [row.race_key, row.lap]),
      query<{ track_status: TrackStatus }>(`select track_status from race_laps where race_key = $1 and lap = $2 limit 1`, [row.race_key, row.lap]),
    ]);
    if (!status[0]) throw new Error(`race_laps has no lap ${row.lap} for ${row.race_key}`);
    const frames = rowsToFrames(before);
    return blindFrames([...frames, { lap: row.lap, track_status: status[0].track_status, drivers: [] }], row.lap, null);
  });
}

// Scorable cars only, with identity and the neutral title.
export async function getBlindDrivers(id: string): Promise<DriversResponse | null> {
  const row = await decisionRow(id);
  if (!row) return null;
  return remember(blindDriversCache, id, async () => {
    const drivers = await query<{ blind: BlindDriver }>(
      `select blind from decision_drivers where decision_id = $1 and scorable order by position`,
      [id],
    );
    return { decision_id: id, default_driver: row.player_code ?? "", drivers: drivers.map((d) => d.blind) };
  });
}

async function fullRow(id: string) {
  if (!(await decisionRow(id))) return null;
  return remember(fullCache, id, async () => {
    const rows = await query<{ full: DecisionPoint; ground_truth: Record<string, unknown> }>(
      `select d."full" as full, d.ground_truth from decision_points d where d.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  });
}

// Full decision (team, engine, ground truth, reveal lap) for the decision's original car.
export async function getDecision(id: string): Promise<DecisionPoint | null> {
  return (await fullRow(id))?.full ?? null;
}

// The measured outcome behind decision.ground_truth (seconds method, positions reference, pit loss).
export async function getGroundTruth(id: string): Promise<Record<string, unknown> | null> {
  return (await fullRow(id))?.ground_truth ?? null;
}

// Every lap of the race.
export async function getFrames(id: string): Promise<LapFrame[] | null> {
  const row = await decisionRow(id);
  if (!row) return null;
  return remember(raceFrames, row.race_key, async () =>
    rowsToFrames(await query<LapRow>(`${LAP_SELECT} where race_key = $1 order by lap, position`, [row.race_key])),
  );
}

// Every car running at the decision lap with its answer (scorable or not), with its luck-aware verdict (Round 9).
export async function getDriverAnswers(id: string): Promise<DriverReveal[] | null> {
  if (!(await decisionRow(id))) return null;
  return remember(driversCache, id, async () => {
    const rows = await query<{ blind: BlindDriver; scorable: boolean; full: DriverFull; verdict: StoredVerdict | null }>(
      `select d.blind, d.scorable, d."full" as full, ${VERDICT_JSON} as verdict
       from decision_drivers d join decision_points p on p.id = d.decision_id
       left join ai_verdicts v on v.kind = 'decision' and v.scope = d.decision_id and v.driver_code = d.driver_code and v.lap = p.lap
       where d.decision_id = $1 order by d.position`,
      [id],
    );
    return rows.map(({ blind: b, scorable, full, verdict }) => ({
      code: b.code, number: b.number, name: b.name, team: b.team, team_colour: b.team_colour, scorable,
      ...driverFullWithVerdict(full, verdict),
    }));
  });
}

// One car's answer; null for an unknown code or a car that is not scorable.
export async function getDriverAnswer(id: string, code: string): Promise<DriverReveal | null> {
  if (!CODE_RE.test(code)) return null;
  return (await getDriverAnswers(id))?.find((d) => d.code === code && d.scorable) ?? null;
}

// The decision's original car (the default in a "same" lobby).
export async function getDefaultDriver(id: string): Promise<string | null> {
  return (await decisionRow(id))?.player_code ?? null;
}

// ---- Race mode (Round 6): tables race_drivers, race_freezes, race_audibles ----
// Blind: getRaceList, getRaceEntry (picker), and the `blind` half of a freeze. Full: getRaceFreezes' `full`,
// getAudibleTruth and getRaceFrames hold answers or future laps; only race lobby routes use them, and only
// after the server clock or the phase has reached them.

const RACE_KEY_RE = /^[0-9]{4}-[a-z0-9-]{1,40}$/;

export type TriggerType = "SC" | "VSC" | "RIVAL_STOP" | "UNDERCUT" | "FAST_DEG" | "TYRE_WINDOW" | "RAIN";

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

// Round 9: correct and swing_s are the measured outcome. getRaceFreezes adds the luck-aware verdict
// (final_right_call, luck, luck_events, explanation, verdict_source); scoring uses final_right_call.
export interface FullFreeze extends Partial<LuckVerdict> {
  correct: Call;
  swing_s: number;
  window: [number, number];
  comparison: { boxed: string[]; stayed: string[]; widened_by_tyre_age: boolean };
  team_call: { call: Call; lap: number | null; reasons: string[] };
  engine: { call: Call; confidence: number; reasons: string[] };
  engine_inputs: Record<string, unknown>;
  detail: Record<string, unknown>;
}

export interface RaceFreeze {
  driver_code: string;
  lap: number;
  blind: BlindFreeze;
  full: FullFreeze;
}

export interface AudibleTruth {
  scorable: boolean;
  correct: Call | null;
  swing_s: number | null;
  window: [number, number];
  n_box: number;
  n_stay: number;
  reason: string | null;
  comparison?: { boxed: string[]; stayed: string[] };
}

// The ai_verdicts columns applyVerdict needs, or null when there is no row (Round 9).
const VERDICT_JSON = `case when v.kind is null then null else json_build_object('status', v.status,
  'measured_correct', v.measured_correct, 'luck_events', v.luck_events, 'final_right_call', v.final_right_call,
  'luck_changed_outcome', v.luck_changed_outcome, 'explanation', v.explanation) end`;

let raceListCache: { at: number; rows: Promise<RaceEntry[]> } | null = null;
const raceFreezeCache = new Map<string, Promise<RaceFreeze[]>>();

function loadRaceList(): Promise<RaceEntry[]> {
  return query<{ race_key: string; name: string; total_laps: number; drivers: (RaceDriver & { start_position: number })[] }>(
    `select r.key as race_key, r.name, r.total_laps,
       json_agg(json_build_object('code', d.driver_code, 'number', d.driver_number, 'name', d.driver_name,
         'team', d.team, 'team_colour', d.team_colour, 'freeze_count', d.freeze_count,
         'start_position', d.start_position) order by d.start_position) as drivers
     from races r join race_drivers d on d.race_key = r.key
     group by r.key, r.name, r.total_laps, r.season, r.round order by r.season, r.round`,
  ).then((rows) =>
    rows.map((r) => {
      const best = [...r.drivers].sort((a, b) => b.freeze_count - a.freeze_count || a.start_position - b.start_position)[0];
      return {
        race_key: r.race_key,
        name: r.name,
        total_laps: r.total_laps,
        default_driver: best?.code ?? "",
        drivers: r.drivers.map(({ code, number, name, team, team_colour, freeze_count }) => ({ code, number, name, team, team_colour, freeze_count })),
      };
    }),
  );
}

// Races with at least one freeze, for the race picker (blind: no laps, answers or team calls).
export async function getRaceList(): Promise<RaceEntry[]> {
  if (!raceListCache || Date.now() - raceListCache.at > LIST_TTL_MS) {
    const rows = loadRaceList();
    raceListCache = { at: Date.now(), rows };
    rows.catch(() => (raceListCache = null));
  }
  return raceListCache.rows;
}

export async function getRaceEntry(key: string): Promise<RaceEntry | null> {
  if (!RACE_KEY_RE.test(key)) return null;
  return (await getRaceList()).find((r) => r.race_key === key) ?? null;
}

// Every freeze of every car in a race (blind and full, with its luck-aware verdict). Server-side only.
export async function getRaceFreezes(key: string): Promise<RaceFreeze[]> {
  if (!(await getRaceEntry(key))) return [];
  return remember(raceFreezeCache, key, async () => {
    const rows = await query<RaceFreeze & { verdict: StoredVerdict | null }>(
      `select f.driver_code, f.lap, f.blind, f."full" as full, ${VERDICT_JSON} as verdict
       from race_freezes f
       left join ai_verdicts v on v.kind = 'freeze' and v.scope = f.race_key and v.driver_code = f.driver_code and v.lap = f.lap
       where f.race_key = $1 order by f.lap, f.driver_code`,
      [key],
    );
    return rows.map(({ verdict, ...r }) => ({ ...r, full: freezeFullWithVerdict(r.full, verdict) }));
  });
}

// The seconds answer for a BOX audible by `code` on `lap`; null when that car was not running then.
export async function getAudibleTruth(key: string, code: string, lap: number): Promise<AudibleTruth | null> {
  if (!RACE_KEY_RE.test(key) || !CODE_RE.test(code)) return null;
  const rows = await query<{ truth: AudibleTruth }>(
    `select truth from race_audibles where race_key = $1 and driver_code = $2 and lap = $3`,
    [key, code, lap],
  );
  return rows[0]?.truth ?? null;
}

// Every lap of a race (shares the per-race cache with getFrames).
export async function getRaceFrames(key: string): Promise<LapFrame[] | null> {
  if (!(await getRaceEntry(key))) return null;
  return remember(raceFrames, key, async () =>
    rowsToFrames(await query<LapRow>(`${LAP_SELECT} where race_key = $1 order by lap, position`, [key])),
  );
}
