"use client";
// `/leaderboard`: global standings per decision point. The real team, the engine and everyone's calls show only when
// this browser played in a lobby that has revealed the decision (the route checks); otherwise names and totals.
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { COPY, factorLabel } from "@/lib/copy";
import { ApiError, api, data, type LeaderboardResponse, type LeaderboardRow } from "@/lib/client/api";
import { noopSubscribe, parsePlayed, recallPlayedRaw } from "@/lib/client/identity";
import { MAX_TOTAL } from "@/lib/client/race";
import type { DecisionIndexEntry } from "@/lib/types";
import { fieldColours, teamColourOf } from "@/lib/client/field";
import { CallWord, Check } from "./ui";

const BIN = 10;
const TOP = 20;
const LABEL_ROW = 20;

export function LeaderboardScreen({ index }: { index: DecisionIndexEntry[] }) {
  const [active, setActive] = useState(index[0]?.id ?? "");
  const [results, setResults] = useState<Record<string, LeaderboardResponse | "error">>({});
  const [factorsById, setFactorsById] = useState<Record<string, string[]>>({});
  // The player's team colour marks "your room" (blind data: a colour, no name).
  const [colourById, setColourById] = useState<Record<string, string | null>>({});
  const youRaw = useSyncExternalStore(noopSubscribe, () => recallPlayedRaw(active), () => null);
  const you = parsePlayed(youRaw);
  const youLobby = you?.lobby ?? null;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    api
      .leaderboard(active, youLobby)
      // 403: the remembered lobby is gone or this device holds no token for it; show the global board instead.
      .catch((e) => (youLobby && e instanceof ApiError && e.status === 403 ? api.leaderboard(active, null) : Promise.reject(e)))
      .then((r) => alive && setResults((m) => ({ ...m, [active]: r })))
      .catch(() => alive && setResults((m) => ({ ...m, [active]: "error" })));
    data
      .decision(active)
      .then(async (d) => {
        if (!alive) return;
        setFactorsById((m) => ({ ...m, [active]: d.factors }));
        const frames = await data.frames(active);
        if (alive) setColourById((m) => ({ ...m, [active]: teamColourOf(frames, d.player_role.number) }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [active, youLobby]);

  const res = results[active];
  const lb = res && res !== "error" ? res : null;
  const err = res === "error";
  const factors = factorsById[active] ?? [];
  const field = fieldColours(colourById[active]).field;

  const entry = index.find((d) => d.id === active);
  const players = lb?.rows.filter((r) => r.kind === "player") ?? [];
  const bins = Array.from({ length: MAX_TOTAL / BIN + 1 }, () => 0);
  // Every player's total, not just the top rows, so the strip shows the whole field.
  for (const t of lb?.totals ?? players.map((p) => p.total)) bins[Math.max(0, Math.min(bins.length - 1, Math.floor(t / BIN)))]++; // below 0 counts in the first bin
  const peak = Math.max(1, ...bins);

  const youIdx = you && lb ? lb.rows.findIndex((r) => r.kind === "player" && r.name === you.name && r.lobby_code === you.lobby) : -1;
  const youRow = youIdx >= 0 ? lb!.rows[youIdx] : null;
  const youRank = youRow ? players.indexOf(youRow) + 1 : 0;
  const revealed = !!lb?.revealed;
  // Before a reveal the route sends no team or engine; drop any non-player row to be safe.
  const shown = lb ? (revealed ? lb.rows : players).slice(0, TOP) : [];

  const markers: { key: string; total: number; label: string; strong: boolean }[] = lb
    ? [
        ...(revealed && lb.team ? [{ key: "team", total: lb.team.total, label: lb.team.name, strong: false }] : []),
        ...(revealed && lb.engine ? [{ key: "engine", total: lb.engine.total, label: COPY.reveal.engine, strong: false }] : []),
        ...(youRow ? [{ key: "you", total: youRow.total, label: COPY.leaderboard.youMarker, strong: true }] : []),
      ]
    : [];

  return (
    <main className="min-h-dvh bg-ink text-white">
      <div className="on-dark mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-5 pb-12 pt-0 md:px-14">
        <div className="meta flex h-13 items-center justify-between gap-4 md:h-24 md:text-lg">
          <span className="truncate">
            {COPY.homeUi.leaderboardTitle} · {COPY.homeUi.allRooms}
          </span>
          {lb && <span className="shrink-0">{COPY.homeUi.calls(lb.total_players)}</span>}
        </div>

        <header className="flex flex-col gap-4 border-b-2 border-white pb-5 md:flex-row md:items-end md:justify-between">
          <h1 className="display text-3xl md:text-[5rem] md:leading-[0.95]">{COPY.homeUi.leaderboardHeadline}</h1>
          <div className="flex flex-col gap-1 text-sm text-[#bdbdbd] md:items-end md:text-right md:font-mono md:text-base">
            {youLobby && (
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="inline-block size-3" style={{ backgroundColor: field }} />
                {COPY.homeUi.yourMark}
              </span>
            )}
            <Link href="/" className="font-sans font-bold text-white underline decoration-2 underline-offset-4 hover:decoration-[#8c8c8c]">
              {COPY.leaderboard.back}
            </Link>
          </div>
        </header>

        <nav role="tablist" className="-mx-5 flex gap-6 overflow-x-auto px-5 md:mx-0 md:px-0">
          {index.map((d) => {
            const on = d.id === active;
            return (
              <button
                key={d.id}
                role="tab"
                aria-selected={on}
                onClick={() => setActive(d.id)}
                className={`h-11 shrink-0 whitespace-nowrap border-b-[3px] text-base font-bold transition-colors duration-150 md:text-lg ${
                  on ? "border-white text-white" : "border-transparent text-[#9a9a9a] hover:text-white"
                }`}
              >
                {COPY.leaderboard.title(d.race, d.lap)}
              </button>
            );
          })}
        </nav>

        {err && <p className="text-lg font-bold">{COPY.error.gaveUp}</p>}
        {!lb && !err && <p className="meta text-[#bdbdbd]">{COPY.leaderboard.loading}</p>}

        {lb && entry && (
          <>
            {youRow && (
              <p className="rise display text-2xl md:text-3xl">
                <span className="nums">{COPY.leaderboard.you(youRank, lb.total_players)}</span>
              </p>
            )}

            {/* Distribution: totals 0 to 150 in 10-point bins; team, engine and you marked above the bars. */}
            {players.length > 0 && (
            <figure className="flex flex-col gap-2 md:max-w-[50%]">
              <figcaption className="meta text-[#bdbdbd]">{COPY.homeUi.distribution}</figcaption>
              <div className="relative" style={{ paddingTop: markers.length * LABEL_ROW + 6 }}>
                <div className="flex h-[88px] items-end gap-[2px] border-b-2 border-white md:h-[104px]" aria-hidden>
                  {bins.map((n, i) => (
                    <div key={i} className="flex-1 bg-white/30" style={{ height: `${(n / peak) * 100}%`, minHeight: n ? 3 : 0 }} />
                  ))}
                </div>
                {markers.map((m, i) => {
                  const frac = Math.max(0, Math.min(MAX_TOTAL, m.total)) / (MAX_TOTAL + BIN);
                  return (
                    <div key={m.key} className="absolute bottom-0 top-0" style={{ left: `${frac * 100}%` }}>
                      <div className={`absolute bottom-0 bg-white ${m.strong ? "w-[3px]" : "w-0.5 opacity-70"}`} style={{ top: i * LABEL_ROW + 10 }} />
                      <span
                        className={`meta absolute whitespace-nowrap leading-none ${m.strong ? "" : "text-[#bdbdbd]"}`}
                        style={{ top: i * LABEL_ROW, ...(frac > 0.6 ? { right: 6 } : { left: 6 }) }}
                      >
                        {m.label} {m.total}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="nums flex justify-between text-xs text-[#bdbdbd]" style={{ paddingRight: `${(BIN / (MAX_TOTAL + BIN)) * 100}%` }}>
                {[0, 50, 100, 150].map((v) => (
                  <span key={v}>{v}</span>
                ))}
              </div>
            </figure>
            )}

            {players.length === 0 ? (
              <p className="text-lg">
                {COPY.leaderboard.empty(entry.race, entry.lap)}{" "}
                <Link href="/" className="font-bold underline decoration-2 underline-offset-4">
                  {COPY.home.create}
                </Link>
              </p>
            ) : players.length === 1 ? (
              <p className="text-base text-[#bdbdbd]">{COPY.leaderboard.first}</p>
            ) : null}

            {!revealed && players.length > 0 && <p className="max-w-[60ch] text-base text-[#bdbdbd]">{COPY.leaderboard.hidden}</p>}
            {players.length > 0 && (
              <Board rows={shown} factors={factors} youRow={youRow} youRank={youRank} youBelow={youIdx >= TOP} revealed={revealed} youLobby={youLobby} field={field} />
            )}
            <p className="nums text-xs text-[#bdbdbd]">{COPY.leaderboard.footer(lb.total_players)}</p>
            <p className="text-sm text-[#bdbdbd]">{COPY.end.engineNote}</p>
          </>
        )}
      </div>
    </main>
  );
}

// Ranked rows: two columns on a laptop, one on a phone. Nickname, room, call, score. Engine and the real team
// are unnumbered benchmark rows.
const ROW = "grid grid-cols-[40px_minmax(0,1fr)_52px] md:grid-cols-[56px_minmax(0,1fr)_96px_104px] items-center gap-x-3 md:gap-x-4";

function Board({
  rows,
  factors,
  youRow,
  youRank,
  youBelow,
  revealed,
  youLobby,
  field,
}: {
  rows: LeaderboardRow[];
  factors: string[];
  youRow: LeaderboardRow | null;
  youRank: number;
  youBelow: boolean;
  // False: calls and factors are withheld, so those cells stay empty instead of reading "No call".
  revealed: boolean;
  youLobby: string | null;
  field: string;
}) {
  let rank = 0;
  const line = (r: LeaderboardRow, shownRank: number | null, inverted: boolean, idx: number) => {
    const mine = r.kind === "player" && !!youLobby && r.lobby_code === youLobby;
    return (
      <div
        role="row"
        // Names and lobby codes repeat across rooms (lobby_code is null before a reveal), so the index keeps keys unique.
        key={`${idx}-${r.kind}-${r.name}-${r.lobby_code}-${inverted ? "you" : ""}`}
        className={`${ROW} min-h-[72px] border-b px-2 md:min-h-[88px] ${inverted ? "border-white bg-white text-ink" : "border-[#3a3a3a]"} ${r.kind === "player" ? "" : "text-[#d6d6d6]"}`}
      >
        {/* The your-room square sits in the rank cell so it never overlaps the code or the name. */}
        <span role="cell" className={`nums flex items-center gap-1.5 text-sm ${inverted ? "" : "text-[#bdbdbd]"}`}>
          {mine && <span role="img" aria-label={COPY.homeUi.yourMark} className="inline-block size-2.5 shrink-0" style={{ backgroundColor: field }} />}
          {shownRank != null ? String(shownRank).padStart(2, "0") : ""}
        </span>
        <span role="cell" className="flex min-w-0 flex-col">
          <span className="truncate text-2xl font-black tracking-tight md:text-[2rem] md:leading-tight">
            {r.kind === "player" ? r.name : r.kind === "team" ? COPY.leaderboard.teamRow(r.name) : COPY.leaderboard.engineRow}
          </span>
          {r.kind === "player" && r.lobby_code && <span className="nums truncate text-sm">{COPY.room.heading(r.lobby_code)}</span>}
          <span className={`nums flex items-center gap-2 text-xs ${inverted ? "text-ink-2" : "text-[#bdbdbd]"}`}>
            {revealed && (
              <span className="font-sans text-sm font-bold md:hidden">
                <CallWord call={r.call} />
              </span>
            )}
            {revealed && factors.length > 0 && (
              <span className="hidden items-center gap-1 md:inline-flex" aria-label={r.factors_named.map(factorLabel).join(", ")}>
                {factors.map((f) =>
                  r.factors_named.includes(f) ? <Check key={f} /> : <span key={f} aria-hidden className="inline-block h-0.5 w-2.5 bg-current opacity-40" />,
                )}
              </span>
            )}
          </span>
        </span>
        <span role="cell" className="hidden truncate text-lg font-bold md:block">
          {revealed && <CallWord call={r.call} />}
        </span>
        <span role="cell" className="nums text-right text-xl font-bold md:text-[1.875rem]">
          {r.total}
        </span>
      </div>
    );
  };
  const body = rows.map((r, i) => {
    if (r.kind === "player") rank++;
    return line(r, r.kind === "player" ? rank : null, r === youRow, i);
  });
  const half = Math.ceil(body.length / 2);
  const cols = body.length > 6 ? [body.slice(0, half), body.slice(half)] : [body];
  // Each column carries its own header in the same grid as its rows, so headers line up with the values.
  // On a phone the columns stack, so the second header is hidden there.
  const head = (second: boolean) => (
    <div role="row" className={`${ROW} h-9 border-b-2 border-white px-2 ${second ? "hidden md:grid" : ""}`}>
      <span role="columnheader" className="meta">{COPY.leaderboard.columns.rank}</span>
      <span role="columnheader" className="meta">{COPY.leaderboard.columns.player}</span>
      <span role="columnheader" className="meta hidden md:block">{COPY.leaderboard.columns.call}</span>
      <span role="columnheader" className="meta text-right">{COPY.leaderboard.columns.score}</span>
    </div>
  );
  return (
    <div role="table" aria-label={COPY.homeUi.leaderboardTitle} className="flex flex-col">
      <div className={`grid grid-cols-1 md:gap-x-12 ${cols.length > 1 ? "md:grid-cols-2" : ""}`}>
        {cols.map((c, i) => (
          <div key={i} className="flex min-w-0 flex-col">
            {head(i > 0)}
            {c}
          </div>
        ))}
      </div>
      {youBelow && youRow && (
        <div className={`flex flex-col ${cols.length > 1 ? "md:w-[calc(50%-24px)]" : ""}`}>
          <div aria-hidden className="h-8 px-2 text-base text-[#bdbdbd]">
            …
          </div>
          {line(youRow, youRank, true, -1)}
        </div>
      )}
    </div>
  );
}
