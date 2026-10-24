"use client";
// Round 7: the end-of-game summary, one component for moment and race lobbies (a moment game is a game with
// one moment). Host: a team-colour band with the winner, one list (players ranked, Engine and the real team as
// grey unnumbered benchmark rows placed by score), and for races a freeze-by-freeze breakdown beside it.
// Phone: your total and rank first, the ranking, your calls, every moment. Every score row shows its
// arithmetic ("Right call +20 · Reasoning 27/50 +31 = +51", lib/client/score.ts). Everything comes from
// GET /reveal?part=results (lib/client/results.ts).
import { useRouter } from "next/navigation";
import Link from "next/link";
import { COPY, ordinal } from "@/lib/copy";
import type { GameSummary, MomentCar, MomentEntry, RankRow, SummaryAudible, SummaryMoment } from "@/lib/client/api";
import { WEIGHTS, playerRanks, rankText, splitPoints, type PlayerRank, type Split } from "@/lib/client/score";
import { STAKES_MAX, STAKES_PER_SECOND } from "@/lib/scoring";
import { Brand, Button, CallWord } from "./ui";

// ---- Helpers ----

const colourOf = (s: GameSummary, code: string | null) => s.cars.find((c) => c.code === code)?.team_colour ?? null;

export function CarChip({ summary, code, className = "" }: { summary: GameSummary; code: string | null; className?: string }) {
  if (!code) return null;
  const colour = colourOf(summary, code);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 font-mono text-sm font-bold ${className}`}>
      {colour && <span aria-hidden className="inline-block h-3.5 w-1.5" style={{ backgroundColor: colour }} />}
      {code}
    </span>
  );
}

// The right call for an entry, after any luck verdict (Round 9) on its car.
function carFor(m: SummaryMoment, e: { driver_code: string | null }): MomentCar | undefined {
  return m.cars.find((c) => c.code === e.driver_code) ?? m.cars[0];
}
function rightOf(m: SummaryMoment, e: MomentEntry): boolean | null {
  if (!e.call) return null;
  const car = carFor(m, e);
  return car?.final_right_call ? e.call === car.final_right_call : e.right;
}

// One call's two parts; null for no call.
function splitOf(m: SummaryMoment, e: MomentEntry): Split | null {
  if (!e.call) return null;
  return splitPoints(e.stakes, !!rightOf(m, e), e.reasoning, e.points);
}
function audibleSplit(a: SummaryAudible): Split | null {
  return a.status === "scored" ? splitPoints(a.stakes, !!a.right, a.reasoning, a.points) : null;
}

// ✓ / ✗ in ink with a text alternative.
export function RightMark({ right, className = "" }: { right: boolean | null; className?: string }) {
  if (right === null) return null;
  return (
    <span role="img" aria-label={right ? COPY.end.right : COPY.end.wrong} className={className}>
      {right ? "✓" : "✗"}
    </span>
  );
}

// Players by the nickname they typed; Engine and the real team by name, with the car when several cars played.
function label(e: { kind: string; name: string; driver_code: string | null }, s: GameSummary): string {
  if (e.kind === "player") return e.name;
  const base = e.kind === "engine" ? COPY.end.engine : COPY.end.teamRow(e.name);
  return s.cars.length > 1 && e.driver_code ? COPY.end.carTag(base, e.driver_code) : base;
}

const sameRow = (r: { kind: string; name: string; driver_code: string | null }, e: { kind: string; name: string; driver_code: string | null }) =>
  r.kind === e.kind && (r.kind === "player" ? r.name === e.name : r.driver_code === e.driver_code);

// A ranking row's totals split into call and reasoning parts, across every freeze (and, for players, audibles).
function rowSums(s: GameSummary, r: RankRow): { call: number; reasoning: number; total: number } {
  let reasoning = 0;
  for (const m of s.moments)
    for (const e of m.entries) {
      if (!sameRow(r, e)) continue;
      const sp = splitOf(m, e);
      if (sp) reasoning += sp.reasoning;
    }
  if (r.kind === "player")
    for (const a of s.audibles) {
      if (a.name !== r.name) continue;
      const sp = audibleSplit(a);
      if (sp) reasoning += sp.reasoning;
    }
  return { call: r.points - reasoning, reasoning, total: r.points };
}

// Freeze calls only; audibles are counted on their own line, so "4 of 4 calls right" matches the ticks.
function freezeTally(s: GameSummary, r: RankRow): { right: number; calls: number } {
  let right = 0;
  let calls = 0;
  for (const m of s.moments)
    for (const e of m.entries) {
      if (!sameRow(r, e) || !e.call) continue;
      calls++;
      if (rightOf(m, e)) right++;
    }
  return { right, calls };
}
function audibleTally(s: GameSummary, name: string): { n: number; points: number } {
  const mine = s.audibles.filter((a) => a.name === name);
  return { n: mine.length, points: mine.reduce((t, a) => t + a.points, 0) };
}

// Every player, plus at most two benchmark rows (the best Engine row and the best real-team row), in score
// order. With many cars in play the full set would push players off the host screen.
function boardRows(s: GameSummary): RankRow[] {
  const players = s.ranking.filter((r) => r.kind === "player");
  const best = (k: RankRow["kind"]) => s.ranking.filter((r) => r.kind === k).sort((a, b) => b.points - a.points)[0];
  const bench = [best("engine"), best("team")].filter(Boolean) as RankRow[];
  return [...players, ...bench].sort((a, b) => b.points - a.points || (a.kind === "player" ? 0 : 1) - (b.kind === "player" ? 0 : 1));
}

function winnerLine(s: GameSummary): string {
  if (!s.winners || !s.winners.names.length) return COPY.end.noWinner;
  const names = s.winners.names;
  return names.length > 1 ? COPY.end.tie(names, s.winners.points) : COPY.end.wins(names[0], s.winners.points);
}

// "Boxing gained 15.6 s." for the main car of a moment, then the team's call and the stakes.
function momentLine(s: GameSummary, m: SummaryMoment, carCode: string | null): { head: string; sub: string; luck: string | null; stakes: number | null } {
  const main = m.cars.find((c) => c.code === carCode) ?? m.cars[0];
  if (!main) return { head: COPY.end.momentHead(m.lap), sub: "", luck: null, stakes: null };
  const right = main.final_right_call ?? main.correct;
  const others = m.cars.filter((c) => c !== main).map((c) => COPY.end.carRight(c.code, c.final_right_call ?? c.correct, c.swing_s));
  return {
    head: COPY.end.wasRight(right, main.swing_s),
    sub: [COPY.end.teamDid(main.team, main.team_call), `${COPY.end.stakes(main.stakes)}.`, ...others.map((o) => `${o}.`)].join(" "),
    luck: main.luck && main.explanation ? main.explanation : null,
    stakes: main.stakes,
  };
}

function luckNote(m: SummaryMoment, e: MomentEntry): string | null {
  const car = carFor(m, e);
  if (!car?.luck || !car.explanation || !e.call) return null;
  return rightOf(m, e) ? `${COPY.end.unlucky} ${car.explanation}` : `${COPY.end.lucky} ${car.explanation}`;
}

const triggerText = (t: string) => COPY.race.triggers[t] ?? t;
const howText = COPY.end.how(WEIGHTS, STAKES_PER_SECOND, STAKES_MAX);

// "Scoring the calls" with the seconds it has taken: one fixed label while the server grades.
export function Scoring({ elapsedMs, failed, big = false }: { elapsedMs: number; failed: boolean; big?: boolean }) {
  return (
    <div className={`flex flex-col gap-3 ${big ? "px-14 pt-40" : "px-5 pt-24"}`} aria-live="polite">
      <p className={`display leading-none ${big ? "text-[4.5rem]" : "text-[2.5rem]"}`}>{COPY.end.scoring}</p>
      <p className={`nums ${big ? "text-2xl" : "text-lg"} text-ink-2`}>{failed ? COPY.end.retry : COPY.end.scoringFor(Math.max(0, Math.floor(elapsedMs / 1000)))}</p>
    </div>
  );
}

// ---- Host ----

export function HostSummary({ summary: s, code, carCode }: { summary: GameSummary; code: string; carCode: string | null }) {
  const router = useRouter();
  const single = s.moments.length === 1 && s.audibles.length === 0;
  const m0 = s.moments[0];
  const line = single && m0 ? momentLine(s, m0, carCode) : null;
  const rows = boardRows(s);
  const ranks = playerRanks(s.ranking);
  const size = rows.length <= 5 ? "lg" : rows.length <= 8 ? "md" : rows.length <= 10 ? "sm" : "xs";
  return (
    <main className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header className="bg-field px-14 pb-6 pt-7 text-on-field">
        <div className="flex items-center justify-between gap-6 font-mono text-lg font-bold uppercase">
          <span>{COPY.end.status(s.race)}</span>
          <span>{COPY.host.room(code)}</span>
        </div>
        <h1 className="display mt-3 text-[4.5rem] leading-[0.95]">{winnerLine(s)}</h1>
        <p className="mt-3 text-2xl font-bold">
          {line ? (
            <>
              {line.head} <span className="font-medium">{line.sub}</span>
            </>
          ) : (
            COPY.end.gameLine(s.moments.length, s.audibles.length)
          )}
        </p>
        {line?.luck && <p className="mt-1 text-lg font-medium">{line.luck}</p>}
      </header>

      <section className="grid min-h-0 grid-cols-12 gap-x-10 px-14 pt-5">
        <div className={`flex min-h-0 flex-col overflow-y-auto ${single ? "col-span-12" : "col-span-7"}`}>
          {rows.map((r) => (
            <HostRow key={`${r.kind}:${r.name}:${r.driver_code}`} r={r} s={s} rank={ranks.get(r.name)} size={single ? size : size === "lg" ? "md" : size} single={single} />
          ))}
        </div>
        {!single && (
          <div className="col-span-5 flex min-h-0 flex-col gap-2.5 overflow-hidden border-t-2 border-ink pt-3">
            <span className="meta text-ink-2">{COPY.end.moments}</span>
            {s.moments.map((m) => (
              <HostMoment key={m.lap} m={m} s={s} carCode={carCode} />
            ))}
            {s.audibles.length > 0 && <HostAudibles list={s.audibles} />}
          </div>
        )}
      </section>

      <footer className="flex items-end justify-between gap-6 px-14 pb-7 pt-4">
        <div className="flex max-w-[100ch] flex-col gap-1">
          <p className="text-lg font-bold leading-snug">{howText}</p>
          <p className="text-base font-medium">{COPY.end.engineNote}</p>
          <p className="text-xs text-ink-2">{COPY.end.credit}</p>
        </div>
        <Button variant="primary" size="md" onClick={() => router.push("/")}>
          {COPY.end.newLobby}
        </Button>
      </footer>
    </main>
  );
}

const HOST_SIZES = {
  lg: { h: "min-h-[96px]", rank: "text-[2.5rem]", name: "text-[2.5rem]", call: "text-[2rem]", quote: "text-xl", sub: "text-lg", pts: "text-[3rem]" },
  md: { h: "min-h-[72px]", rank: "text-[2rem]", name: "text-[2rem]", call: "text-[1.625rem]", quote: "text-lg", sub: "text-base", pts: "text-[2.5rem]" },
  sm: { h: "min-h-[52px]", rank: "text-2xl", name: "text-2xl", call: "text-xl", quote: "text-base", sub: "text-sm", pts: "text-[1.75rem]" },
  xs: { h: "min-h-[44px]", rank: "text-xl", name: "text-xl", call: "text-lg", quote: "text-sm", sub: "text-sm", pts: "text-2xl" },
};

function HostRow({ r, s, rank, size, single }: { r: RankRow; s: GameSummary; rank: PlayerRank | undefined; size: keyof typeof HOST_SIZES; single: boolean }) {
  const z = HOST_SIZES[size];
  const bench = r.kind !== "player";
  const m = s.moments[0];
  const e = single && m ? m.entries.find((x) => sameRow(r, x)) : undefined;
  const cols = single ? "76px minmax(0,260px) 180px minmax(0,1fr) 130px" : "56px minmax(0,1fr) minmax(0,1.5fr) 100px";
  const sp = e && m ? splitOf(m, e) : null;
  const sub = e?.call ? (luckNote(m!, e) ?? e.verdict) : null;
  return (
    <div className={`grid ${z.h} shrink-0 items-center gap-x-6 border-b border-line py-1.5 ${bench ? "text-ink-2" : ""}`} style={{ gridTemplateColumns: cols }}>
      <span className={`nums font-bold ${z.rank}`}>{rank ? rankText(rank) : ""}</span>
      <span className="flex min-w-0 items-baseline gap-3">
        <span className={bench ? `line-clamp-2 font-bold leading-tight ${size === "sm" || size === "xs" ? "text-base" : "text-xl"}` : `display truncate leading-none ${z.name}`}>{label(r, s)}</span>
        {r.kind === "player" && s.cars.length > 1 && <CarChip summary={s} code={r.driver_code} />}
      </span>
      {single ? (
        <>
          <span className={`flex items-baseline gap-2 whitespace-nowrap font-black tracking-tight ${bench ? "text-xl" : z.call}`}>
            <CallWord call={e?.call ?? null} />
            {m && e && <RightMark right={rightOf(m, e)} />}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            {e?.said.trim() ? (
              <q className={`line-clamp-2 font-medium leading-snug ${bench ? "text-base" : z.quote}`}>{e.said}</q>
            ) : (
              <span className={`${z.quote} text-ink-2`}>{e?.call ? COPY.end.noReason : ""}</span>
            )}
            {sp && <span className={`nums font-bold ${z.sub} ${bench ? "" : "text-ink"}`}>{COPY.end.split(sp)}</span>}
            {sub && <span className={`line-clamp-1 ${z.sub} text-ink-2`}>{sub}</span>}
          </span>
        </>
      ) : (
        <RaceRowMiddle r={r} s={s} subClass={z.sub} />
      )}
      <span className={`nums text-right font-black tracking-[-0.03em] ${bench ? "text-[1.75rem]" : z.pts}`}>{COPY.end.points(r.points)}</span>
    </div>
  );
}

// Race board: freeze calls right (audibles on their own), then the total split into calls and reasoning.
function RaceRowMiddle({ r, s, subClass }: { r: RankRow; s: GameSummary; subClass: string }) {
  const t = freezeTally(s, r);
  const a = r.kind === "player" ? audibleTally(s, r.name) : { n: 0, points: 0 };
  const sums = rowSums(s, r);
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-lg font-bold leading-tight">
        {COPY.end.callsRight(t.right, t.calls)}
        {a.n > 0 && <span className="font-medium"> · {COPY.end.audiblesLine(a.n, a.points)}</span>}
      </span>
      <span className={`nums font-medium ${subClass}`}>{COPY.end.sums(sums.call, sums.reasoning, sums.total)}</span>
    </span>
  );
}

function HostMoment({ m, s, carCode }: { m: SummaryMoment; s: GameSummary; carCode: string | null }) {
  const line = momentLine(s, m, carCode);
  return (
    <div className="flex flex-col gap-1 border-b border-line pb-2.5">
      <span className="flex items-baseline gap-3">
        <b className="font-mono text-lg font-bold">L{m.lap}</b>
        <span className="truncate font-mono text-sm font-bold uppercase text-ink-2">{m.triggers.map(triggerText).join(" · ")}</span>
        {line.stakes != null && <b className="nums ml-auto shrink-0 font-mono text-lg font-bold">{COPY.end.stakesTag(line.stakes)}</b>}
      </span>
      <span className="text-lg font-black leading-tight">{line.head}</span>
      {line.luck && <span className="line-clamp-1 text-sm">{line.luck}</span>}
      <span className="flex flex-wrap gap-x-4 gap-y-0.5">
        {m.entries.map((e) => (
          <span key={`${e.kind}:${e.name}:${e.driver_code}`} className={`text-base ${e.kind === "player" ? "font-bold" : "text-ink-2"}`}>
            {e.kind === "player" ? e.name : e.kind === "engine" ? COPY.end.engine : e.name} {e.call ? (rightOf(m, e) ? "✓" : "✗") : "–"}{" "}
            <span className="nums">{COPY.end.points(e.points)}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

function audibleMark(a: SummaryAudible): string {
  return a.status === "scored" ? (a.right ? "✓" : "✗") : "–";
}

function HostAudibles({ list }: { list: SummaryAudible[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="meta text-ink-2">{COPY.end.audibles}</span>
      {list.map((a) => (
        <span key={`${a.name}:${a.lap}`} className="flex gap-3 text-base">
          <b className="max-w-[12ch] truncate font-bold">{a.name}</b>
          <span>{COPY.end.audibleRow(a.lap)}</span>
          <span>{audibleMark(a)}</span>
          <span className="ml-auto font-bold">{a.status === "scored" ? COPY.end.points(a.points) : (COPY.race.audibleStatus[a.status] ?? "")}</span>
        </span>
      ))}
    </div>
  );
}

// ---- Phone (result, ranking, your calls; everyone's calls behind one tap) ----

const shortTrigger = (t: string) => COPY.end.triggerShort[t] ?? triggerText(t);
const chevron = <span aria-hidden className="ml-1 inline-block text-ink-3 transition-transform group-open:rotate-90">›</span>;

// Players only: "You win with +117.", "Alpha wins with +117.", or a shared first place.
function phoneWinnerLine(s: GameSummary, me: string): string {
  const w = s.winners;
  if (!w || !w.names.length) return COPY.end.noWinner;
  const others = w.names.filter((n) => n !== me);
  if (w.names.includes(me)) return others.length ? COPY.end.youShare(others, w.points) : COPY.end.youWin(w.points);
  return others.length > 1 ? COPY.end.tie(others, w.points) : COPY.end.wins(others[0], w.points);
}

type MyRow =
  | { kind: "moment"; lap: number; m: SummaryMoment; e: MomentEntry }
  | { kind: "audible"; lap: number; a: SummaryAudible };

function MyMomentRow({ m, e }: { m: SummaryMoment; e: MomentEntry }) {
  const right = rightOf(m, e);
  const car = carFor(m, e);
  const sp = splitOf(m, e);
  const luck = luckNote(m, e);
  return (
    <details className="group border-b border-soft-2">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 py-2">
        <span className="flex w-12 shrink-0 flex-col">
          <b className="nums font-mono text-sm font-bold">L{m.lap}</b>
          <span className="truncate text-[11px] font-bold uppercase text-ink-2">{shortTrigger(m.triggers[0] ?? "")}</span>
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-black">
            <CallWord call={e.call} /> <RightMark right={right} />
          </span>
          <span className="nums text-xs font-bold leading-tight text-ink-2">{sp ? COPY.end.split(sp, false) : COPY.end.noCallRow}</span>
        </span>
        <span className="nums ml-auto shrink-0 text-lg font-black">{COPY.end.points(e.points)}</span>
        {chevron}
      </summary>
      <div className="flex flex-col gap-1.5 pb-3 pl-[3.75rem] text-sm leading-snug">
        {car && <p className="font-bold">{COPY.end.rightSwing(car.final_right_call ?? car.correct, car.swing_s, car.stakes)}</p>}
        {sp && <p className="nums font-bold">{COPY.end.split(sp)}</p>}
        {e.call && e.verdict && <p>{e.verdict}</p>}
        {luck && <p className="font-bold">{luck}</p>}
        {e.said.trim() && <q className="text-ink-2">{e.said}</q>}
      </div>
    </details>
  );
}

function MyAudibleRow({ a }: { a: SummaryAudible }) {
  const sp = audibleSplit(a);
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-soft-2 py-1.5 text-ink-2">
      <span className="flex w-12 shrink-0 flex-col">
        <b className="nums font-mono text-sm font-bold">L{a.lap}</b>
        <span className="text-[11px] font-bold uppercase">{COPY.end.audibles}</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-bold">
          {COPY.end.boxNow} {audibleMark(a)}
        </span>
        <span className="nums text-xs font-bold leading-tight">{sp ? COPY.end.split(sp, false) : (COPY.race.audibleStatus[a.status] ?? COPY.end.unscored)}</span>
      </span>
      <span className="nums ml-auto text-base font-bold text-ink">{COPY.end.points(a.points)}</span>
      <span aria-hidden className="ml-1 inline-block w-2" />
    </div>
  );
}

// Everyone's calls, per moment; tapping a row shows that player's words and verdict. Collapsed by default.
function Everyone({ s, myCar }: { s: GameSummary; myCar: string | null }) {
  return (
    <details className="group/all mt-5 border-t-2 border-ink">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-base font-bold">
        {COPY.end.seeAll}
        <span aria-hidden className="inline-block transition-transform group-open/all:rotate-90">›</span>
      </summary>
      {s.moments.map((m) => {
        const line = momentLine(s, m, myCar);
        return (
          <section key={m.lap} className="mt-3 flex flex-col">
            <div className="flex flex-col gap-0.5 border-b-2 border-ink pb-1.5">
              <span className="meta">
                {COPY.end.momentHead(m.lap)} · {m.triggers.map(shortTrigger).join(" · ")}
                {line.stakes != null ? ` · ${COPY.end.stakesTag(line.stakes)}` : ""}
              </span>
              <span className="text-base font-black leading-tight">{line.head}</span>
              {line.luck && <span className="text-sm font-bold">{line.luck}</span>}
            </div>
            {m.entries.map((e) => {
              const sp = splitOf(m, e);
              return (
                <details key={`${e.kind}:${e.name}:${e.driver_code}`} className={`group border-b border-soft-2 ${e.kind === "player" ? "" : "text-ink-2"}`}>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 py-1.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-baseline gap-2">
                        <b className={`min-w-0 truncate ${e.kind === "player" ? "text-base font-black" : "text-sm font-bold"}`}>{label(e, s)}</b>
                        <span className="whitespace-nowrap text-sm font-bold">
                          <CallWord call={e.call} /> <RightMark right={rightOf(m, e)} />
                        </span>
                      </span>
                      {sp && <span className="nums text-xs leading-tight">{COPY.end.split(sp, false)}</span>}
                    </span>
                    <span className="nums ml-auto shrink-0 text-base font-black">{COPY.end.points(e.points)}</span>
                    {chevron}
                  </summary>
                  <div className="flex flex-col gap-1 pb-2.5 text-sm leading-snug">
                    {e.said.trim() ? <q>{e.said}</q> : <p className="text-ink-2">{COPY.end.noReason}</p>}
                    {e.call && e.verdict && e.said.trim() && <p className="text-ink-2">{e.verdict}</p>}
                    {luckNote(m, e) && <p className="font-bold">{luckNote(m, e)}</p>}
                  </div>
                </details>
              );
            })}
          </section>
        );
      })}
    </details>
  );
}

export function PhoneSummary({ summary: s, me }: { summary: GameSummary; me: string }) {
  const meRow = s.ranking.find((r) => r.kind === "player" && r.name === me) ?? null;
  const ranks = playerRanks(s.ranking);
  const myRank = ranks.get(me);
  const myCar = meRow?.driver_code ?? s.cars[0]?.code ?? null;
  const race = s.mode === "race" || s.moments.length > 1;
  const tally = meRow ? freezeTally(s, meRow) : null;
  const rows: MyRow[] = [
    ...s.moments.flatMap((m) => {
      const e = m.entries.find((x) => x.kind === "player" && x.name === me);
      return e ? [{ kind: "moment" as const, lap: m.lap, m, e }] : [];
    }),
    ...s.audibles.filter((a) => a.name === me).map((a) => ({ kind: "audible" as const, lap: a.lap, a })),
  ].sort((x, y) => x.lap - y.lap);

  return (
    <>
      <div className="bg-field text-on-field">
        <div className="flex h-[52px] items-center justify-between gap-3 px-5">
          <span className="meta flex min-w-0 items-center gap-2.5 text-[13px]">
            <Brand kind="mark" height={13} />
            <span className="truncate">{COPY.end.status(s.race)}</span>
          </span>
          <span className="max-w-[40%] truncate text-[13px] font-bold">{me}</span>
        </div>
        <div className="rise px-5 pb-5 pt-1">
          <div className="meta mb-1.5">{COPY.end.yourResult}</div>
          <p className="display nums whitespace-nowrap text-[3.25rem] leading-[0.9] tracking-[-0.04em]">
            {meRow && myRank ? COPY.end.placeTotal(`${myRank.tied ? "=" : ""}${ordinal(myRank.rank)}`, meRow.points) : COPY.end.noCall}
          </p>
          {myRank && (
            <p className="nums mt-2.5 text-base font-bold">
              {COPY.end.rankLine(rankText(myRank), myRank.of)}
              {race && tally ? ` · ${COPY.end.callsRight(tally.right, tally.calls)}` : ""}
            </p>
          )}
          <p className="mt-1 text-lg font-bold">{phoneWinnerLine(s, me)}</p>
        </div>
      </div>

      <div className="flex flex-col px-5 pb-6">
        <section className="mt-4 flex flex-col">
          <span className="meta border-b-2 border-ink pb-1.5">{COPY.end.ranking}</span>
          {boardRows(s).map((r) => {
            const mine = r.kind === "player" && r.name === me;
            const bench = r.kind !== "player";
            const rk = ranks.get(r.name);
            const sums = rowSums(s, r);
            return (
              <div
                key={`${r.kind}:${r.name}:${r.driver_code}`}
                className={`grid min-h-11 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3 border-b py-1 ${mine ? "-mx-1 border-ink bg-ink px-1 text-white" : bench ? "border-soft-2 text-ink-2" : "border-soft-2"}`}
              >
                <span className="nums text-sm font-bold">{!bench && rk ? rankText(rk) : ""}</span>
                <span className="flex min-w-0 flex-col">
                  <span className={`truncate ${bench ? "text-sm font-bold" : "text-base font-black"}`}>{label(r, s)}</span>
                  <span className="nums truncate text-xs">{COPY.end.sums(sums.call, sums.reasoning, sums.total)}</span>
                </span>
                <span className="nums text-base font-black">{COPY.end.points(r.points)}</span>
              </div>
            );
          })}
          <p className="mt-2 text-sm text-ink-2">{COPY.end.engineNote}</p>
        </section>

        <section className="mt-5 flex flex-col">
          <span className="meta border-b-2 border-ink pb-1.5">{COPY.end.yourCalls}</span>
          {rows.length ? (
            rows.map((r) => (r.kind === "moment" ? <MyMomentRow key={`m${r.lap}`} m={r.m} e={r.e} /> : <MyAudibleRow key={`a${r.lap}`} a={r.a} />))
          ) : (
            <p className="py-3 text-base font-bold">{COPY.freeze.noCall}</p>
          )}
        </section>

        <Everyone s={s} myCar={myCar} />

        <details className="group mt-2">
          <summary className="cursor-pointer list-none py-2 text-sm font-bold text-ink-2">
            {COPY.end.howTitle} {chevron}
          </summary>
          <p className="pb-2 text-sm text-ink-2">{howText}</p>
        </details>

        <Link href="/leaderboard" className="on-dark mt-4 flex h-14 items-center justify-center bg-ink text-lg font-bold text-white hover:bg-[#262626]">
          {COPY.end.leaderboard}
        </Link>
      </div>
    </>
  );
}
