"use client";
// Round 7: the one screen after the calls, shared by the host (HostReveal) and the phone (PlayerResult).
// What happened, everyone's call in their own words with the reasoning score and verdict, then one ranking of
// players, engine and real team with shared ranks. Everything comes from GET /reveal?part=results.
import { COPY } from "@/lib/copy";
import type { ResultCar, ResultEntry, ResultsResponse } from "@/lib/client/api";
import { tla } from "@/lib/client/race";
import { CallWord } from "./ui";

export function carColour(results: ResultsResponse, code: string | null): string | null {
  return results.cars.find((c) => c.code === code)?.team_colour ?? null;
}

export function CarChip({ results, code, className = "" }: { results: ResultsResponse; code: string | null; className?: string }) {
  if (!code) return null;
  const colour = carColour(results, code);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 font-mono text-sm font-bold ${className}`}>
      {colour && <span aria-hidden className="inline-block h-3.5 w-1.5" style={{ backgroundColor: colour }} />}
      {code}
    </span>
  );
}

// ✓ / ✗ in ink with a text alternative; players only (team rows never get a mark).
export function RightMark({ right, className = "" }: { right: boolean | null; className?: string }) {
  if (right === null) return null;
  return (
    <span role="img" aria-label={right ? COPY.end.right : COPY.end.wrong} className={className}>
      {right ? "✓" : "✗"}
    </span>
  );
}

export function entryLabel(e: ResultEntry, results: ResultsResponse, short = false): string {
  const multi = results.cars.length > 1;
  if (e.kind === "player") return short ? tla(e.name) : e.name;
  const base = e.kind === "engine" ? COPY.end.engine : COPY.end.teamRow(e.name);
  return multi && e.driver_code ? COPY.end.carTag(base, e.driver_code) : base;
}

// "Box was right: boxing gained 15.6 s by lap 26." for the main car; one short line per other car.
export function Happened({ results, carCode, big = false }: { results: ResultsResponse; carCode: string | null; big?: boolean }) {
  const main: ResultCar | undefined = results.cars.find((c) => c.code === carCode) ?? results.cars[0];
  if (!main) return null;
  const others = results.cars.filter((c) => c !== main);
  return (
    <div className="flex flex-col gap-2">
      <h1 className={`display leading-[0.98] ${big ? "text-[3.5rem]" : "text-[2rem]"}`}>{COPY.end.happened(main.correct, main.swing_s, main.reveal_to_lap)}</h1>
      <p className={`${big ? "text-xl" : "text-base"} font-medium`}>
        {COPY.end.teamDid(main.team, main.team_call)}
        {others.map((c) => (
          <span key={c.code}> {COPY.end.happenedCar(c.code, c.correct, c.swing_s)}</span>
        ))}
      </p>
    </div>
  );
}

export function ScoreLine({ e, className = "" }: { e: ResultEntry; className?: string }) {
  return <p className={`nums ${className}`}>{COPY.end.line(e.call ? e.right : null, e.stakes, e.reasoning, e.points)}</p>;
}

// One ranking table: players, engine and real team; equal points share a rank ("=1").
export function RankingTable({
  results,
  me,
  size = "host",
}: {
  results: ResultsResponse;
  me?: string | null;
  size?: "host" | "phone";
}) {
  const rows = results.ranking;
  const dense = rows.length > 9;
  const host = size === "host";
  const cols = host ? "52px minmax(0,1fr) 92px 60px 76px" : "40px minmax(0,1fr) 72px 48px 56px";
  const rowH = host ? (dense ? "min-h-[38px]" : "min-h-[52px]") : "min-h-11";
  return (
    <div role="table" className="flex flex-col">
      <div role="row" className="grid items-end gap-x-3 border-b-2 border-ink pb-2" style={{ gridTemplateColumns: cols }}>
        <span role="columnheader" className="meta">{COPY.end.cols.rank}</span>
        <span role="columnheader" className="meta">{COPY.end.cols.who}</span>
        <span role="columnheader" className="meta">{COPY.end.cols.call}</span>
        <span role="columnheader" className="meta text-right">{COPY.end.cols.reasoning}</span>
        <span role="columnheader" className="meta text-right">{COPY.end.cols.points}</span>
      </div>
      {rows.map((r) => {
        const mine = r.kind === "player" && r.name === me;
        const bench = r.kind !== "player";
        return (
          <div
            role="row"
            key={`${r.kind}:${r.name}:${r.driver_code}`}
            className={`grid ${rowH} items-center gap-x-3 border-b ${mine ? "border-ink bg-ink text-white" : bench ? "border-line bg-soft" : "border-line"}`}
            style={{ gridTemplateColumns: cols }}
          >
            <span role="cell" className={`nums pl-1 font-bold ${host ? "text-xl" : "text-base"}`}>
              {r.rank_label}
            </span>
            <span role="cell" className={`flex min-w-0 items-baseline gap-2 ${bench ? "font-bold" : "font-black tracking-tight"} ${host ? (bench ? "text-lg" : "text-2xl") : "text-base"}`}>
              <span className="truncate">{entryLabel(r, results, host && !bench)}</span>
              {r.kind === "player" && results.cars.length > 1 && <CarChip results={results} code={r.driver_code} className="text-xs" />}
            </span>
            <span role="cell" className={`font-bold ${host ? "text-lg" : "text-sm"}`}>
              <CallWord call={r.call} />
            </span>
            <span role="cell" className={`nums text-right ${host ? "text-lg" : "text-sm"}`}>
              {r.call ? r.reasoning : "–"}
            </span>
            <span role="cell" className={`nums pr-1 text-right font-bold ${host ? "text-2xl" : "text-lg"}`}>
              {COPY.end.points(r.points)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// "Scoring the calls" with the seconds it has taken: one fixed label while the server grades.
export function Scoring({ elapsedMs, failed, big = false }: { elapsedMs: number; failed: boolean; big?: boolean }) {
  return (
    <div className={`flex flex-col gap-3 ${big ? "px-14 pt-40" : "px-5 pt-24"}`} aria-live="polite">
      <p className={`display leading-none ${big ? "text-[4.5rem]" : "text-[2.5rem]"}`}>{COPY.end.scoring}</p>
      <p className={`nums ${big ? "text-2xl" : "text-lg"} text-ink-2`}>{failed ? COPY.end.retry : COPY.end.scoringFor(Math.max(0, Math.floor(elapsedMs / 1000)))}</p>
    </div>
  );
}
