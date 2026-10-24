"use client";
// Reveal (four steps; ArrowRight or Next skips) and the scoreboard for the host screen. Renders only from
// useReveal's full decision and frames, so race and team names may appear from here on.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { COPY, factorLabel } from "@/lib/copy";
import { api, type CampsResponse, type LeaderboardResponse, type LobbyStateResponse, type RevealResponse } from "@/lib/client/api";
import { revealFor } from "@/lib/client/drivers";
import { DUEL_SPEAK_MS, DUEL_START_MS, duelStage, speakLeft, useDuel } from "@/lib/client/duel";
import { DuelPerson, DuelTally } from "../Duel";
import { benchmarksFor, carOf, carsInPlay } from "./cars";
import { MAX_TOTAL, PLAYED_OUT_MS, badgesFor, fmtSeconds, playedOutLap, splitCalls, tla } from "@/lib/client/race";
import type { Call, DecisionPoint, LapFrame, Submission } from "@/lib/types";
import type { DataMode, GroundTruthFile } from "@/lib/client/mode";
import { Measured } from "../Measured";
import { BadgeList, Button, CallWord, Check, ModeToggle, clockText } from "../ui";
import { DiffBars, boxMinusStay } from "./HostCharts";
import { NeighbourList } from "../Telemetry";
import { neighbourCalls, telemetry } from "@/lib/client/telemetry";
import { callMomentFrames } from "@/lib/client/race";

// Room split; then (Round 5) the duel on the phones' shared schedule: A speaks, B speaks, the room votes until the
// host moves on; then team and engine, the outcome bars playing out (held 6 s after they finish), the verdict.
// Without a duel the room split holds 7 s.
const ROOM_ONLY_MS = 7000;
const OUTCOME_AT = 6000;
const VERDICT_AT = OUTCOME_AT + PLAYED_OUT_MS + 6000;

// `code` is this lobby: the route fills the team and engine rows only once it has revealed.
function useLeaderboard(decisionId: string, code: string, when: boolean) {
  const [lb, setLb] = useState<LeaderboardResponse | null>(null);
  useEffect(() => {
    if (!when) return;
    let alive = true;
    const load = () =>
      api
        .leaderboard(decisionId, code)
        .then((r) => alive && setLb(r))
        .catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [decisionId, code, when]);
  return lb;
}

function Steps({ step, total, onNext }: { step: number; total: number; onNext: () => void }) {
  return (
    <span className="flex items-center gap-4">
      <span className="flex gap-1.5" role="img" aria-label={COPY.host.step(step + 1, total)}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`size-3 ${i <= step ? "bg-current" : "border-2 border-current"}`} />
        ))}
      </span>
      {step < total - 1 && (
        <Button variant="quiet" onClick={onNext}>
          {COPY.host.next} ›
        </Button>
      )}
    </span>
  );
}

// The correct call for each player's own car (Round 4): their car's measured outcome, else the lobby car's.
function useCorrectFor(reveal: RevealResponse, lobby: LobbyStateResponse, fallback: Call) {
  return useMemo(() => {
    const m = new Map<string, Call>();
    for (const p of lobby.players) m.set(p.name, revealFor(reveal, carOf(lobby, p.name)).decision.ground_truth.correct);
    return (name: string) => m.get(name) ?? fallback;
  }, [reveal, lobby, fallback]);
}

export function HostReveal({
  code,
  reveal,
  carCode,
  frames,
  lobby,
  elapsed,
  onNext,
  mode,
  setMode,
}: {
  code: string;
  // From GET /api/lobby/[code]/reveal: the full decision, every lap and each car's outcome.
  reveal: RevealResponse;
  // The car the host screen follows (components/host/cars.ts).
  carCode: string | null;
  frames: LapFrame[];
  lobby: LobbyStateResponse;
  elapsed: number;
  onNext: () => void;
  mode: DataMode;
  setMode: (m: DataMode) => void;
}) {
  const main = useMemo(() => revealFor(reveal, carCode), [reveal, carCode]);
  const decision = main.decision;
  const gt = main.gt;
  const correctFor = useCorrectFor(reveal, lobby, decision.ground_truth.correct);
  const cars = carsInPlay(lobby);
  const [skip, setSkip] = useState(0);
  const at = elapsed + skip;
  const { duel } = useDuel(code, lobby.phase);
  const hasDuel = !!duel?.pair;
  const duelPending = !duel || duel.pending;
  // When the post-duel part starts (host time). Set by Next during the vote, or by Next on a held room split.
  const [postAt, setPostAt] = useState<number | null>(null);
  const P = postAt ?? (hasDuel || duelPending ? null : ROOM_ONLY_MS);
  const view: "room" | "a" | "b" | "vote" | "post" =
    P != null && at >= P ? "post" : hasDuel && at >= DUEL_START_MS ? (duelStage(at) as "a" | "b" | "vote") : "room";
  const tp = P != null ? at - P : 0;
  const step = view !== "post" ? 0 : tp < OUTCOME_AT ? 1 : tp < VERDICT_AT ? 2 : 3;
  const duelIdx = { room: 0, a: 1, b: 2, vote: 3, post: 0 }[view];
  const stepIdx = view === "post" ? step + (hasDuel ? 3 : 0) : duelIdx;
  const stepTotal = hasDuel ? 7 : 4;
  const jump = (target: number) => setSkip((k) => k + Math.max(0, target - at));
  const advance = () => {
    if (view === "room") return hasDuel ? jump(DUEL_START_MS) : setPostAt(at);
    if (view === "a") return jump(DUEL_START_MS + DUEL_SPEAK_MS);
    if (view === "b") return jump(DUEL_START_MS + DUEL_SPEAK_MS * 2);
    if (view === "vote") return setPostAt(at);
    if (P == null) return;
    if (tp < OUTCOME_AT) return jump(P + OUTCOME_AT);
    if (tp < VERDICT_AT) return jump(P + VERDICT_AT);
  };
  const advanceRef = useRef(advance);
  useEffect(() => {
    advanceRef.current = advance;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") advanceRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lb = useLeaderboard(decision.id, code, step >= 1);
  const [camps, setCamps] = useState<CampsResponse | null>(null);
  useEffect(() => {
    api.camps(code).then(setCamps).catch(() => {});
  }, [code, lobby.submissions.length]);

  const subs = lobby.submissions;
  const byName = new Map(subs.map((s) => [s.player_name, s]));
  const players = lobby.players.map((p) => ({ name: p.name, sub: byName.get(p.name) ?? null }));
  const { box, stay } = splitCalls(subs);

  const lap = step < 2 ? decision.lap : step === 2 ? playedOutLap(decision, tp - OUTCOME_AT) : decision.reveal_to_lap;
  const total = decision.total_laps;


  const diff = useMemo(() => boxMinusStay(frames, decision.lap, decision.reveal_to_lap, decision.player_role.number), [frames, decision]);
  // The cars either side at the call, now with what they actually did (full frames from the reveal route).
  const near = useMemo(() => {
    const t = telemetry(callMomentFrames(frames, decision), decision);
    if (!t) return null;
    return { t, revealed: neighbourCalls(frames, decision, { ahead: t.neighbours.ahead?.number, behind: t.neighbours.behind?.number }) };
  }, [frames, decision]);

  if (step === 3) return <Verdict stepTotal={stepTotal} decision={decision} carCode={carCode} correctFor={correctFor} lobby={lobby} lb={lb} camps={camps} onNext={onNext} mode={mode} modeToggle={<ModeToggle mode={mode} onChange={setMode} size="sm" />} gt={gt} />;

  const top = (
    <header className="flex items-center justify-between gap-6 font-mono text-lg font-bold uppercase">
      <span>
        {view === "a" || view === "b" || view === "vote"
          ? `${COPY.duel.title} · ${decision.race} · L${decision.lap}`
          : COPY.host.revealTag(Math.min(step + 1, 3), 3, decision.race, decision.lap)}
      </span>
      <span className="flex items-center gap-6 font-sans normal-case">
        <ModeToggle mode={mode} onChange={setMode} size="sm" onField={step > 0} />
        <Steps step={stepIdx} total={stepTotal} onNext={advance} />
      </span>
    </header>
  );

  if ((view === "a" || view === "b" || view === "vote") && duel?.pair) {
    const colours = Object.fromEntries(Object.entries(reveal.drivers ?? {}).map(([k, v]) => [k, v.team_colour]));
    const left = speakLeft(at);
    return (
      <main className="grid h-dvh grid-rows-[auto_auto_1fr_auto] gap-y-8 overflow-hidden px-14 py-10">
        {top}
        {duel.prompt ? <p className="max-w-[60ch] text-2xl font-bold leading-snug">{duel.prompt}</p> : <span />}
        <div className="grid min-h-0 grid-cols-2 gap-x-12">
          {duel.pair.map((side, i) => {
            const active = view === "vote" || (view === "a" ? i === 0 : i === 1);
            const speaking = (view === "a" && i === 0) || (view === "b" && i === 1);
            return (
              <section key={side.name} className={`flex min-h-0 flex-col gap-6 border-t-[3px] pt-6 ${active ? "border-ink" : "border-line"}`}>
                <div className="flex min-h-[7rem] items-end justify-between gap-6">
                  {speaking ? (
                    <>
                      <span className="meta">{COPY.duel.speaking(tla(side.name))}</span>
                      <span key={left} aria-live="polite" className={`nums text-[7rem] font-bold leading-none tracking-[-0.04em] ${left <= 3 ? "tick" : ""}`}>
                        <span aria-label={COPY.duel.secondsLeft(left)}>
                          {left}
                          <span aria-hidden className="ml-2 text-[0.4em]">s</span>
                        </span>
                      </span>
                    </>
                  ) : view === "vote" ? (
                    <span className="nums text-[4rem] font-bold leading-none">{duel.votes[i]}</span>
                  ) : (
                    <span />
                  )}
                </div>
                <DuelPerson side={side} active={active} big cars={colours} />
              </section>
            );
          })}
        </div>
        <footer className="flex flex-col gap-4">
          {view === "vote" ? (
            <>
              <p className="text-xl font-bold">{COPY.duel.vote}</p>
              <DuelTally duel={duel} big />
            </>
          ) : (
            <p className="text-lg font-bold">{COPY.duel.listen}</p>
          )}
          {duel.source === "muse" && <p className="text-sm text-ink-2">{COPY.duel.museCredit}</p>}
        </footer>
      </main>
    );
  }

  // Step 1: the room's calls get the whole screen, each player's own words under their call, grouped by camp.
  if (step === 0) {
    const sides: { call: Call; list: typeof players }[] = [
      { call: "BOX", list: players.filter((p) => p.sub?.call === "BOX") },
      { call: "STAY", list: players.filter((p) => p.sub?.call === "STAY") },
    ];
    const none = players.filter((p) => !p.sub?.call);
    const n = Math.max(1, box + stay);
    const campOf = (list: typeof players) => {
      const names = new Set(list.map((p) => p.name));
      const muse = camps?.labels?.filter((c) => c.players.some((x) => names.has(x))).sort((x, y) => y.count - x.count)[0];
      if (muse) return muse.label;
      const f = camps?.camps.filter((c) => c.players.some((x) => names.has(x))).sort((x, y) => y.count - x.count)[0];
      return f ? factorLabel(f.factor) : null;
    };
    const many = players.length > 4;
    const crowd = players.length > 8;
    // Quotes that fit on one screen per side; the rest are listed by code.
    const cap = crowd ? 3 : 6;
    return (
      <main className="grid h-dvh grid-rows-[auto_auto_auto_1fr_auto] gap-y-6 overflow-hidden px-14 py-10">
        {top}
        <div className="flex items-end justify-between gap-8">
          <h1 className="display text-[5rem] leading-none">{COPY.host.roomSplit(box, stay)}</h1>
          {cars.length > 1 && (
            <ul className="flex flex-col items-end pb-2 font-mono text-sm font-bold">
              {cars.map((c) => {
                const mine = subs.filter((x) => carOf(lobby, x.player_name) === c);
                const sp = splitCalls(mine);
                return <li key={c}>{COPY.host.carSplit(c, sp.box, sp.stay)}</li>;
              })}
            </ul>
          )}
        </div>
        <div className="flex h-[120px] border-2 border-ink">
          {sides.map((side) =>
            side.list.length ? (
              <div
                key={side.call}
                className={`grow-x flex items-center justify-between gap-4 px-8 ${side.call === "BOX" ? "on-dark bg-ink text-white" : "bg-soft text-ink"}`}
                style={{ flexGrow: side.list.length / n, flexBasis: 0 }}
              >
                <CallWord call={side.call} className={`whitespace-nowrap font-black tracking-[-0.03em] ${side.list.length / n < 0.4 ? "text-[2.25rem]" : "text-[3.25rem]"}`} />
                <span className="truncate font-mono text-lg font-bold">{side.list.map((p) => tla(p.name)).join(" · ")}</span>
              </div>
            ) : null,
          )}
          {box + stay === 0 && <div className="flex-1 bg-soft" />}
        </div>
        <div className="grid min-h-0 gap-x-6" style={{ gridTemplateColumns: sides.map((s) => `${Math.max(0.3, s.list.length / n)}fr`).join(" ") }}>
          {sides.map((side) => (
            <section key={side.call} className="flex min-h-0 flex-col border-t-2 border-ink pt-4">
              <span className="meta shrink-0 text-ink-2">{COPY.host.campTag(COPY.freeze.options[side.call])}</span>
              <h2 className={`display mt-1 line-clamp-2 shrink-0 leading-[0.98] ${crowd ? "text-[2.25rem]" : "text-[3rem]"}`}>{campOf(side.list) ?? COPY.freeze.options[side.call]}</h2>
              <ol className={`mt-5 grid min-h-0 gap-x-8 gap-y-5 overflow-hidden ${side.list.length > 1 && side.list.length / n > 0.5 ? "grid-cols-2" : "grid-cols-1"}`}>
                {side.list.slice(0, cap).map((p, i) => (
                  <li key={p.name} className="rise flex flex-col gap-2 border-l-[3px] border-ink pl-5" style={{ animationDelay: `${200 + i * 300}ms` }}>
                    {p.sub?.transcript && <q className={`${crowd ? "line-clamp-2 text-lg" : many ? "line-clamp-3 text-2xl" : "line-clamp-4 text-[2rem]"} font-medium leading-[1.3]`}>{p.sub.transcript}</q>}
                    <span className="font-mono text-sm">
                      <b className="font-bold">{tla(p.name)}</b>
                      {cars.length > 1 && <b className="font-bold"> · {carOf(lobby, p.name)}</b>} <span className="text-ink-2">{COPY.host.calledAt(clockText(p.sub?.seconds_to_call ?? 0))}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {side.list.length > cap && <p className="mt-3 shrink-0 font-mono text-sm font-bold">+ {side.list.slice(cap).map((p) => tla(p.name)).join(" · ")}</p>}
            </section>
          ))}
        </div>
        <footer className="flex items-center justify-between gap-6 text-base">
          {none.length > 0 ? (
            <p className="text-ink-2">
              {COPY.reveal.noCall}: <span className="font-black text-ink">{none.map((p) => tla(p.name)).join("  ")}</span>
            </p>
          ) : (
            <span />
          )}
          {camps?.labels_source === "muse" && camps.labels?.length ? <p className="text-sm text-ink-2">{COPY.reveal.campsByMuse}</p> : null}
        </footer>
      </main>
    );
  }

  // Steps 2 and 3: team, engine and (from step 3) the outcome on the team-colour field, with the box-minus-stay bars playing out.
  const team = decision.team;
  const engine = decision.engine;
  const correct = decision.ground_truth.correct;
  const end = diff?.values.filter((v): v is number => v != null).at(-1) ?? null;
  return (
    <main className="flood grid h-dvh grid-rows-[auto_auto_auto_1fr] gap-y-6 overflow-hidden bg-field px-14 py-10 text-on-field">
      {top}
      <div className="grid grid-cols-3 gap-x-6">
        <div className="rise flex flex-col border-t-2 border-on-field pt-4">
          <span className="meta">{COPY.host.teamDid(decision.player_role.team)}</span>
          <span className="display mt-3 text-[4rem] leading-none">{COPY.freeze.options[team.call]}</span>
          <span className="mt-3 line-clamp-2 font-mono text-base">{team.reasons[0] ?? COPY.empty.noRadio}</span>
        </div>
        <div className="rise flex flex-col border-t-2 border-on-field pt-4" style={{ animationDelay: "400ms" }}>
          <span className="meta">{COPY.host.engineSaid}</span>
          <span className="display mt-3 text-[4rem] leading-none">
            {COPY.freeze.options[engine.call]} · <span className="nums">{Math.round(engine.confidence * 100)}%</span>
          </span>
          {engine.reasons.length === 0 ? (
            <span className="mt-3 font-mono text-base">{COPY.empty.noEngine}</span>
          ) : mode === "simple" ? (
            <span className="mt-3 line-clamp-2 font-mono text-base">{engine.reasons[0]}</span>
          ) : (
            <ol className="mt-3 flex list-decimal flex-col gap-0.5 pl-5 font-mono text-sm">
              {engine.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          )}
        </div>
        {step >= 2 ? (
          <div className="rise on-dark flex flex-col bg-ink px-6 pb-5 pt-0 text-white">
            <span className="mt-4 border-t-2 border-white pt-4 font-mono text-xs font-bold uppercase">{COPY.host.outcome}</span>
            <span className="display nums mt-3 text-[4rem] leading-none">
              +{decision.ground_truth.swing_s.toFixed(1)}
              <span className="ml-2 text-[0.5em]">s</span>
            </span>
            <span className="mt-3 font-mono text-base">{COPY.host.worth(correct)}</span>
          </div>
        ) : (
          <div className="border-2 border-dashed border-on-field" aria-hidden />
        )}
      </div>
      {cars.filter((c) => c !== carCode).length > 0 && (
        <ul className="-mt-2 flex flex-col gap-1 font-mono text-sm font-bold">
          {cars
            .filter((c) => c !== carCode)
            .map((c) => {
              const o = revealFor(reveal, c).decision;
              return (
                <li key={c}>
                  {COPY.host.otherCar(c, o.player_role.team, o.team.call, o.engine.call, Math.round(o.engine.confidence * 100), o.ground_truth.correct, o.ground_truth.swing_s)}
                </li>
              );
            })}
        </ul>
      )}
      <section className="flex min-h-0 flex-col border-t-2 border-on-field pt-4">
        <div className="flex items-baseline justify-between gap-6">
          <span className="meta">{COPY.host.diffTitle}</span>
          <span className="meta font-medium">
            {COPY.replay.lap(lap, total)} · {COPY.host.diffNote}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-6 font-mono text-sm">
          <span className="flex items-center gap-2">
            <span className="size-3.5 bg-current" />
            {COPY.host.boxAhead}
          </span>
          <span className="flex items-center gap-2">
            <span className="size-3.5 border-[1.5px] border-current" />
            {COPY.host.boxBehind}
          </span>
          {step >= 2 && end != null && <b className="ml-auto font-bold">{COPY.host.atLap(end, decision.reveal_to_lap)}</b>}
        </div>
        <div className="mt-3 grid min-h-0 grid-cols-[1fr_340px] gap-8">
          <div className="min-w-0">
          {diff ? (
            <DiffBars laps={diff.laps} values={diff.values} upto={step >= 2 ? lap : decision.lap - 1} height={470} />
          ) : (
            <p className="text-xl font-bold">{COPY.reveal.outcome[decision.id] ?? ""}</p>
          )}
          </div>
          {near && (
            <div className="rise min-w-0">
              <NeighbourList t={near.t} revealed={near.revealed} />
            </div>
          )}
        </div>
        <ol className="mt-auto flex flex-wrap gap-x-6 gap-y-2 pt-3">
          {players.map((p) => (
            <li key={p.name} className="flex items-baseline gap-2">
              <span className="text-xl font-black tracking-tight">{tla(p.name)}</span>
              <CallWord call={p.sub?.call ?? null} className="font-mono text-sm font-bold" />
              {p.sub?.call === correctFor(p.name) && step >= 2 && <span className="meta border border-on-field px-1">{COPY.reveal.right}</span>}
            </li>
          ))}
          {step >= 2 && <li className="ml-auto text-base font-bold">{COPY.reveal.outcome[decision.id] ?? ""}</li>}
        </ol>
      </section>
    </main>
  );
}

function Verdict({
  stepTotal,
  decision,
  carCode,
  correctFor,
  lobby,
  lb,
  camps,
  onNext,
  mode,
  modeToggle,
  gt,
}: {
  stepTotal: number;
  decision: DecisionPoint;
  carCode: string | null;
  correctFor: (name: string) => Call;
  lobby: LobbyStateResponse;
  lb: LeaderboardResponse | null;
  camps: CampsResponse | null;
  onNext: () => void;
  mode: DataMode;
  modeToggle: React.ReactNode;
  gt: GroundTruthFile | null;
}) {
  const correct = decision.ground_truth.correct;
  const subs = [...lobby.submissions].sort((a, b) => b.total - a.total || a.seconds_to_call - b.seconds_to_call);
  const factors = decision.factors;
  const dense = subs.length > 6;
  const rowH = dense ? "min-h-[36px]" : "min-h-12";
  const cols = `minmax(110px,1.1fr) 200px repeat(${factors.length}, minmax(64px,0.8fr)) 64px 132px`;

  const best = subs.filter((s) => s.factors_named.length > 0);
  const bestK = best.length ? Math.max(...best.map((s) => s.factors_named.length)) : 0;
  const bestRows = best.filter((s) => s.factors_named.length === bestK).slice(0, 2);

  // With a full room the table keeps the top rows on screen and counts the rest.
  const CAP = 9;
  const shownSubs = subs.length > CAP + 1 ? subs.slice(0, CAP) : subs;
  const hidden = subs.length - shownSubs.length;
  const bench = benchmarksFor(lb, carCode);
  type Row = { key: string; label: string; car: string | null; call: Call | null; correct: Call; named: string[]; time: number | null; total: number; kind: "player" | "team" | "engine" };
  const rows: Row[] = [
    ...shownSubs.map((s) => ({
      key: s.player_name,
      label: tla(s.player_name),
      car: carOf(lobby, s.player_name),
      call: s.call,
      correct: correctFor(s.player_name),
      named: s.factors_named,
      time: s.seconds_to_call,
      total: s.total,
      kind: "player" as const,
    })),
    ...(bench.team && bench.engine
      ? [
          { key: "team", label: decision.player_role.team, car: carCode, call: bench.team.call, correct, named: bench.team.factors_named, time: null, total: bench.team.total, kind: "team" as const },
          { key: "engine", label: COPY.reveal.engine, car: carCode, call: bench.engine.call, correct, named: bench.engine.factors_named, time: null, total: bench.engine.total, kind: "engine" as const },
        ]
      : []),
  ];
  const multi = carsInPlay(lobby).length > 1;

  return (
    <main className="grid h-dvh grid-cols-12 grid-rows-[auto_auto_1fr_auto] gap-x-6 gap-y-6 overflow-hidden px-14 py-10">
      <header className="col-span-12 flex items-center justify-between gap-6">
        <span className="meta text-sm">
          {decision.race} · {COPY.reveal.heading(decision.lap)}
        </span>
        <Steps step={stepTotal - 1} total={stepTotal} onNext={() => {}} />
      </header>
      <div className="col-span-12 flex items-end justify-between gap-10 border-b-2 border-ink pb-6">
        <h1 className="display text-[4.5rem] leading-none [text-wrap:nowrap]!">{COPY.reveal.verdict(correct)}</h1>
        <div className="flex min-w-0 items-end gap-6">
          <span className="nums shrink-0 bg-field px-4 py-2 text-4xl font-bold leading-none text-on-field">
            +{decision.ground_truth.swing_s.toFixed(1)}
            <span className="ml-1.5 text-[0.55em]">s</span>
          </span>
          <p className="max-w-[44ch] text-base">
            {COPY.reveal.swing(correct, decision.ground_truth.swing_s, decision.reveal_to_lap)} {COPY.reveal.outcome[decision.id] ?? ""}
          </p>
        </div>
      </div>

      <section className="col-span-9 flex min-h-0 flex-col gap-4 overflow-hidden">
        <div role="table" className="flex flex-col">
          <div role="row" className="grid items-end gap-x-4 border-b-2 border-ink pb-2" style={{ gridTemplateColumns: cols }}>
            <span role="columnheader" className="meta">{COPY.reveal.who}</span>
            <span role="columnheader" className="meta">{COPY.reveal.call}</span>
            {factors.map((f) => (
              <span role="columnheader" key={f} className="text-center text-xs font-bold leading-tight">
                {factorLabel(f)}
              </span>
            ))}
            <span role="columnheader" className="meta text-right">{COPY.reveal.speed}</span>
            <span role="columnheader" className="meta text-right">{COPY.reveal.score}</span>
          </div>
          {rows.map((r) => (
            <div
              role="row"
              key={r.key}
              className={`grid ${rowH} items-center gap-x-4 border-b ${r.kind === "player" ? "border-line" : "border-ink bg-soft"}`}
              style={{ gridTemplateColumns: cols }}
            >
              <span role="cell" className={`truncate pl-1 font-black tracking-tight ${dense ? "text-lg" : "text-xl"}`}>
                {r.label}
                {multi && r.kind === "player" && r.car && <span className="ml-2 font-mono text-xs font-bold">{r.car}</span>}
              </span>
              <span role="cell" className="flex items-baseline gap-3 whitespace-nowrap">
                <CallWord call={r.call} className={`font-bold ${dense ? "text-base" : "text-xl"}`} />
                {r.call === r.correct && <span className="meta bg-ink px-1.5 py-0.5 text-white">{COPY.reveal.right}</span>}
              </span>
              {factors.map((f) => (
                <span role="cell" key={f} className="flex justify-center" aria-label={`${factorLabel(f)}: ${r.named.includes(f) ? "yes" : "no"}`}>
                  {r.named.includes(f) ? <Check /> : <span className="text-ink-3">{COPY.reveal.notNamed}</span>}
                </span>
              ))}
              <span role="cell" className="nums text-right text-base">
                {r.time != null ? fmtSeconds(r.time) : ""}
              </span>
              <span role="cell" className={`nums whitespace-nowrap pr-1 text-right font-bold ${dense ? "text-base" : "text-lg"}`}>
                {r.total} <span className="text-sm font-medium text-ink-2">{COPY.score.outOf(MAX_TOTAL)}</span>
              </span>
            </div>
          ))}
          {hidden > 0 && <p className="pt-2 font-mono text-sm font-bold">{COPY.host.andMore(hidden)}</p>}
        </div>
        {(dense ? bestRows.slice(0, 1) : bestRows).map((s) => (
          <p key={s.player_name} className="line-clamp-2 text-lg">
            <span className="font-black">{COPY.reveal.bestReason(tla(s.player_name), bestK, factors.length)}</span> <q className="font-medium">{s.transcript}</q>
          </p>
        ))}
        {mode === "advanced" && !dense && <Measured decision={decision} gt={gt} />}
      </section>

      <section className="col-span-3 flex min-h-0 flex-col gap-3 overflow-hidden">
        {mode === "advanced" && dense && <Measured decision={decision} gt={gt} size="sm" />}
        <span className="meta border-b-2 border-ink pb-2">{COPY.reveal.camps}</span>
        {camps?.labels_source === "muse" && camps.labels && camps.labels.length > 0 ? (
          <>
            <ol className="flex flex-col">
              {camps.labels.slice(0, 4).map((c) => (
                <li key={c.label} className="flex flex-col gap-1 border-b border-line py-3">
                  <span className="text-lg font-black leading-tight tracking-tight">{c.label}</span>
                  <span className="flex items-baseline justify-between gap-3">
                    {c.call ? <CallWord call={c.call} className="meta" /> : <span />}
                    <span className="text-sm font-bold">{c.players.map(tla).join(" ")}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-sm text-ink-2">{COPY.reveal.campsByMuse}</p>
          </>
        ) : camps && camps.camps.length > 0 ? (
          <ol className="flex flex-col">
            {camps.camps.slice(0, 4).map((c) => (
              <li key={c.factor} className="flex flex-col gap-1 border-b border-line py-3">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="nums text-base font-bold">{COPY.reveal.camp(c.count, camps.submitted, factorLabel(c.factor))}</span>
                  <span className="text-sm font-bold">{c.players.map(tla).join(" ")}</span>
                </span>
                {c.quotes[0] && <q className="line-clamp-1 text-sm text-ink-2">{c.quotes[0]}</q>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-base text-ink-2">{camps ? COPY.reveal.noFactor : COPY.reveal.grading}</p>
        )}
      </section>

      <footer className="col-span-12 flex items-end justify-between gap-6">
        <span className="flex items-center gap-6">
          <Button size="lg" onClick={onNext}>
            {COPY.reveal.showScores}
          </Button>
          {modeToggle}
        </span>
        <p className="max-w-[80ch] text-right text-xs text-ink-2">{COPY.reveal.credit}</p>
      </footer>
    </main>
  );
}

export function HostScoreboard({ code, reveal, carCode, lobby }: { code: string; reveal: RevealResponse; carCode: string | null; lobby: LobbyStateResponse }) {
  const decision = useMemo(() => revealFor(reveal, carCode).decision, [reveal, carCode]);
  const carDecision = (name: string) => revealFor(reveal, carOf(lobby, name)).decision;
  const multi = carsInPlay(lobby).length > 1;
  const router = useRouter();
  const lb = useLeaderboard(decision.id, code, true);
  const [selected, setSelected] = useState<string | null>(null);

  const bench = benchmarksFor(lb, carCode);
  const teamTotal = bench.team?.total ?? null;
  const engineTotal = bench.engine?.total ?? null;
  const pctOf = (name: string) => lb?.rows.find((r) => r.kind === "player" && r.name === name && r.lobby_code === code)?.percentile ?? null;

  type Row = { key: string; kind: "player" | "team" | "engine"; label: string; name: string; total: number; c: number; r: number; sub?: Submission };
  const unsorted: Row[] = [
    ...lobby.submissions.map((s) => ({ key: s.player_name, kind: "player" as const, label: tla(s.player_name), name: s.player_name, total: s.total, c: s.score_call, r: s.score_reasoning, sub: s })),
    ...(bench.team && bench.engine
      ? [
          { key: "team", kind: "team" as const, label: decision.player_role.team, name: COPY.leaderboard.teamRow(decision.player_role.team), total: bench.team.total, c: bench.team.score_call ?? 0, r: bench.team.score_reasoning ?? 0 },
          { key: "engine", kind: "engine" as const, label: COPY.reveal.engine, name: COPY.leaderboard.engineRow, total: bench.engine.total, c: bench.engine.score_call ?? 0, r: bench.engine.score_reasoning ?? 0 },
        ]
      : []),
  ];
  const rows = unsorted.sort(
    (a, b) =>
      b.total - a.total || (a.kind === "player" ? 0 : 1) - (b.kind === "player" ? 0 : 1) || (a.sub?.seconds_to_call ?? 0) - (b.sub?.seconds_to_call ?? 0),
  );

  const sel = rows.find((r) => r.key === selected) ?? rows.find((r) => r.kind === "player") ?? rows[0];
  const lobbyPlayers = rows.filter((r) => r.kind === "player");
  const selRank = sel ? lobbyPlayers.findIndex((r) => r.key === sel.key) + 1 : 0;
  const selPct = sel?.kind === "player" ? pctOf(sel.name) : null;

  // Head-to-head facts from this decision's submissions.
  const facts: string[] = [];
  const boxers = lobby.submissions.filter((s) => s.call === "BOX").map((s) => tla(s.player_name));
  const stayers = lobby.submissions.filter((s) => s.call === "STAY").map((s) => tla(s.player_name));
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);
  if (boxers.length >= 2) facts.push(COPY.score.bothCalled(list(boxers), "BOX"));
  if (stayers.length >= 2) facts.push(COPY.score.bothCalled(list(stayers), "STAY"));
  const top = lobbyPlayers[0];
  if (top && engineTotal != null && top.total > engineTotal) facts.push(COPY.score.beatEngineBy(top.label, top.total - engineTotal));
  else if (top && teamTotal != null && top.total > teamTotal) facts.push(COPY.score.beatTeamBy(top.label, decision.player_role.team, top.total - teamTotal));
  const pct = selPct != null ? COPY.score.percentile(selPct) : null;
  const engineCallFor = (name: string) => carDecision(name).engine.call;
  const big = rows.length > 9 ? "text-lg" : "text-[1.625rem]";
  const perFactor = decision.factors.length ? 50 : 0;
  const cols = "56px minmax(150px,1.2fr) 120px 110px 140px 130px 110px 90px minmax(90px,0.8fr)";

  return (
    <main className="grid h-dvh grid-cols-12 grid-rows-[auto_auto_1fr_auto] gap-x-6 gap-y-6 overflow-hidden px-14 py-10">
      <header className="col-span-12 flex items-center justify-between gap-6 font-mono text-lg font-bold uppercase">
        <span>{COPY.host.scoreboardTag(decision.race, decision.lap)}</span>
        <span>{COPY.host.room(code)}</span>
      </header>
      <div className="col-span-12 flex items-end justify-between gap-8">
        <h1 className="display text-[4.5rem] leading-none [text-wrap:nowrap]!">{top ? COPY.host.takesRound(top.label) : COPY.score.standings}</h1>
        {facts.length > 0 && <p className="max-w-[40ch] pb-2 text-right text-lg font-bold">{facts.join(" ")}</p>}
      </div>

      <section className="col-span-8 flex min-h-0 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-col">
          <div className="grid items-end gap-x-4 border-b-2 border-ink pb-2" style={{ gridTemplateColumns: cols }}>
            {[COPY.host.cols.rank, COPY.host.cols.player, COPY.host.cols.call, COPY.host.cols.time, COPY.host.cols.vsEngine, COPY.host.cols.callPts, COPY.host.cols.reason, COPY.host.cols.pct, COPY.host.cols.total].map((h, i) => (
              <span key={h} className={`meta text-ink-2 ${i >= 7 ? "text-right" : ""}`}>
                {h}
              </span>
            ))}
          </div>
          {rows.map((r) => {
            // The round's winner gets the team-colour band, even when a benchmark row scored higher.
            const p1 = r === lobbyPlayers[0];
            const on = sel?.key === r.key;
            const pctR = r.kind === "player" ? pctOf(r.name) : null;
            const call = r.sub?.call ?? (r.kind === "team" ? bench.team?.call : r.kind === "engine" ? bench.engine?.call : null) ?? null;
            return (
              <button
               
                key={r.key}
                onClick={() => setSelected(r.key)}
                aria-pressed={on}
                style={{ gridTemplateColumns: cols }}
                className={`grid items-center gap-x-4 border-b text-left transition-colors duration-150 ${rows.length > 9 ? "min-h-[40px]" : rows.length > 5 ? "min-h-[60px]" : "min-h-[96px]"} ${
                  p1 ? "-mx-5 border-field bg-field px-5 text-on-field" : r.kind === "player" ? "border-line hover:bg-soft" : "border-line text-ink-2 hover:bg-soft"
                } ${on && !p1 ? "outline outline-2 -outline-offset-2 outline-ink" : ""}`}
              >
                <span className="nums text-xl font-bold">
                  {r.kind === "player" ? lobbyPlayers.indexOf(r) + 1 : ""}
                </span>
                <span className={`truncate font-black tracking-[-0.03em] ${r.kind !== "player" ? "text-xl" : rows.length > 9 ? "text-2xl leading-none" : "text-[2.75rem] leading-none"}`}>
                  {r.label}
                  {multi && r.kind === "player" && <span className="ml-2 font-mono text-sm font-bold">{carOf(lobby, r.name)}</span>}
                </span>
                <CallWord call={call} className={`${big} font-bold`} />
                <span className={`nums ${big} font-bold`}>
                  {r.sub ? clockText(r.sub.seconds_to_call) : ""}
                </span>
                <span className={`${big} font-bold`}>
                  {r.kind === "player" && call ? (call === engineCallFor(r.name) ? COPY.host.agreed : COPY.host.against) : ""}
                </span>
                <span className={`nums ${big} font-bold`}>
                  {r.c ? `+${r.c}` : "0"}
                </span>
                <span className={`nums ${big} font-bold`}>
                  {r.r ? `+${r.r}` : "0"}
                </span>
                <span className="nums text-right text-base">
                  {pctR != null ? `${pctR}%` : ""}
                </span>
                <span className={`nums text-right font-bold tracking-[-0.03em] ${r.kind !== "player" ? "text-2xl" : rows.length > 9 ? "text-[1.75rem] leading-none" : "text-[3.25rem] leading-none"}`}>
                  {r.total}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="col-span-4 flex min-h-0 flex-col gap-4 border-t-2 border-ink pt-4">
        {sel && (
          <>
            <span className="meta">{sel.kind === "player" ? sel.name : sel.label}</span>
            <p className="nums text-xl font-bold">
              {COPY.score.equation(sel.c, sel.r, sel.total)} <span className="text-ink-2">{COPY.score.outOf(MAX_TOTAL)}</span>
            </p>
            {pct && (
              <div className="flex flex-col gap-1">
                <span className="text-base">{pct.pre}</span>
                <span className="nums text-[4rem] font-bold leading-none tracking-[-0.03em]">{pct.num}</span>
                <span className="text-base">{pct.post}</span>
                <p className="mt-1 text-sm text-ink-2">
                  {lb && COPY.score.percentileHelp(lb.total_players - 1)} {selRank > 0 && `${COPY.score.lobbyRank(selRank, lobbyPlayers.length)}.`}
                </p>
              </div>
            )}
            {sel.sub && (
              <>
                <BadgeList badges={badgesFor(sel.sub, carDecision(sel.name), teamTotal, engineTotal)} />
                {sel.sub.transcript && <q className="line-clamp-3 text-lg font-medium leading-snug">{sel.sub.transcript}</q>}
              </>
            )}
          </>
        )}
      </section>

      <footer className="col-span-12 flex items-center justify-between gap-6 border-t-2 border-ink pt-4">
        <p className="text-xl font-bold">{perFactor ? COPY.host.scoringRule(50) : ""}</p>
        <Button variant="primary" size="md" onClick={() => router.push("/")}>
          {COPY.score.newLobby}
        </Button>
      </footer>
    </main>
  );
}
