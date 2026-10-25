"use client";
// Race Night phone end: a stripped-down summary (place, points, calls right, short standings with ties and your
// row) and a Your calls screen (per-call detail with Muse verdicts, the engine / real-team benchmark line, the
// Muse credit) with Everyone's calls behind it. Same data as components/EndScreen.tsx PhoneSummary.
import "./phone-end.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { COPY } from "@/lib/copy";
import type { GameSummary, MomentEntry, SummaryMoment } from "@/lib/client/api";
import { RNRoot, Label, Logo, SkewButton } from "@/components/rn/kit";
import { PHONE_END_COPY as T } from "./copy";
import { audibleSplit, benchmarks, freezeTally, luckNote, myCalls, rightOf, shortStandings, splitOf, standingGroups, type StandingGroup } from "./helpers";
import { playerRanks } from "@/lib/client/score";

type View = "summary" | "calls" | "everyone";

const pts = COPY.end.points;
const callWord = (c: "BOX" | "STAY" | null) => (c ? COPY.freeze.options[c] : T.noCall);

export function RNPhoneSummary({ summary: s, me, initialView = "summary" }: { summary: GameSummary; me: string; initialView?: View }) {
  const [view, setView] = useState<View>(initialView);
  const meRow = s.ranking.find((r) => r.kind === "player" && r.name === me) ?? null;
  const myCar = meRow?.driver_code ?? s.cars[0]?.code ?? null;
  const team = s.cars.find((c) => c.code === myCar)?.team_colour ?? null;
  const go = (v: View) => {
    setView(v);
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  };
  return (
    <RNRoot team={team} className="rnpe">
      {view === "summary" && <Summary s={s} me={me} onCalls={() => go("calls")} />}
      {view === "calls" && <Calls s={s} me={me} car={myCar} onBack={() => go("summary")} onEveryone={() => go("everyone")} />}
      {view === "everyone" && <Everyone s={s} car={myCar} onBack={() => go("calls")} />}
    </RNRoot>
  );
}

// ---- Summary ----

function Summary({ s, me, onCalls }: { s: GameSummary; me: string; onCalls: () => void }) {
  const router = useRouter();
  const meRow = s.ranking.find((r) => r.kind === "player" && r.name === me) ?? null;
  const myRank = playerRanks(s.ranking).get(me);
  const tally = freezeTally(s, me);
  const groups = standingGroups(s, me);
  const short = shortStandings(groups);
  const place = meRow && myRank ? COPY.end.place(myRank.rank, myRank.tied) : null;
  return (
    <div className="rnpe-page">
      <div className="rnpe-checker" aria-hidden />
      <header className="rnpe-hero">
        <div className="rnpe-hero-slab" aria-hidden />
        <div className="rnpe-hero-in">
          <div className="rnpe-hero-top">
            <Label tone="ink">{T.flag(s.race)}</Label>
            <Logo size="phone" style={{ color: "var(--on-team)" }} />
          </div>
          <p className="rn-display rnpe-place" aria-label={place ? COPY.end.rankLine(place, myRank!.of) : T.noCall}>
            {place ?? T.noCall}
          </p>
          {meRow && (
            <p className="rn-d rnpe-points">
              {pts(meRow.points)}
              <span className="rnpe-unit">{T.pts}</span>
            </p>
          )}
          <p className="rnpe-tally">{tally.calls ? COPY.end.callsRight(tally.right, tally.calls) : COPY.freeze.noCall}</p>
        </div>
      </header>

      <section className="rnpe-standings" aria-label={T.standings}>
        <Label as="h2" className="rnpe-h">
          {T.standings}
        </Label>
        <ol className="rnpe-list">
          {short.head.map((g) => (
            <StandingRow key={g.rank} g={g} me={me} />
          ))}
          {short.gap && (
            <li className="rnpe-gap" role="presentation" aria-hidden>
              <span />
              <span />
              <span />
            </li>
          )}
          {short.mine && <StandingRow g={short.mine} me={me} />}
        </ol>
      </section>

      <div className="rnpe-actions">
        <SkewButton variant="secondary" size="phone" full onClick={onCalls}>
          {T.yourCalls}
        </SkewButton>
        <SkewButton variant="primary" size="phone" full onClick={() => router.push("/")}>
          {COPY.end.home}
        </SkewButton>
      </div>
    </div>
  );
}

function StandingRow({ g, me }: { g: StandingGroup; me: string }) {
  const names = g.mine ? [T.youName(me), ...g.names.filter((n) => n !== me)] : g.names;
  return (
    <li className="rnpe-row" data-mine={g.mine || undefined}>
      <span className="rn-d rnpe-rank">{`${g.tied ? "=" : ""}${g.rank}`}</span>
      <span className="rnpe-name">{names.join(", ")}</span>
      <span className="rn-d rnpe-pts">{pts(g.points)}</span>
    </li>
  );
}

// ---- Your calls ----

function Head({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <header className="rnpe-head">
      <button type="button" className="rnpe-back" aria-label={T.back} onClick={onBack}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <h1 className="rn-display rnpe-title">{title}</h1>
      {right}
    </header>
  );
}

function Chip({ right }: { right: boolean }) {
  return (
    <span className="rnpe-chip" data-right={right}>
      <span>
        {right ? "✓" : "✕"} {right ? T.right : T.wrong}
      </span>
    </span>
  );
}

function Calls({ s, me, car, onBack, onEveryone }: { s: GameSummary; me: string; car: string | null; onBack: () => void; onEveryone: () => void }) {
  const meRow = s.ranking.find((r) => r.kind === "player" && r.name === me) ?? null;
  const tally = freezeTally(s, me);
  const rows = myCalls(s, me);
  const bench = benchmarks(s, car);
  const total = meRow?.points ?? 0;
  return (
    <div className="rnpe-page rnpe-calls">
      <Head
        title={T.yourCalls}
        onBack={onBack}
        right={
          <div className="rnpe-total">
            <div className="rnpe-total-slab" aria-hidden />
            <span className="rn-d rnpe-total-n">
              {pts(total)}
              <span className="rnpe-unit">{T.pts}</span>
            </span>
          </div>
        }
      />
      <Label className="rnpe-meta">{T.meta(s.race, car, tally.right, tally.calls)}</Label>
      <ul className="rnpe-cards">
        {rows.length === 0 && <li className="rnpe-card rnpe-empty">{COPY.freeze.noCall}</li>}
        {rows.map((r) =>
          r.kind === "moment" ? (
            <CallCard key={`m${r.lap}`} lap={r.lap} call={r.e.call} right={rightOf(r.m, r.e)} points={r.e.points} e={r.e} m={r.m} />
          ) : (
            <li key={`a${r.lap}`} className="rnpe-card">
              <span className="rn-d rnpe-lap">{T.lap(r.lap)}</span>
              <div className="rnpe-card-main">
                <div className="rnpe-card-top">
                  <span className="rn-display rnpe-call">{T.audible}</span>
                  {r.a.status === "scored" && r.a.right != null && <Chip right={r.a.right} />}
                  <span className="rn-d rnpe-card-pts">{pts(r.a.points)}</span>
                </div>
                {(() => {
                  const sp = audibleSplit(r.a);
                  return sp ? (
                    <>
                      <p className="rnpe-why">
                        <b>{COPY.end.reasoning(sp.r)}</b>
                        {r.a.verdict ? ` · ${r.a.verdict}` : ""}
                      </p>
                      <p className="rnpe-split">{COPY.end.split(sp)}</p>
                    </>
                  ) : (
                    <p className="rnpe-why">{COPY.race.audibleStatus[r.a.status] ?? COPY.end.unscored}</p>
                  );
                })()}
              </div>
            </li>
          ),
        )}
      </ul>

      <div className="rnpe-foot">
        {(bench.engine || bench.team) && meRow && (
          <p className="rnpe-bench">
            {bench.engine ? T.engineBeat(total - bench.engine.points) : ""}
            {bench.engine && bench.team ? " · " : ""}
            {bench.team && (
              <>
                {T.teamWall(bench.team.name)} <b>{pts(bench.team.points)}</b>
              </>
            )}
          </p>
        )}
        <p className="rnpe-credit">{T.credit}</p>
        <SkewButton variant="secondary" size="phone" full onClick={onEveryone}>
          {T.everyone}
        </SkewButton>
      </div>
    </div>
  );
}

function CallCard({ lap, call, right, points, e, m }: { lap: number; call: "BOX" | "STAY" | null; right: boolean | null; points: number; e: MomentEntry; m: SummaryMoment }) {
  const sp = splitOf(m, e);
  const said = e.said.trim();
  const luck = luckNote(m, e);
  return (
    <li className="rnpe-card">
      <span className="rn-d rnpe-lap">{T.lap(lap)}</span>
      <div className="rnpe-card-main">
        <div className="rnpe-card-top">
          <span className="rn-display rnpe-call">{callWord(call)}</span>
          {right != null && <Chip right={right} />}
          <span className="rn-d rnpe-card-pts">{pts(points)}</span>
        </div>
        {call && (
          <p className="rnpe-why">
            <b>{COPY.end.reasoning(e.reasoning)}</b>
            {" · "}
            {said ? (e.verdict ?? <q>{said}</q>) : COPY.end.noReason}
          </p>
        )}
        {luck && <p className="rnpe-luck">{luck}</p>}
        {sp && <p className="rnpe-split">{COPY.end.split(sp)}</p>}
      </div>
    </li>
  );
}

// ---- Everyone's calls ----

function label(e: { kind: string; name: string; driver_code: string | null }, s: GameSummary): string {
  if (e.kind === "player") return e.name;
  const base = e.kind === "engine" ? COPY.end.engine : COPY.end.teamRow(e.name);
  return s.cars.length > 1 && e.driver_code ? COPY.end.carTag(base, e.driver_code) : base;
}

function Everyone({ s, car, onBack }: { s: GameSummary; car: string | null; onBack: () => void }) {
  return (
    <div className="rnpe-page rnpe-calls">
      <Head title={T.everyone} onBack={onBack} />
      {s.moments.map((m) => {
        const main = m.cars.find((c) => c.code === car) ?? m.cars[0];
        return (
          <section key={m.lap} className="rnpe-moment">
            <Label className="rnpe-meta">
              {[COPY.end.momentHead(m.lap), ...m.triggers.map((t) => COPY.end.triggerShort[t] ?? t), main ? COPY.end.stakesTag(main.stakes) : null]
                .filter(Boolean)
                .join(" · ")}
            </Label>
            {main && <p className="rnpe-moment-head">{COPY.end.wasRight(main.final_right_call ?? main.correct, main.swing_s)}</p>}
            {main?.luck && main.explanation && <p className="rnpe-luck">{main.explanation}</p>}
            <ul className="rnpe-ev">
              {m.entries.map((e) => {
                const r = rightOf(m, e);
                const said = e.said.trim();
                return (
                  <li key={`${e.kind}:${e.name}:${e.driver_code}`} className="rnpe-ev-row" data-bench={e.kind !== "player" || undefined}>
                    <div className="rnpe-ev-top">
                      <span className="rnpe-ev-name">{label(e, s)}</span>
                      <span className="rnpe-ev-call">{callWord(e.call)}</span>
                      {r != null && <Chip right={r} />}
                      <span className="rn-d rnpe-ev-pts">{pts(e.points)}</span>
                    </div>
                    {e.kind === "player" && (
                      <p className="rnpe-why">
                        {said ? <q>{said}</q> : COPY.end.noReason}
                        {e.call && e.verdict && said ? <span className="rnpe-verdict"> {e.verdict}</span> : null}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
