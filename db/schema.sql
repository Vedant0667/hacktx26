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
