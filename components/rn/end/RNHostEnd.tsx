"use client";
// Race Night host end (mockups H07Scoring, H08Reveal, H09Podium). Presentation only: the same props as the
// legacy Scoring / HostSummary in components/EndScreen.tsx. The host steps through one reveal per moment
// (Next, → or space; ← goes back), then the podium; "Skip to standings" jumps there.
import "./end.css";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { COPY } from "@/lib/copy";
import type { GameSummary, MomentCar, MomentEntry, RankRow, SummaryAudible, SummaryMoment } from "@/lib/client/api";
import { playerRanks, rankText, splitPoints, type PlayerRank, type Split } from "@/lib/client/score";
import { Logo, RNRoot, SkewButton } from "@/components/rn/kit";
import { TrackMap, type TrackMapProps } from "@/components/rn/TrackMap";
import { END_COPY as C } from "./copy";

// ---- Helpers (same rules as components/EndScreen.tsx, which does not export them) ----

const colourOf = (s: GameSummary, code: string | null) => s.cars.find((c) => c.code === code)?.team_colour ?? null;
function carFor(m: SummaryMoment, e: { driver_code: string | null }): MomentCar | undefined {
  return m.cars.find((c) => c.code === e.driver_code) ?? m.cars[0];
}
function rightOf(m: SummaryMoment, e: MomentEntry): boolean | null {
  if (!e.call) return null;
  const car = carFor(m, e);
  return car?.final_right_call ? e.call === car.final_right_call : e.right;
}
function splitOf(m: SummaryMoment, e: MomentEntry): Split | null {
  if (!e.call) return null;
  return splitPoints(e.stakes, !!rightOf(m, e), e.reasoning, e.points);
}
function luckNote(m: SummaryMoment, e: MomentEntry): string | null {
  const car = carFor(m, e);
  if (!car?.luck || !car.explanation || !e.call) return null;
  return rightOf(m, e) ? `${COPY.end.unlucky} ${car.explanation}` : `${COPY.end.lucky} ${car.explanation}`;
}
function label(e: { kind: string; name: string; driver_code: string | null }, s: GameSummary): string {
  if (e.kind === "player") return e.name;
  const base = e.kind === "engine" ? COPY.end.engine : COPY.end.teamRow(e.name);
  return s.cars.length > 1 && e.driver_code ? COPY.end.carTag(base, e.driver_code) : base;
}
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
const triggerText = (t: string) => COPY.race.triggers[t] ?? t;
const callText = (c: "BOX" | "STAY" | "MIXED" | null) => (c === "MIXED" ? COPY.reveal.mixed : c ? COPY.freeze.options[c] : COPY.reveal.noCall);
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// Entries for one reveal: players by points, benchmark rows (at most one Engine, one real team) placed by score.
function revealRows(s: GameSummary, m: SummaryMoment, carCode: string | null): MomentEntry[] {
  const players = m.entries.filter((e) => e.kind === "player");
  const pick = (k: MomentEntry["kind"]) => {
    const all = m.entries.filter((e) => e.kind === k);
    return all.find((e) => e.driver_code === carCode) ?? all.sort((a, b) => b.points - a.points)[0];
  };
  const bench = s.cars.length > 1 ? m.entries.filter((e) => e.kind !== "player") : ([pick("engine"), pick("team")].filter(Boolean) as MomentEntry[]);
  return [...players, ...bench].sort(
    (a, b) => b.points - a.points || (a.call ? 0 : 1) - (b.call ? 0 : 1) || (a.kind === "player" ? 0 : 1) - (b.kind === "player" ? 0 : 1),
  );
}

// Moment ranks for players (ties share a rank).
function momentRanks(rows: MomentEntry[]): Map<string, { rank: number; tied: boolean }> {
  const players = rows.filter((e) => e.kind === "player");
  const out = new Map<string, { rank: number; tied: boolean }>();
  players.forEach((e) => {
    const rank = players.filter((x) => x.points > e.points).length + 1;
    const tied = players.filter((x) => x.points === e.points).length > 1;
    out.set(e.name, { rank, tied });
  });
  return out;
}

// Optional rejoin map per moment lap: the container may pass one when it has the frames (the summary has none).
export type RejoinMap = Omit<TrackMapProps, "size" | "ariaLabel"> & { caption?: string | null };

// ---- Scoring (pending) ----

export interface RNScoringProps {
  elapsedMs: number;
  failed: boolean;
  big?: boolean;
  // Extras the container may pass (all optional): the race name, the followed car's team colour, the freezes.
  race?: string | null;
  team?: string | null;
  moments?: { lap: number; trigger?: string | null }[];
}

export function RNScoring({ elapsedMs, failed, race, team, moments }: RNScoringProps) {
  const secs = Math.max(0, Math.floor(elapsedMs / 1000));
  return (
    <RNRoot as="main" team={team ?? null} className="rne rne-scoring" aria-live="polite">
      <div className="rne-chequer" aria-hidden />
      <div className="rne-slab-right" aria-hidden>
        <div className="rne-chq-stripe" />
      </div>
      <div className="rne-scoring-l">
        <Logo size="host" />
        <span className="rn-lbl rne-kicker">{[COPY.end.final, race].filter(Boolean).join(" · ")}</span>
        <h1 className="rn-d rne-scoring-h">
          <span className="rne-scoring-top">{C.scoringTop}</span>
          <span className="rne-scoring-big">{C.scoringBig}</span>
        </h1>
        <p className="rne-scoring-sub">{failed ? COPY.end.retry : C.scoringSub}</p>
        {moments && moments.length > 0 ? (
          <ul className="rne-prog">
            {moments.map((m, i) => (
              <li key={m.lap}>
                <b className="rn-d">L{m.lap}</b>
                <span>{m.trigger ? triggerText(m.trigger) : ""}</span>
                <span className="rne-bar" aria-hidden>
                  <i style={{ animationDelay: `${i * 0.35}s` }} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rne-prog-one" aria-hidden>
            <span className="rne-bar">
              <i />
            </span>
          </div>
        )}
        <p className="rne-scoring-foot">
          {C.graded} · <span className="rn-num">{COPY.end.scoringFor(secs)}</span>
        </p>
      </div>
      <div className="rne-scoring-r">
        <span className="rn-d rne-who">
          <span>{C.whoCalled}</span>
        </span>
        {moments && moments[0] && <span className="rne-who-sub">{C.revealStarts(moments[0].lap)}</span>}
      </div>
    </RNRoot>
  );
}

// ---- Host summary: reveals then podium ----

export interface RNHostSummaryProps {
  summary: GameSummary;
  code: string;
  carCode: string | null;
  // Extras (optional): a rejoin map per moment lap, a Play again handler (no legacy equivalent: hidden when absent).
  rejoinMaps?: Record<number, RejoinMap>;
  onPlayAgain?: () => void;
}

export function RNHostSummary({ summary: s, code, carCode, rejoinMaps, onPlayAgain }: RNHostSummaryProps) {
  const n = s.moments.length;
  const aud = s.audibles.length > 0;
  const podiumStep = n + (aud ? 1 : 0); // 0..n-1 reveals, n = audibles (when any), then the podium
  const [step, setStep] = useState(0);
  const next = useCallback(() => setStep((x) => Math.min(podiumStep, x + 1)), [podiumStep]);
  const prev = useCallback(() => setStep((x) => Math.max(0, x - 1)), []);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (ev.key === "ArrowRight" || (ev.key === " " && !(t && t.tagName === "BUTTON"))) {
        ev.preventDefault();
        next();
      } else if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);
  const team = colourOf(s, carCode) ?? s.cars[0]?.team_colour ?? null;
  const skip = step < podiumStep - 1 ? () => setStep(podiumStep) : undefined;
  if (aud && step === n)
    return <RNAudibles summary={s} team={team} onNext={next} onBack={n > 0 ? prev : undefined} />;
  const m = s.moments[step];
  if (step >= podiumStep || !m)
    return <RNPodium summary={s} code={code} team={team} onBack={podiumStep > 0 ? prev : undefined} onPlayAgain={onPlayAgain} />;
  return (
    <RNReveal
      summary={s}
      moment={m}
      index={step}
      carCode={carCode}
      team={colourOf(s, carFor(m, { driver_code: carCode })?.code ?? null) ?? team}
      rejoin={rejoinMaps?.[m.lap]}
      onNext={next}
      onBack={step > 0 ? prev : undefined}
      onSkip={skip}
      nextLabel={step === n - 1 && !aud ? C.standings : step === n - 1 ? COPY.end.audibles : C.next}
    />
  );
}

// ---- Audibles (no mockup: the legacy HostAudibles list, in the reveal layout) ----

const audibleMark = (a: SummaryAudible) => (a.status === "scored" ? (a.right ? "✓" : "✗") : "–");

export function RNAudibles({ summary: s, team, onNext, onBack }: { summary: GameSummary; team: string | null; onNext: () => void; onBack?: () => void }) {
  return (
    <RNRoot as="main" team={team} className="rne rne-reveal" data-dense={s.audibles.length > 9 ? "xs" : "md"}>
      <div className="rne-slab-right rne-slab-reveal" aria-hidden />
      <header className="rne-rv-top">
        <Logo size="host" />
        <span className="rn-lbl">{COPY.end.gameLine(s.moments.length, s.audibles.length)}</span>
      </header>
      <section className="rne-rv-main">
        <h1 className="rne-stamp rn-d">
          <span>{COPY.end.audibles}</span>
        </h1>
        <div className="rne-table" role="table" aria-label={COPY.end.audibles}>
          {s.audibles.map((a) => {
            const sp = a.status === "scored" ? splitPoints(a.stakes, !!a.right, a.reasoning, a.points) : null;
            return (
              <div role="row" key={`${a.name}:${a.lap}`} className="rne-tr rne-player rne-aud">
                <span role="cell" className="rn-d rne-rank">
                  L{a.lap}
                </span>
                <span role="cell" className="rne-who rn-d">
                  <span className="rne-trunc">{a.name}</span>
                </span>
                <span role="cell">
                  <span className="rne-call rn-d rne-call-out">
                    <span>
                      {COPY.end.boxNow} {audibleMark(a)}
                    </span>
                  </span>
                </span>
                <span role="cell" className="rne-how">
                  <span className="rn-num">{sp ? COPY.end.split(sp, false) : (COPY.race.audibleStatus[a.status] ?? COPY.end.unscored)}</span>
                  {sp && a.verdict && <q className="rne-verdict">{a.verdict}</q>}
                </span>
                <span role="cell" className="rn-d rn-num rne-pts">
                  {a.status === "scored" ? COPY.end.points(a.points) : ""}
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <aside className="rne-rv-side">
        <div className="rne-nav">
          <span className="rne-minor">
            {onBack && (
              <button type="button" className="rne-link" onClick={onBack}>
                {C.back}
              </button>
            )}
          </span>
          <SkewButton variant="dark" size="host-sm" onClick={onNext} aria-keyshortcuts="ArrowRight Space">
            {C.standings}
          </SkewButton>
        </div>
      </aside>
    </RNRoot>
  );
}

// ---- Reveal (H08) ----

export function RNReveal({
  summary: s,
  moment: m,
  index,
  carCode,
  team,
  rejoin,
  onNext,
  onBack,
  onSkip,
  nextLabel,
}: {
  nextLabel?: string;
  summary: GameSummary;
  moment: SummaryMoment;
  index: number;
  carCode: string | null;
  team: string | null;
  rejoin?: RejoinMap;
  onNext: () => void;
  onBack?: () => void;
  onSkip?: () => void;
}) {
  const n = s.moments.length;
  const main = m.cars.find((c) => c.code === carCode) ?? m.cars[0];
  const right = main ? (main.final_right_call ?? main.correct) : null;
  const rows = useMemo(() => revealRows(s, m, carCode), [s, m, carCode]);
  const ranks = useMemo(() => momentRanks(rows), [rows]);
  const players = m.entries.filter((e) => e.kind === "player");
  const box = players.filter((e) => e.call === "BOX").length;
  const stay = players.filter((e) => e.call === "STAY").length;
  const none = players.filter((e) => !e.call).length;
  const last = index >= n - 1;
  const dense = rows.length > 9 ? "xs" : rows.length > 7 ? "sm" : "md";
  const others = m.cars.filter((c) => c !== main);
  return (
    <RNRoot as="main" team={team} className="rne rne-reveal" data-dense={dense}>
      <div className="rne-slab-right rne-slab-reveal" aria-hidden />
      <header className="rne-rv-top">
        <Logo size="host" />
        <span className="rn-lbl">{C.revealOf(index + 1, n, m.lap, m.triggers.map(triggerText).join(" · "))}</span>
        {main && (
          <span className="rne-stake rn-d">
            <b className="rn-num">{main.stakes}</b> <span>{C.ptsAtStake}</span>
          </span>
        )}
      </header>
      <section className="rne-rv-main">
        {right && (
          <h1 className="rne-stamp rn-d">
            <span>{C.rightCall(callText(right))}</span>
          </h1>
        )}
        {main && (
          <p className="rne-rv-line">
            {COPY.end.wasRight(right ?? main.correct, main.swing_s)} {COPY.end.teamDid(main.team, main.team_call)}
            {others.map((c) => ` ${COPY.end.carRight(c.code, c.final_right_call ?? c.correct, c.swing_s, c.stakes)}.`).join("")}
          </p>
        )}
        {main?.luck && main.explanation && <p className="rne-rv-luck">{main.explanation}</p>}
        <div className="rne-table" role="table" aria-label={COPY.end.momentHead(m.lap)}>
          <div className="rne-tr rne-th" role="row">
            <span role="columnheader">{C.cols.rank}</span>
            <span role="columnheader">{C.cols.who}</span>
            <span role="columnheader">{C.cols.call}</span>
            <span role="columnheader">{C.cols.how}</span>
            <span role="columnheader" className="rne-r">
              {C.cols.points}
            </span>
          </div>
          {rows.map((e) => (
            <RevealRow key={`${e.kind}:${e.name}:${e.driver_code}`} s={s} m={m} e={e} rank={ranks.get(e.name)} first={e.kind === "player" && ranks.get(e.name)?.rank === 1} />
          ))}
        </div>
      </section>
      <aside className="rne-rv-side">
        {rejoin && (
          <div className="rne-map">
            <span className="rn-lbl">{C.whereRejoined}</span>
            <TrackMap {...rejoin} size="host-sm" ariaLabel={C.whereRejoined} style={{ width: "100%", height: "auto" }} />
            {rejoin.caption && <p>{rejoin.caption}</p>}
          </div>
        )}
        <div className="rne-split">
          <span className="rn-d">{C.lobbySplit(box, stay)}</span>
          {none > 0 && <span className="rn-d rne-split-sub">{C.noCalls(none)}</span>}
        </div>
        <div className="rne-nav">
          <span className="rne-minor">
            {onBack && (
              <button type="button" className="rne-link" onClick={onBack}>
                {C.back}
              </button>
            )}
            {onSkip && (
              <button type="button" className="rne-link" onClick={onSkip}>
                {C.skip}
              </button>
            )}
          </span>
          <SkewButton variant="dark" size="host-sm" onClick={onNext} aria-keyshortcuts="ArrowRight Space">
            {nextLabel ?? (last ? C.standings : C.next)}
          </SkewButton>
        </div>
      </aside>
    </RNRoot>
  );
}

function RevealRow({ s, m, e, rank, first }: { s: GameSummary; m: SummaryMoment; e: MomentEntry; rank?: { rank: number; tied: boolean }; first: boolean }) {
  const bench = e.kind !== "player";
  const sp = splitOf(m, e);
  const right = rightOf(m, e);
  let how: string;
  let verdict: string | null;
  if (!e.call) {
    how = C.noCallMade;
    verdict = bench ? null : C.noCallVerdict;
  } else {
    how = sp ? COPY.end.split(sp, false) : "";
    const noReason = !e.said.trim();
    if (noReason && sp) how = `${sp.right ? COPY.end.right : COPY.end.wrong} ${COPY.end.points(sp.call)} · ${COPY.end.noReason.replace(/\.$/, "")}`;
    verdict = luckNote(m, e) ?? (noReason ? (bench ? null : C.noReasonVerdict) : e.verdict);
  }
  return (
    <div role="row" className={cx("rne-tr", bench ? "rne-bench" : "rne-player", first && "rne-first")}>
      <span role="cell" className="rn-d rne-rank">
        {!bench && rank ? `${rank.tied ? "=" : ""}${rank.rank}` : ""}
      </span>
      <span role="cell" className={cx("rne-who", !bench && "rn-d")}>
        <span className="rne-trunc">{label(e, s)}</span>
        {!bench && s.cars.length > 1 && e.driver_code && (
          <span className="rne-car" style={{ "--c": colourOf(s, e.driver_code) ?? "#A9AEB8" } as CSSProperties}>
            {e.driver_code}
          </span>
        )}
      </span>
      <span role="cell">
        <span className={cx("rne-call rn-d", !e.call ? "rne-call-none" : bench || right === false ? "rne-call-out" : "rne-call-solid")}>
          <span>{e.call ? callText(e.call) : COPY.end.noCall}</span>
        </span>
      </span>
      <span role="cell" className="rne-how">
        <span className="rn-num">{how}</span>
        {verdict && <q className="rne-verdict">{verdict}</q>}
      </span>
      <span role="cell" className="rn-d rn-num rne-pts">
        {COPY.end.points(e.points)}
      </span>
    </div>
  );
}

// ---- Podium (H09) ----

function bestReason(s: GameSummary): { e: MomentEntry; m: SummaryMoment } | null {
  let best: { e: MomentEntry; m: SummaryMoment } | null = null;
  for (const m of s.moments)
    for (const e of m.entries) {
      if (e.kind !== "player" || !e.call || !e.said.trim()) continue;
      if (!best || e.reasoning > best.e.reasoning) best = { e, m };
    }
  return best;
}

export function RNPodium({
  summary: s,
  code,
  team,
  onBack,
  onPlayAgain,
}: {
  summary: GameSummary;
  code: string;
  team: string | null;
  onBack?: () => void;
  onPlayAgain?: () => void;
}) {
  const router = useRouter();
  const rows = boardRows(s);
  const ranks = playerRanks(s.ranking);
  const players = s.ranking.filter((r) => r.kind === "player");
  // Podium blocks: distinct ranks 1..3, ties share a block.
  const blocks: { rank: number; tied: boolean; names: string[]; points: number }[] = [];
  for (const r of [...players].sort((a, b) => b.points - a.points)) {
    const pr = ranks.get(r.name);
    if (!pr || pr.rank > 3) continue;
    const b = blocks.find((x) => x.rank === pr.rank);
    if (b) b.names.push(r.name);
    else blocks.push({ rank: pr.rank, tied: pr.tied, names: [r.name], points: r.points });
  }
  const order = [blocks.find((b) => b.rank === 2), blocks.find((b) => b.rank === 1), blocks.find((b) => b.rank === 3)];
  const br = bestReason(s);
  const dense = rows.length > 9 ? "xs" : rows.length > 6 ? "sm" : "md";
  return (
    <RNRoot as="main" team={team} className="rne rne-podium" data-dense={dense}>
      <div className="rne-chequer" aria-hidden />
      <div className="rne-slab-right rne-slab-podium" aria-hidden />
      <section className="rne-pd-l">
        <Logo size="host" />
        <span className="rn-lbl rne-kicker">
          {COPY.end.status(s.race)} · {COPY.end.gameLine(s.moments.length, s.audibles.length).replace(/\.$/, "")} · {COPY.host.room(code)}
        </span>
        <h1 className="rn-d rne-pd-h">{winnerLine(s)}</h1>
        <div className="rne-steps">
          {order.map((b, i) =>
            b ? (
              <div key={b.rank} className="rne-step" data-place={b.rank} data-pos={i}>
                <div className="rne-step-who">
                  {b.names.slice(0, b.names.length > 3 ? 2 : 3).map((nm) => (
                    <span key={nm} className="rn-d rne-step-name rne-trunc">
                      {nm}
                    </span>
                  ))}
                  {b.names.length > 3 && <span className="rne-step-more">{C.more(b.names.length - 2)}</span>}
                  <span className="rn-d rn-num rne-step-pts">
                    {b.points}
                    {b.names.length > 1 && <span className="rne-each"> {C.each}</span>}
                  </span>
                </div>
                <div className="rne-block">
                  <span className="rn-d">{`${b.tied ? "=" : ""}${b.rank}`}</span>
                </div>
              </div>
            ) : (
              <div key={`e${i}`} className="rne-step rne-step-empty" data-pos={i} aria-hidden />
            ),
          )}
        </div>
        {br && (
          <div className="rne-best">
            <div className="rne-best-l">
              <span className="rn-lbl">{C.bestReason(br.e.name, br.m.lap, !!rightOf(br.m, br.e), COPY.end.points(br.e.points))}</span>
              <q className="rne-best-q">{br.e.said}</q>
            </div>
            <div className="rne-best-r">
              <span className="rn-d rn-num rne-best-score">
                {br.e.reasoning}
                <span className="rn-u">/50</span>
              </span>
              <span className="rne-best-g">{C.graded}</span>
            </div>
          </div>
        )}
      </section>
      <aside className="rne-pd-r">
        <div className="rne-rank-panel">
          <div className="rne-rank-head rn-lbl">
            <span>{COPY.end.ranking}</span>
            <span>{COPY.end.yourTotal.replace(/^Your /, "")}</span>
          </div>
          <ol className="rne-rank-list">
            {rows.map((r) => (
              <RankLine key={`${r.kind}:${r.name}:${r.driver_code}`} r={r} s={s} rank={ranks.get(r.name)} />
            ))}
          </ol>
          <p className="rne-note">{COPY.end.engineNote}</p>
        </div>
        <div className="rne-pd-btns">
          {onBack && (
            <button type="button" className="rne-link" onClick={onBack}>
              {C.back}
            </button>
          )}
          {onPlayAgain && (
            <SkewButton variant="primary" size="host-sm" onClick={onPlayAgain}>
              {C.playAgain}
            </SkewButton>
          )}
          <SkewButton variant="dark" size="host-sm" onClick={() => router.push("/")}>
            {COPY.end.newLobby}
          </SkewButton>
        </div>
      </aside>
    </RNRoot>
  );
}

function RankLine({ r, s, rank }: { r: RankRow; s: GameSummary; rank?: PlayerRank }) {
  const bench = r.kind !== "player";
  const mine = bench ? [] : s.audibles.filter((a) => a.name === r.name);
  const aud = { n: mine.length, points: mine.reduce((t, a) => t + a.points, 0) };
  return (
    <li className={cx("rne-rl", bench ? "rne-bench" : "rne-player", !bench && rank?.rank === 1 && "rne-first")}>
      <span className="rn-d rne-rank">{!bench && rank ? rankText(rank) : ""}</span>
      <span className={cx("rne-who", !bench && "rn-d")}>
        <span className="rne-trunc">{label(r, s)}</span>
        {bench && <span className="rn-lbl rne-tag">{C.benchmark}</span>}
        {!bench && aud.n > 0 && <span className="rne-tag-aud">{COPY.end.audiblesLine(aud.n, aud.points)}</span>}
      </span>
      <span className="rn-d rn-num rne-pts">{COPY.end.points(r.points)}</span>
    </li>
  );
}
