// Loads race data into Postgres: runs engine/build.py (data/ -> build/race-data/load.json), then upserts
// races, race_laps, decision_points, decision_drivers and the race-mode tables in one transaction and deletes rows the build no longer produces.
// Idempotent: a second run leaves the same rows. Apply db/schema.sql first (scripts/migrate.mjs).
// Round 9: rows with luck_events need a verdict from scripts/ai-verdicts.mjs (run after this). ai_verdicts rows are
// kept across seeds; lib/data.ts ignores one whose measured answer or luck events no longer match.
// Usage: node --env-file=.env.local scripts/seed-db.mjs [--skip-build]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const root = new URL("..", import.meta.url);
if (!process.argv.includes("--skip-build")) {
  execFileSync("python3", ["engine/build.py"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
}
const load = JSON.parse(readFileSync(new URL("build/race-data/load.json", root), "utf8"));
if (!load.races?.length || !load.decision_points?.length) throw new Error("load.json has no races or decision points");

const sql = neon(process.env.DATABASE_URL);
const raceKeys = load.races.map((r) => r.key);
const decisionIds = load.decision_points.map((d) => d.id);
const driverRows = load.decision_points.flatMap((d) => d.drivers ?? []);
if (!driverRows.length) throw new Error("load.json has no per-driver rows");
if (!load.race_freezes?.length || !load.race_drivers?.length || !load.race_audibles?.length) {
  throw new Error("load.json has no race-mode rows (engine/triggers.py export)");
}

await sql.transaction([
  sql.query(
    `insert into races (key, name, season, round, race_name, circuit, race_date, total_laps, source)
     select key, name, season, round, race_name, circuit, race_date, total_laps, source
     from jsonb_to_recordset($1::jsonb) as x(key text, name text, season int, round int, race_name text,
       circuit text, race_date date, total_laps int, source jsonb)
     on conflict (key) do update set name = excluded.name, season = excluded.season, round = excluded.round,
       race_name = excluded.race_name, circuit = excluded.circuit, race_date = excluded.race_date,
       total_laps = excluded.total_laps, source = excluded.source, updated_at = now()`,
    [JSON.stringify(load.races)],
  ),
  sql.query(
    `insert into race_laps (race_key, lap, driver_number, driver_id, driver_code, team, team_colour, position,
       lap_time_s, gap_to_leader_s, compound, stint, tyre_age, pitted, track_status)
     select race_key, lap, driver_number, driver_id, driver_code, team, team_colour, position,
       lap_time_s, gap_to_leader_s, compound, stint, tyre_age, pitted, track_status
     from jsonb_to_recordset($1::jsonb) as x(race_key text, lap int, driver_number int, driver_id text,
       driver_code text, team text, team_colour text, position int, lap_time_s float8, gap_to_leader_s float8,
       compound text, stint int, tyre_age int, pitted boolean, track_status text)
     on conflict (race_key, lap, driver_number) do update set driver_id = excluded.driver_id,
       driver_code = excluded.driver_code, team = excluded.team, team_colour = excluded.team_colour,
       position = excluded.position, lap_time_s = excluded.lap_time_s, gap_to_leader_s = excluded.gap_to_leader_s,
       compound = excluded.compound, stint = excluded.stint, tyre_age = excluded.tyre_age,
       pitted = excluded.pitted, track_status = excluded.track_status`,
    [JSON.stringify(load.race_laps)],
  ),
  // Laps the build no longer produces for a loaded race (a driver or lap removed from the source).
  sql.query(
    `delete from race_laps l where l.race_key = any($1::text[]) and not exists (
       select 1 from jsonb_to_recordset($2::jsonb) as x(race_key text, lap int, driver_number int)
       where x.race_key = l.race_key and x.lap = l.lap and x.driver_number = l.driver_number)`,
    [raceKeys, JSON.stringify(load.race_laps.map(({ race_key, lap, driver_number }) => ({ race_key, lap, driver_number })))],
  ),
  sql.query(
    `insert into decision_points (id, race_key, lap, trigger, title, player_team, player_driver, player_number,
       player_code, blind, "full", ground_truth, engine_inputs)
     select id, race_key, lap, trigger, title, player_team, player_driver, player_number,
       player_code, blind, "full", ground_truth, engine_inputs
     from jsonb_to_recordset($1::jsonb) as x(id text, race_key text, lap int, trigger text, title text,
       player_team text, player_driver text, player_number int, player_code text, blind jsonb, "full" jsonb,
       ground_truth jsonb, engine_inputs jsonb)
     on conflict (id) do update set race_key = excluded.race_key, lap = excluded.lap, trigger = excluded.trigger,
       title = excluded.title, player_team = excluded.player_team, player_driver = excluded.player_driver,
       player_number = excluded.player_number, player_code = excluded.player_code, blind = excluded.blind,
       "full" = excluded."full", ground_truth = excluded.ground_truth, engine_inputs = excluded.engine_inputs,
       updated_at = now()`,
    [JSON.stringify(load.decision_points.map((d) => ({ ...d, drivers: undefined })))],
  ),
  sql.query(
    `insert into decision_drivers (decision_id, driver_code, driver_number, driver_name, team, team_colour,
       position, scorable, blind, "full", engine_inputs)
     select decision_id, code, number, name, team, team_colour, position, scorable, blind, "full", engine_inputs
     from jsonb_to_recordset($1::jsonb) as x(decision_id text, code text, number int, name text, team text,
       team_colour text, position int, scorable boolean, blind jsonb, "full" jsonb, engine_inputs jsonb)
     on conflict (decision_id, driver_code) do update set driver_number = excluded.driver_number,
       driver_name = excluded.driver_name, team = excluded.team, team_colour = excluded.team_colour,
       position = excluded.position, scorable = excluded.scorable, blind = excluded.blind,
       "full" = excluded."full", engine_inputs = excluded.engine_inputs`,
    [JSON.stringify(driverRows)],
  ),
  sql.query(
    `delete from decision_drivers d where not exists (
       select 1 from jsonb_to_recordset($1::jsonb) as x(decision_id text, code text)
       where x.decision_id = d.decision_id and x.code = d.driver_code)`,
    [JSON.stringify(driverRows.map(({ decision_id, code }) => ({ decision_id, code })))],
  ),
  // Lobbies from before per-driver play: everyone played the decision's original car.
  sql.query(
    `update lobbies l set driver_code = d.player_code from decision_points d
     where l.decision_id = d.id and l.driver_mode = 'same' and l.driver_code is null`,
  ),
  sql.query(
    `update players p set driver_code = l.driver_code from lobbies l
     where p.lobby_code = l.code and p.driver_code is null and l.driver_mode = 'same'`,
  ),
  sql.query(
    `update submissions s set driver_code = l.driver_code from lobbies l
     where s.lobby_code = l.code and s.driver_code is null and l.driver_mode = 'same'`,
  ),
  // Race mode (Round 6): replace each loaded race's picker rows, freezes and audible truth with the build's.
  sql.query(`delete from race_drivers where race_key = any($1::text[])`, [raceKeys]),
  sql.query(`delete from race_freezes where race_key = any($1::text[])`, [raceKeys]),
  sql.query(`delete from race_audibles where race_key = any($1::text[])`, [raceKeys]),
  sql.query(
    `insert into race_drivers (race_key, driver_code, driver_number, driver_name, team, team_colour, start_position, freeze_count)
     select race_key, code, number, name, team, team_colour, start_position, freeze_count
     from jsonb_to_recordset($1::jsonb) as x(race_key text, code text, number int, name text, team text,
       team_colour text, start_position int, freeze_count int)`,
    [JSON.stringify(load.race_drivers)],
  ),
  sql.query(
    `insert into race_freezes (race_key, driver_code, lap, triggers, blind, "full")
     select race_key, driver_code, lap, triggers, blind, "full"
     from jsonb_to_recordset($1::jsonb) as x(race_key text, driver_code text, lap int, triggers jsonb, blind jsonb, "full" jsonb)`,
    [JSON.stringify(load.race_freezes)],
  ),
  sql.query(
    `insert into race_audibles (race_key, driver_code, lap, truth)
     select race_key, driver_code, lap, truth
     from jsonb_to_recordset($1::jsonb) as x(race_key text, driver_code text, lap int, truth jsonb)`,
    [JSON.stringify(load.race_audibles)],
  ),
  // Decision points and races the build dropped (race_laps follow their race by cascade).
  sql.query(`delete from decision_points where not (id = any($1::text[]))`, [decisionIds]),
  sql.query(`delete from races where not (key = any($1::text[]))`, [raceKeys]),
]);

const [counts] = await sql.query(
  `select (select count(*) from races)::int as races, (select count(*) from race_laps)::int as race_laps,
     (select count(*) from decision_points)::int as decision_points,
     (select count(*) from decision_drivers)::int as decision_drivers,
     (select count(*) from decision_drivers where scorable)::int as scorable_drivers`,
);
const perRace = await sql.query(
  `select r.key, r.total_laps, count(l.*)::int as lap_rows, count(distinct l.driver_number)::int as drivers
   from races r left join race_laps l on l.race_key = r.key group by r.key, r.total_laps order by r.key`,
);
console.log(`build/race-data/load.json: ${load.races.length} races, ${load.race_laps.length} lap rows, ${load.decision_points.length} decision points`);
console.log(
  `database: races ${counts.races}, race_laps ${counts.race_laps}, decision_points ${counts.decision_points}, ` +
    `decision_drivers ${counts.decision_drivers} (${counts.scorable_drivers} scorable)`,
);
for (const r of perRace) console.log(`  ${r.key}: ${r.total_laps} laps, ${r.drivers} drivers, ${r.lap_rows} lap rows`);
const raceMode = await sql.query(
  `select f.race_key, count(*)::int as freezes, count(distinct f.driver_code)::int as drivers,
     count(*) filter (where f."full"->>'correct' = 'BOX')::int as box,
     count(*) filter (where f."full"->>'correct' = 'STAY')::int as stay,
     count(*) filter (where jsonb_array_length(coalesce(f."full"->'luck_events', '[]'::jsonb)) > 0)::int as luck,
     (select count(*) from race_drivers d where d.race_key = f.race_key and d.freeze_count >= 3)::int as drivers_3plus,
     (select count(*) from race_audibles a where a.race_key = f.race_key)::int as audible_rows,
     (select count(*) from race_audibles a where a.race_key = f.race_key and (a.truth->>'scorable')::boolean)::int as audible_scorable
   from race_freezes f group by f.race_key order by f.race_key`,
);
for (const r of raceMode) {
  console.log(
    `  race mode ${r.race_key}: ${r.freezes} freezes over ${r.drivers} drivers (${r.drivers_3plus} with 3+), ` +
      `correct BOX ${r.box} / STAY ${r.stay}; ${r.luck} with luck events (scripts/ai-verdicts.mjs); ` +
      `audible truth ${r.audible_rows} car-laps, ${r.audible_scorable} scorable`,
  );
}
const [rm] = await sql.query(
  `select (select count(*) from race_freezes)::int as f, (select count(*) from race_drivers)::int as d,
     (select count(*) from race_audibles)::int as a`,
);
if (
  rm.f !== load.race_freezes.length ||
  rm.d !== load.race_drivers.length ||
  rm.a !== load.race_audibles.length ||
  counts.race_laps !== load.race_laps.length ||
  counts.decision_points !== load.decision_points.length ||
  counts.decision_drivers !== driverRows.length
) {
  throw new Error("row counts in the database do not match load.json");
}
