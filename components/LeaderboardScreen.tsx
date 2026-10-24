"use client";
// `/leaderboard`: global standings per decision point. The real team, the engine and everyone's calls show only when
// this browser played in a lobby that has revealed the decision (the route checks); otherwise names and totals.
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { COPY, factorLabel } from "@/lib/copy";
import { api, data, type LeaderboardResponse, type LeaderboardRow } from "@/lib/client/api";
import { noopSubscribe, parsePlayed, recallPlayedRaw } from "@/lib/client/identity";
import { MAX_TOTAL, fmtSeconds, tla } from "@/lib/client/race";
import type { DecisionIndexEntry } from "@/lib/types";
import { CallWord } from "./ui";

const BIN = 10;
const TOP = 20;
const LABEL_ROW = 18;

export function LeaderboardScreen({ index }: { index: DecisionIndexEntry[] }) {
  const [active, setActive] = useState(index[0]?.id ?? "");
  const [results, setResults] = useState<Record<string, LeaderboardResponse | "error">>({});
  const [factorsById, setFactorsById] = useState<Record<string, string[]>>({});
  const youRaw = useSyncExternalStore(noopSubscribe, () => recallPlayedRaw(active), () => null);
  const you = parsePlayed(youRaw);
  const youLobby = you?.lobby ?? null;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    api
      .leaderboard(active, youLobby)
      .then((r) => alive && setResults((m) => ({ ...m, [active]: r })))
      .catch(() => alive && setResults((m) => ({ ...m, [active]: "error" })));
    data
      .decision(active)
      .then((d) => alive && setFactorsById((m) => ({ ...m, [active]: d.factors })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [active, youLobby]);

  const res = results[active];
  const lb = res && res !== "error" ? res : null;
  const err = res === "error";
  const factors = factorsById[active] ?? [];

  const entry = index.find((d) => d.id === active);
  const players = lb?.rows.filter((r) => r.kind === "player") ?? [];
  const bins = Array.from({ length: MAX_TOTAL / BIN + 1 }, () => 0);
  // Every player's total, not just the top rows, so the strip shows the whole field.
  for (const t of lb?.totals ?? players.map((p) => p.total)) bins[Math.min(bins.length - 1, Math.floor(t / BIN))]++;
  const peak = Math.max(1, ...bins);

  const youIdx = you && lb ? lb.rows.findIndex((r) => r.kind === "player" && r.name === you.name && r.lobby_code === you.lobby) : -1;
  const youRow = youIdx >= 0 ? lb!.rows[youIdx] : null;
  const youRank = youRow ? players.indexOf(youRow) + 1 : 0;
  const revealed = !!lb?.revealed;
  // Before a reveal the route sends no team or engine; drop any non-player row to be safe.
  const shown = lb ? (revealed ? lb.rows : players).slice(0, TOP) : [];

  const markers: { key: string; total: number; label: string; cls: string }[] = lb
    ? [
        ...(revealed && lb.team ? [{ key: "team", total: lb.team.total, label: lb.team.name, cls: "bg-ink-2 text-ink-2" }] : []),
        ...(revealed && lb.engine ? [{ key: "engine", total: lb.engine.total, label: COPY.reveal.engine, cls: "bg-engine text-engine" }] : []),
        ...(youRow ? [{ key: "you", total: youRow.total, label: COPY.leaderboard.youMarker, cls: "bg-ink text-ink" }] : []),
      ]
    : [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-12 md:py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <nav role="tablist" className="flex flex-wrap gap-6">
          {index.map((d) => (
            <button
              key={d.id}
              role="tab"
              aria-selected={d.id === active}
              onClick={() => setActive(d.id)}
              className={`h-12 border-b-2 text-24 font-semibold transition-colors duration-[120ms] ${
                d.id === active ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink"
              }`}
            >
              {COPY.leaderboard.title(d.race, d.lap)}
            </button>
          ))}
        </nav>
        <Link href="/" className="text-20 text-ink-2 underline underline-offset-4 hover:text-ink">
          {COPY.leaderboard.back}
        </Link>
      </div>

      {err && <p className="text-24 text-flag-red">{COPY.error.gaveUp}</p>}
      {!lb && !err && <p className="text-20 text-ink-3">{COPY.leaderboard.loading}</p>}

      {lb && entry && (
        <>
          {/* Distribution strip: totals 0 to 150 in 10-point bins, with team, engine and you marked. */}
          {/* Labels sit in their own strip above the bars (one 18 px row per marker); only the 2 px lines cross the bars. */}
          <div className="relative" style={{ paddingTop: markers.length * LABEL_ROW + 4 }}>
            <div className="flex h-[120px] items-end gap-0.5">
              {bins.map((n, i) => (
                <div key={i} className="flex-1 bg-ink-3" style={{ height: `${(n / peak) * 100}%`, minHeight: n ? 2 : 0 }} />
              ))}
            </div>
            {markers.map((m, i) => {
              const frac = Math.min(MAX_TOTAL, m.total) / (MAX_TOTAL + BIN);
              const [line, text] = m.cls.split(" ");
              return (
                <div key={m.key} className="absolute bottom-0 top-0" style={{ left: `${frac * 100}%` }}>
                  <div className={`absolute bottom-0 w-0.5 ${line}`} style={{ top: i * LABEL_ROW + 8 }} />
                  <span
                    className={`absolute whitespace-nowrap text-14 font-semibold uppercase leading-none tracking-label ${text}`}
                    style={{ top: i * LABEL_ROW, ...(frac > 0.6 ? { right: 6 } : { left: 6 }) }}
                  >
                    {m.label} <span className="nums">{m.total}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="nums flex justify-between text-14 text-ink-3" style={{ paddingRight: `${(BIN / (MAX_TOTAL + BIN)) * 100}%` }}>
            {[0, 50, 100, 150].map((v) => (
              <span key={v}>{v}</span>
            ))}
          </div>

          {youRow && <p className="nums text-40 font-semibold stretch-75">{COPY.leaderboard.you(youRank, lb.total_players, youRow.percentile)}</p>}

          {players.length === 0 ? (
            <p className="text-24 text-ink-2">
              {COPY.leaderboard.empty(entry.race, entry.lap)}{" "}
              <Link href="/" className="text-ink underline underline-offset-4">
                {COPY.home.create}
              </Link>
            </p>
          ) : players.length === 1 ? (
            <p className="text-20 text-ink-3">{COPY.leaderboard.first}</p>
          ) : null}

          {!revealed && players.length > 0 && <p className="text-20 text-ink-2">{COPY.leaderboard.hidden}</p>}
          <Table rows={shown} factors={factors} youRow={youRow} youRank={youRank} youBelow={youIdx >= TOP} revealed={revealed} />
          <p className="nums text-16 text-ink-3">{COPY.leaderboard.footer(lb.total_players)}</p>
        </>
      )}
    </main>
  );
}

// Phone shows rank, code, call, score; md and up adds name, factors, time and percentile.
const COLS = "grid-cols-[36px_72px_1fr_48px] md:grid-cols-[56px_72px_minmax(120px,1fr)_160px_120px_72px_96px_112px]";
const WIDE = "hidden md:block";

function Table({
  rows,
  factors,
  youRow,
  youRank,
  youBelow,
  revealed,
}: {
  rows: LeaderboardRow[];
  factors: string[];
  youRow: LeaderboardRow | null;
  youRank: number;
  youBelow: boolean;
  // False: calls and factors are withheld, so those cells stay empty instead of reading "No call".
  revealed: boolean;
}) {
  let rank = 0;
  const line = (r: LeaderboardRow, shownRank: number | null, inverted: boolean) => (
    <div
      role="row"
      key={`${r.kind}-${r.name}-${r.lobby_code}`}
      className={`grid ${COLS} h-9 items-center gap-x-3 px-4 text-20 md:gap-x-4 ${inverted ? "bg-ink text-bg" : r.kind === "engine" ? "bg-engine-deep" : "bg-surface"}`}
    >
      <span role="cell" className="nums text-right font-semibold">{shownRank ?? ""}</span>
      <span role="cell" className="font-bold uppercase stretch-75">{r.kind === "player" ? tla(r.name) : r.kind === "engine" ? COPY.reveal.engine : COPY.reveal.team}</span>
      <span role="cell" className={`truncate ${WIDE}`}>{r.kind === "team" ? COPY.leaderboard.teamRow(r.name) : r.kind === "engine" ? "" : r.name}</span>
      <span role="cell" className="whitespace-nowrap">{revealed && <CallWord call={r.call} className="text-20" />}</span>
      <span role="cell" className="hidden gap-2 md:flex" aria-label={r.factors_named.map(factorLabel).join(", ")}>
        {revealed && factors.map((f) => (
          <span key={f} className={r.factors_named.includes(f) || r.kind === "engine" || inverted ? "" : "text-ink-3"}>
            {r.factors_named.includes(f) ? COPY.reveal.named : COPY.reveal.notNamed}
          </span>
        ))}
      </span>
      <span role="cell" className={`nums text-right ${WIDE}`}>{r.seconds_to_call != null ? fmtSeconds(r.seconds_to_call) : ""}</span>
      <span role="cell" className="nums text-right font-semibold">{r.total}</span>
      <span role="cell" className={`nums text-right ${WIDE}`}>{r.percentile}%</span>
    </div>
  );
  return (
    <div role="table" className="flex flex-col gap-0.5">
      <div role="row" className={`grid ${COLS} h-8 items-center gap-x-3 px-4 text-14 md:gap-x-4 font-semibold uppercase tracking-label text-ink-3`}>
        <span role="columnheader" className="text-right">{COPY.leaderboard.columns.rank}</span>
        <span role="columnheader" />
        <span role="columnheader" className={WIDE}>{COPY.leaderboard.columns.player}</span>
        <span role="columnheader">{COPY.leaderboard.columns.call}</span>
        <span role="columnheader" className={WIDE}>{COPY.leaderboard.columns.factors}</span>
        <span role="columnheader" className={`text-right ${WIDE}`}>{COPY.leaderboard.columns.time}</span>
        <span role="columnheader" className="text-right">{COPY.leaderboard.columns.score}</span>
        <span role="columnheader" className={`text-right ${WIDE}`}>{COPY.leaderboard.columns.pct}</span>
      </div>
      {rows.map((r) => {
        if (r.kind === "player") rank++;
        return line(r, r.kind === "player" ? rank : null, r === youRow);
      })}
      {youBelow && youRow && (
        <>
          <div className="h-9 px-4 text-20 text-ink-3">…</div>
          {line(youRow, youRank, true)}
        </>
      )}
    </div>
  );
}
