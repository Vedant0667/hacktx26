create table if not exists lobbies (
  code text primary key,
  decision_id text not null,
  phase text not null default 'waiting',
  phase_started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists players (
  lobby_code text not null references lobbies(code) on delete cascade,
  name text not null,
  joined_at timestamptz not null default now(),
  primary key (lobby_code, name)
);

create table if not exists submissions (
  id bigserial primary key,
  lobby_code text not null references lobbies(code) on delete cascade,
  player_name text not null,
  decision_id text not null,
  call text,
  reasons jsonb not null default '[]',
  factors_named jsonb not null default '[]',
  transcript text not null default '',
  seconds_to_call real not null,
  score_call int not null,
  score_reasoning int not null,
  total int not null,
  created_at timestamptz not null default now(),
  unique (lobby_code, player_name, decision_id)
);

create index if not exists submissions_decision_total on submissions (decision_id, total);

-- Every Muse Spark call (including failures), for the hard spend cap. cost_usd at muse-spark-1.3 prices.
create table if not exists muse_calls (
  id bigserial primary key,
  purpose text not null,
  lobby_code text,
  decision_id text,
  model text not null,
  ok boolean not null,
  status text,
  error text,
  input_tokens int not null default 0,
  cached_tokens int not null default 0,
  output_tokens int not null default 0,
  reasoning_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  latency_ms int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists muse_calls_lobby on muse_calls (lobby_code);

-- One Muse camp relabel per lobby and decision, so polling the camps route does not re-call.
create table if not exists muse_camps (
  lobby_code text not null references lobbies(code) on delete cascade,
  decision_id text not null,
  status text not null default 'pending',
  submitted int not null default 0,
  camps jsonb,
  updated_at timestamptz not null default now(),
  primary key (lobby_code, decision_id)
);

-- Security fixes (docs/audits/security.md M4, L2, M6, M3, M5). Only hashes of tokens are stored.
alter table lobbies add column if not exists host_token_hash text;
alter table players add column if not exists token_hash text;
alter table players add column if not exists consent_at timestamptz;

-- Fixed-window counters for per-IP and site-wide rate limits (lobby creation, lobby reads, unlock attempts).
create table if not exists rate_limits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, key, window_start)
);

create index if not exists rate_limits_window on rate_limits (window_start);
create index if not exists lobbies_created_at on lobbies (created_at);

-- One grading claim per player and decision: only the request that wins it may call Muse.
create table if not exists submission_claims (
  lobby_code text not null references lobbies(code) on delete cascade,
  player_name text not null,
  decision_id text not null,
  created_at timestamptz not null default now(),
  primary key (lobby_code, player_name, decision_id)
);

-- Re-audit R5: players the host removed. Neither the name nor that device's token can rejoin the lobby.
create table if not exists kicked_players (
  lobby_code text not null references lobbies(code) on delete cascade,
  name text not null,
  token_hash text,
  created_at timestamptz not null default now(),
  primary key (lobby_code, name)
);

create index if not exists kicked_players_token on kicked_players (lobby_code, token_hash);
create index if not exists players_token on players (lobby_code, token_hash);

-- Race data (Round 3). Loaded by scripts/seed-db.mjs from engine/build.py's build/race-data/load.json, which is
-- built from the cached Jolpica, OpenF1 and hand-entered sources in data/. lib/data.ts reads these tables.
create table if not exists races (
  key text primary key,
  name text not null,
  season int not null,
  round int not null,
  race_name text,
  circuit text,
  race_date date,
  total_laps int not null,
  source jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- One row per driver per lap: the timing tower state at the end of that lap.
create table if not exists race_laps (
  race_key text not null references races(key) on delete cascade,
  lap int not null,
  driver_number int not null,
  driver_id text not null,
  driver_code text not null,
  team text not null,
  team_colour text,
  position int not null,
  lap_time_s double precision,
  gap_to_leader_s double precision,
  compound text,
  stint int,
  tyre_age int,
  pitted boolean not null default false,
  track_status text not null,
  primary key (race_key, lap, driver_number)
);

create index if not exists race_laps_race_lap_position on race_laps (race_key, lap, position);

-- blind is the only column served before the reveal (GET /api/decisions/[id]). full, ground_truth and
-- engine_inputs hold the answer and leave the server only through GET /api/lobby/[code]/reveal.
create table if not exists decision_points (
  id text primary key,
  race_key text not null references races(key) on delete cascade,
  lap int not null,
  trigger text not null,
  title text not null,
  player_team text not null,
  player_driver text not null,
  player_number int not null,
  blind jsonb not null,
  "full" jsonb not null,
  ground_truth jsonb not null,
  engine_inputs jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists decision_points_race on decision_points (race_key, lap);

alter table decision_points add column if not exists player_code text;

-- Round 4: each player plays one car. One row per car running at the decision lap. blind (identity and the
-- neutral title) is served by GET /api/decisions/[id]/drivers for scorable cars, and full (that car's team call,
-- engine call and ground truth) only by the reveal route.
create table if not exists decision_drivers (
  decision_id text not null references decision_points(id) on delete cascade,
  driver_code text not null,
  driver_number int not null,
  driver_name text not null,
  team text not null,
  team_colour text,
  position int not null,
  scorable boolean not null,
  blind jsonb not null,
  "full" jsonb not null,
  engine_inputs jsonb,
  primary key (decision_id, driver_code)
);

-- driver_mode 'same': everyone plays lobbies.driver_code, and 'choose': each player picks players.driver_code on join.
alter table lobbies add column if not exists driver_mode text not null default 'same';
alter table lobbies add column if not exists driver_code text;
alter table players add column if not exists driver_code text;
alter table submissions add column if not exists driver_code text;

-- Round 5: "defend your call" duel. One pick per lobby and decision (at most one Muse call), never re-picked,
-- so polling reads the cache and votes always refer to the same pair. duel: { source, pair, prompt }.
create table if not exists muse_duels (
  lobby_code text not null references lobbies(code) on delete cascade,
  decision_id text not null,
  status text not null default 'pending',
  submitted int not null default 0,
  duel jsonb,
  updated_at timestamptz not null default now(),
  primary key (lobby_code, decision_id)
);

create table if not exists duel_votes (
  lobby_code text not null references lobbies(code) on delete cascade,
  decision_id text not null,
  player_name text not null,
  choice int not null check (choice in (0, 1)),
  created_at timestamptz not null default now(),
  primary key (lobby_code, decision_id, player_name)
);

-- Round 6: race mode (docs/09-race-mode.md). Loaded by scripts/seed-db.mjs from engine/triggers.py export().
-- race_drivers: the picker (cars with at least one freeze). race_freezes: one row per car per freeze lap. blind is
-- served at the freeze, full (answer, team call, engine call, comparison cars) only by the race reveal route.
-- race_audibles: the seconds answer for a BOX audible by that car on that lap, for server-side scoring only.
create table if not exists race_drivers (
  race_key text not null references races(key) on delete cascade,
  driver_code text not null,
  driver_number int not null,
  driver_name text not null,
  team text not null,
  team_colour text,
  start_position int not null,
  freeze_count int not null,
  primary key (race_key, driver_code)
);

create table if not exists race_freezes (
  race_key text not null references races(key) on delete cascade,
  driver_code text not null,
  lap int not null,
  triggers jsonb not null,
  blind jsonb not null,
  "full" jsonb not null,
  primary key (race_key, driver_code, lap)
);

create table if not exists race_audibles (
  race_key text not null references races(key) on delete cascade,
  driver_code text not null,
  lap int not null,
  truth jsonb not null,
  primary key (race_key, driver_code, lap)
);

-- Race lobbies: mode 'race', decision_id 'race:<race_key>'. freeze_plan is fixed at waiting -> replay:
-- [{ lap, drivers: [codes with a call at that lap] }], the union over the lobby's cars. freeze_index is the
-- current (freeze, reveal_freeze) or next (replay) entry.
alter table lobbies add column if not exists mode text not null default 'moment';
alter table lobbies add column if not exists race_key text;
alter table lobbies add column if not exists freeze_plan jsonb;
alter table lobbies add column if not exists freeze_index int not null default 0;

-- Calls in a race lobby: one per player per freeze (kind 'freeze', lap = freeze lap) and audibles (kind
-- 'audible', lap = server lap when it landed). Scores are stored at insert and redacted until revealed.
create table if not exists race_calls (
  id bigserial primary key,
  lobby_code text not null references lobbies(code) on delete cascade,
  player_name text not null,
  kind text not null check (kind in ('freeze', 'audible')),
  lap int not null,
  driver_code text not null,
  call text,
  reasons jsonb not null default '[]',
  factors_named jsonb not null default '[]',
  transcript text not null default '',
  seconds_to_call real,
  status text not null default 'scored',
  score_call int not null default 0,
  score_reasoning int not null default 0,
  total int not null default 0,
  created_at timestamptz not null default now(),
  unique (lobby_code, player_name, kind, lap)
);

create index if not exists race_calls_lobby on race_calls (lobby_code, kind, lap);
