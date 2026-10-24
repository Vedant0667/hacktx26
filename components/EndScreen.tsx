"use client";
// Round 7: the end-of-game summary, one component for moment and race lobbies (a moment game is a game with
// one moment). Host: a team-colour band with the winner, one ranked list (totals, shared ranks), and for races
// a freeze-by-freeze breakdown beside it. Phone: your total and rank first, your calls, every moment, then the
// ranking. Everything comes from GET /reveal?part=results (lib/client/results.ts).
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { COPY } from "@/lib/copy";
import type { GameSummary, MomentCar, MomentEntry, RankRow, SummaryAudible, SummaryMoment } from "@/lib/client/api";
import { tla } from "@/lib/client/race";
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

// ✓ / ✗ in ink with a text alternative.
export function RightMark({ right, className = "" }: { right: boolean | null; className?: string }) {
  if (right === null) return null;
  return (
    <span role="img" aria-label={right ? COPY.end.right : COPY.end.wrong} className={className}>
      {right ? "✓" : "✗"}
    </span>
  );
}

function label(e: { kind: string; name: string; driver_code: string | null }, s: GameSummary, short = false): string {
  if (e.kind === "player") return short ? tla(e.name) : e.name;
  const base = e.kind === "engine" ? COPY.end.engine : COPY.end.teamRow(e.name);
  return s.cars.length > 1 && e.driver_code ? COPY.end.carTag(base, e.driver_code) : base;
}

function winnerLine(s: GameSummary): string {
  if (!s.winners || !s.winners.names.length) return COPY.end.noWinner;
  const names = s.winners.names.map(tla);
  return names.length > 1 ? COPY.end.tie(names, s.winners.points) : COPY.end.wins(names[0], s.winners.points);
}

// "Box was right: +15.6 s." for the main car of a moment, then the team's call and the stakes.
function momentLine(s: GameSummary, m: SummaryMoment, carCode: string | null): { head: string; sub: string; luck: string | null } {
  const main = m.cars.find((c) => c.code === carCode) ?? m.cars[0];
  if (!main) return { head: COPY.end.momentHead(m.lap), sub: "", luck: null };
  const right = main.final_right_call ?? main.correct;
  const others = m.cars.filter((c) => c !== main).map((c) => COPY.end.carRight(c.code, c.final_right_call ?? c.correct, c.swing_s));
  return {
    head: COPY.end.wasRight(right, main.swing_s),
    sub: [COPY.end.teamDid(main.team, main.team_call), `${COPY.end.stakes(main.stakes)}.`, ...others.map((o) => `${o}.`)].join(" "),
    luck: main.luck && main.explanation ? main.explanation : null,
  };
}

function luckNote(m: SummaryMoment, e: MomentEntry): string | null {
  const car = carFor(m, e);
  if (!car?.luck || !car.explanation || !e.call) return null;
  return rightOf(m, e) ? `${COPY.end.unlucky} ${car.explanation}` : `${COPY.end.lucky} ${car.explanation}`;
}

const triggerText = (t: string) => COPY.race.triggers[t] ?? t;

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
  const rows = s.ranking;
  const size = rows.length <= 5 ? "lg" : rows.length <= 8 ? "md" : "sm";
  return (
    <main className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header className="bg-field px-14 pb-7 pt-8 text-on-field">
        <div className="flex items-center justify-between gap-6 font-mono text-lg font-bold uppercase">
          <span>{COPY.end.status(s.race)}</span>
          <span>{COPY.host.room(code)}</span>
        </div>
        <h1 className="display mt-4 text-[4.5rem] leading-[0.95]">{winnerLine(s)}</h1>
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

      <section className={`grid min-h-0 grid-cols-12 gap-x-10 px-14 pt-6 ${single ? "" : ""}`}>
        <div className={`flex min-h-0 flex-col ${single ? "col-span-12" : "col-span-7"}`}>
          {rows.map((r) => (
            <HostRow key={`${r.kind}:${r.name}:${r.driver_code}`} r={r} s={s} size={single ? size : "sm"} single={single} />
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

      <footer className="flex items-end justify-between gap-6 px-14 pb-8 pt-4">
        <div className="flex max-w-[90ch] flex-col gap-1">
          <p className="text-lg font-bold">{COPY.end.how}</p>
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
  lg: { h: "min-h-[84px]", rank: "text-[2.5rem]", name: "text-[2.5rem]", call: "text-[2rem]", quote: "text-xl", sub: "text-base", pts: "text-[3rem]" },
  md: { h: "min-h-[60px]", rank: "text-[2rem]", name: "text-[2rem]", call: "text-[1.625rem]", quote: "text-lg", sub: "text-sm", pts: "text-[2.5rem]" },
  sm: { h: "min-h-[44px]", rank: "text-2xl", name: "text-2xl", call: "text-xl", quote: "text-base", sub: "text-xs", pts: "text-[1.75rem]" },
};

function HostRow({ r, s, size, single }: { r: RankRow; s: GameSummary; size: keyof typeof HOST_SIZES; single: boolean }) {
  const z = HOST_SIZES[size];
  const bench = r.kind !== "player";
  const m = s.moments[0];
  const e = single && m ? m.entries.find((x) => x.kind === r.kind && x.name === r.name && x.driver_code === r.driver_code) : undefined;
  const cols = single ? "76px minmax(0,230px) 180px minmax(0,1fr) 130px" : "64px minmax(0,1fr) minmax(0,1.3fr) 110px";
  const sub = e?.call ? (luckNote(m!, e) ?? e.verdict) : null;
  return (
    <div
      className={`grid ${z.h} items-center gap-x-6 border-b ${bench ? "border-line text-ink-2" : "border-line"}`}
      style={{ gridTemplateColumns: cols }}
    >
      <span className={`nums font-bold ${z.rank}`}>{r.rank_label}</span>
      <span className="flex min-w-0 items-baseline gap-3">
        <span className={bench ? `line-clamp-2 font-bold leading-tight ${size === "sm" ? "text-base" : "text-xl"}` : `display truncate leading-none ${z.name}`}>{label(r, s)}</span>
        {r.kind === "player" && s.cars.length > 1 && <CarChip summary={s} code={r.driver_code} />}
      </span>
      {single ? (
        <>
          <span className={`flex items-baseline gap-2 whitespace-nowrap font-black tracking-tight ${bench ? "text-xl" : z.call}`}>
            <CallWord call={e?.call ?? null} />
            {!bench && m && e && <RightMark right={rightOf(m, e)} />}
          </span>
          <span className="flex min-w-0 flex-col">
            {e?.said.trim() ? <q className={`line-clamp-1 font-medium ${bench ? "text-base" : z.quote}`}>{e.said}</q> : <span className={`${z.quote} text-ink-2`}>{e?.call ? COPY.end.noReason : ""}</span>}
            {e?.call && e.said.trim() && (
              <span className={`line-clamp-1 ${z.sub} ${bench ? "" : "text-ink-2"}`}>
                <b className="nums font-bold text-ink">{COPY.end.reasoning(e.reasoning)}</b>
                {sub ? ` · ${sub}` : ""}
              </span>
            )}
          </span>
        </>
      ) : (
        <span className="flex min-w-0 flex-col">
          <span className="text-lg font-bold">{COPY.end.callsRight(r.right, r.calls)}</span>
          <span className="flex flex-wrap gap-x-3 font-mono text-sm font-bold">
            {s.moments.map((mm) => {
              const x = mm.entries.find((y) => y.kind === r.kind && y.name === r.name && y.driver_code === r.driver_code);
              if (!x) return null;
              return (
                <span key={mm.lap}>
                  L{mm.lap} {x.call ? (rightOf(mm, x) ? "✓" : "✗") : "–"}
                </span>
              );
            })}
          </span>
        </span>
      )}
      <span className={`nums text-right font-black tracking-[-0.03em] ${bench ? "text-[1.75rem]" : z.pts}`}>{COPY.end.points(r.points)}</span>
    </div>
  );
}

function HostMoment({ m, s, carCode }: { m: SummaryMoment; s: GameSummary; carCode: string | null }) {
  const line = momentLine(s, m, carCode);
  return (
    <div className="flex flex-col gap-1 border-b border-line pb-2.5">
      <span className="flex items-baseline gap-3">
        <b className="font-mono text-sm font-bold">L{m.lap}</b>
        <span className="truncate font-mono text-xs font-bold uppercase text-ink-2">{m.triggers.map(triggerText).join(" · ")}</span>
      </span>
      <span className="text-base font-black leading-tight">{line.head}</span>
      {line.luck && <span className="line-clamp-1 text-sm">{line.luck}</span>}
      <span className="flex flex-wrap gap-x-3 gap-y-0.5">
        {m.entries.map((e) => (
          <span key={`${e.kind}:${e.name}:${e.driver_code}`} className={`text-sm ${e.kind === "player" ? "font-bold" : "text-ink-2"}`}>
            {e.kind === "player" ? tla(e.name) : e.kind === "engine" ? COPY.end.engine : e.name} {e.call ? (rightOf(m, e) ? "✓" : "✗") : "–"}{" "}
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
        <span key={`${a.name}:${a.lap}`} className="flex gap-3 text-sm">
          <b className="font-bold">{tla(a.name)}</b>
          <span>{COPY.end.audibleRow(a.lap)}</span>
          <span>{audibleMark(a)}</span>
          <span className="ml-auto font-bold">{a.status === "scored" ? COPY.end.points(a.points) : (COPY.race.audibleStatus[a.status] ?? "")}</span>
        </span>
      ))}
    </div>
  );
}

// ---- Phone ----

function Why({ e, note }: { e: { said: string; verdict: string | null; reasoning: number; call: unknown }; note?: string | null }) {
  if (!e.call) return null;
  return (
    <details className="group mt-1">
      <summary className="cursor-pointer list-none text-sm font-bold underline underline-offset-4">{COPY.end.showWhy}</summary>
      <div className="mt-2 flex flex-col gap-1.5">
        {e.said.trim() ? <q className="text-base leading-snug">{e.said}</q> : <p className="text-sm text-ink-2">{COPY.end.noReason}</p>}
        {e.said.trim() && (
          <p className="text-sm leading-snug text-ink-2">
            <b className="nums text-ink">{COPY.end.reasoning(e.reasoning)}</b>
            {e.verdict ? ` · ${e.verdict}` : ""}
          </p>
        )}
        {note && <p className="text-sm font-bold leading-snug">{note}</p>}
      </div>
    </details>
  );
}

export function PhoneSummary({ summary: s, me }: { summary: GameSummary; me: string }) {
  const single = s.moments.length === 1 && s.audibles.length === 0;
  const meRow = s.ranking.find((r) => r.kind === "player" && r.name === me) ?? null;
  const m0 = s.moments[0];
  const mine0 = single && m0 ? (m0.entries.find((e) => e.kind === "player" && e.name === me) ?? null) : null;
  const myCar = meRow?.driver_code ?? s.cars[0]?.code ?? null;
  const engine = s.ranking.find((r) => r.kind === "engine" && r.driver_code === myCar);
  const beatEngine = !!meRow && meRow.calls > 0 && !!engine && meRow.points > engine.points;
  const myMoments = s.moments.map((m) => ({ m, e: m.entries.find((e) => e.kind === "player" && e.name === me) })).filter((x): x is { m: SummaryMoment; e: MomentEntry } => !!x.e);
  const myAudibles = s.audibles.filter((a) => a.name === me);
  const n = s.ranking.length;

  let big: ReactNode;
  let small: string;
  if (single) {
    big = (
      <span className="display text-[5.5rem] leading-[0.85] tracking-[-0.05em]">
        <CallWord call={mine0?.call ?? null} /> {m0 && mine0 && <RightMark right={rightOf(m0, mine0)} className="text-[0.6em]" />}
      </span>
    );
    small = [meRow && COPY.end.rankLine(meRow.rank_label, n), mine0 && COPY.end.stakes(mine0.stakes)].filter(Boolean).join(" · ");
  } else {
    big = <span className="display nums text-[5.5rem] leading-[0.85] tracking-[-0.05em]">{COPY.end.points(meRow?.points ?? 0)}</span>;
    small = [meRow && COPY.end.rankLine(meRow.rank_label, n), meRow && COPY.end.callsRight(meRow.right, meRow.calls)].filter(Boolean).join(" · ");
  }

  return (
    <>
      <div className="bg-field text-on-field">
        <div className="flex h-[52px] items-center justify-between gap-3 px-5">
          <span className="meta flex items-center gap-2.5 text-[13px]">
            <Brand kind="mark" height={13} />
            {COPY.end.status(s.race)}
          </span>
          <span className="meta text-[13px]">{tla(me)}</span>
        </div>
        <div className="rise px-5 pb-6 pt-1.5">
          <div className="meta mb-2">{single ? COPY.end.yourCall : COPY.end.yourTotal}</div>
          <div className="flex items-baseline justify-between gap-4">
            {big}
            {single && meRow && <span className="nums text-[2.5rem] font-black leading-none">{COPY.end.points(meRow.points)}</span>}
          </div>
          {small && <p className="mt-3 text-base font-bold">{small}</p>}
        </div>
      </div>

      <div className="flex flex-col px-5 pb-6">
        {single ? (
          mine0?.call ? (
            <div className="flex flex-col gap-1.5 border-b border-soft-2 py-4">
              <span className="flex items-baseline justify-between gap-4">
                <span className="meta">{COPY.end.reasoningLabel}</span>
                <span className="nums text-[1.75rem] font-bold">{COPY.end.reasoning(mine0.reasoning)}</span>
              </span>
              {mine0.verdict && <p className="text-lg leading-snug">{mine0.verdict}</p>}
              {m0 && luckNote(m0, mine0) && <p className="text-base font-bold leading-snug">{luckNote(m0, mine0)}</p>}
            </div>
          ) : (
            <p className="border-b border-soft-2 py-4 text-xl font-black">{COPY.freeze.noCall}</p>
          )
        ) : (
          <section className="flex flex-col pt-4">
            <span className="meta border-b-2 border-ink pb-2">{COPY.end.yourCalls}</span>
            {myMoments.map(({ m, e }) => (
              <div key={m.lap} className="flex flex-col gap-1 border-b border-soft-2 py-3">
                <div className="flex items-baseline gap-3">
                  <b className="font-mono text-sm font-bold">L{m.lap}</b>
                  <span className="text-lg font-black">
                    <CallWord call={e.call} /> <RightMark right={rightOf(m, e)} />
                  </span>
                  <span className="nums ml-auto text-xl font-black">{COPY.end.points(e.points)}</span>
                </div>
                {e.call && (
                  <p className="text-sm leading-snug">
                    <b className="nums">{COPY.end.reasoning(e.reasoning)}</b>
                    {e.verdict ? ` · ${e.verdict}` : ""}
                  </p>
                )}
                {luckNote(m, e) && <p className="text-sm font-bold">{luckNote(m, e)}</p>}
              </div>
            ))}
            {myAudibles.map((a) => (
              <div key={a.lap} className="flex items-baseline gap-3 border-b border-soft-2 py-3">
                <span className="text-base font-bold">{COPY.end.audibleRow(a.lap)}</span>
                <span>{audibleMark(a)}</span>
                {a.status === "scored" ? <span className="nums ml-auto text-xl font-black">{COPY.end.points(a.points)}</span> : <span className="ml-auto text-right text-sm font-bold">{COPY.race.audibleStatus[a.status] ?? ""}</span>}
              </div>
            ))}
          </section>
        )}
        {beatEngine && <p className="pt-3 text-base font-bold">{COPY.end.beatEngine}</p>}

        <p className="display mt-6 border-t-2 border-ink pt-4 text-[1.75rem] leading-tight">{winnerLine(s)}</p>

        {s.moments.map((m) => {
          const line = momentLine(s, m, myCar);
          return (
            <section key={m.lap} className="mt-5 flex flex-col">
              <div className="flex flex-col gap-0.5 border-b-2 border-ink pb-2">
                <span className="meta">
                  {COPY.end.momentHead(m.lap)} · {m.triggers.map(triggerText).join(" · ")}
                </span>
                <span className="text-lg font-black leading-tight">{line.head}</span>
                <span className="text-sm">{line.sub}</span>
                {line.luck && <span className="text-sm font-bold">{line.luck}</span>}
              </div>
              <ol className="flex flex-col">
                {m.entries.map((e) => (
                  <li key={`${e.kind}:${e.name}:${e.driver_code}`} className={`flex flex-col border-b border-soft-2 py-2.5 ${e.kind === "player" ? "" : "text-ink-2"}`}>
                    <div className="flex items-baseline gap-3">
                      <b className={`min-w-0 truncate ${e.kind === "player" ? "text-lg font-black" : "text-base font-bold"}`}>{label(e, s)}</b>
                      {e.kind === "player" && s.cars.length > 1 && <CarChip summary={s} code={e.driver_code} className="text-xs" />}
                      <span className="whitespace-nowrap text-base font-bold">
                        <CallWord call={e.call} /> {e.kind === "player" && <RightMark right={rightOf(m, e)} />}
                      </span>
                      {e.call && <span className="nums text-sm">{COPY.end.reasoning(e.reasoning)}</span>}
                      <span className="nums ml-auto text-lg font-black">{COPY.end.points(e.points)}</span>
                    </div>
                    <Why e={e} note={luckNote(m, e)} />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}

        {s.audibles.length > 0 && (
          <section className="mt-5 flex flex-col">
            <span className="meta border-b-2 border-ink pb-2">{COPY.end.audibles}</span>
            {s.audibles.map((a) => (
              <div key={`${a.name}:${a.lap}`} className="flex items-baseline gap-3 border-b border-soft-2 py-2.5">
                <b className="text-base font-black">{tla(a.name)}</b>
                <span className="text-sm">{COPY.end.audibleRow(a.lap)}</span>
                <span>{audibleMark(a)}</span>
                {a.status === "scored" ? <span className="nums ml-auto text-lg font-black">{COPY.end.points(a.points)}</span> : <span className="ml-auto text-right text-sm font-bold">{COPY.race.audibleStatus[a.status] ?? ""}</span>}
              </div>
            ))}
          </section>
        )}

        <section className="mt-6 flex flex-col">
          <span className="meta border-b-2 border-ink pb-2">{COPY.end.ranking}</span>
          {s.ranking.map((r) => {
            const mine = r.kind === "player" && r.name === me;
            const bench = r.kind !== "player";
            return (
              <div
                key={`${r.kind}:${r.name}:${r.driver_code}`}
                className={`grid min-h-11 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 border-b ${mine ? "border-ink bg-ink px-1 text-white" : bench ? "border-soft-2 text-ink-2" : "border-soft-2"}`}
              >
                <span className="nums text-base font-bold">{r.rank_label}</span>
                <span className={`truncate ${bench ? "text-base font-bold" : "text-lg font-black"}`}>{label(r, s)}</span>
                <span className="nums text-xl font-black">{COPY.end.points(r.points)}</span>
              </div>
            );
          })}
        </section>
        <p className="mt-5 text-sm text-ink-2">{COPY.end.how}</p>
        <Link href="/leaderboard" className="on-dark mt-6 flex h-14 items-center justify-center bg-ink text-lg font-bold text-white hover:bg-[#262626]">
          {COPY.end.leaderboard}
        </Link>
      </div>
    </>
  );
}
