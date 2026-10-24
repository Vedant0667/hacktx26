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
