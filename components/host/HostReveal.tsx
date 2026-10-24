"use client";
// Reveal (four steps, right arrow skips) and the scoreboard for the host screen.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { COPY, factorLabel } from "@/lib/copy";
import { api, type CampsResponse, type LeaderboardResponse, type LobbyStateResponse } from "@/lib/client/api";
import {
  MAX_TOTAL,
  PLAYED_OUT_MS,
  badgesFor,
  fmtSeconds,
  frameAt,
  playedOutLap,
  splitCalls,
  tla,
} from "@/lib/client/race";
import type { Call, DecisionPoint, LapFrame, Submission } from "@/lib/types";
import { Tower } from "../Tower";
import { BadgeTags, Button, CallWord, Label } from "../ui";

const STEP_AT = [0, 7000, 13000, 13000 + PLAYED_OUT_MS + 800];

function useLeaderboard(decisionId: string, when: boolean) {
  const [lb, setLb] = useState<LeaderboardResponse | null>(null);
  useEffect(() => {
    if (!when) return;
    let alive = true;
    const load = () =>
      api
        .leaderboard(decisionId)
        .then((r) => alive && setLb(r))
        .catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [decisionId, when]);
  return lb;
}

export function HostReveal({
  code,
  decision,
  frames,
  lobby,
  elapsed,
  onNext,
}: {
  code: string;
  decision: DecisionPoint;
  frames: LapFrame[];
  lobby: LobbyStateResponse;
  elapsed: number;
  onNext: () => void;
}) {
  const [skip, setSkip] = useState(0);
  const at = elapsed + skip;
  const step = STEP_AT.filter((s) => at >= s).length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight") return;
      const next = STEP_AT.find((s) => s > at);
      if (next != null) setSkip((k) => k + (next - at));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at]);

  const lb = useLeaderboard(decision.id, step >= 1);
  const [camps, setCamps] = useState<CampsResponse | null>(null);
  useEffect(() => {
    if (step < 3) return;
    api.camps(code).then(setCamps).catch(() => {});
  }, [code, step, lobby.submissions.length]);

  const subs = lobby.submissions;
  const byName = new Map(subs.map((s) => [s.player_name, s]));
  const players = lobby.players.map((p) => ({ name: p.name, sub: byName.get(p.name) ?? null }));
  const { box, stay } = splitCalls(subs);

  const lap = step < 2 ? decision.lap : step === 2 ? playedOutLap(decision, at - STEP_AT[2]) : decision.reveal_to_lap;
  const frame = frameAt(frames, lap);
  const total = frames[frames.length - 1]?.lap ?? lap;

  // Cars that took the winning option at the call carry "{option} L{lap}" in their PIT cell.
  const pitTags = useMemo(() => {
    const m = new Map<number, string>();
    const correct = decision.ground_truth.correct;
    const tag = `${COPY.freeze.options[correct]} L${decision.lap}`;
    const window = frames.filter((f) => f.lap >= decision.lap && f.lap <= decision.lap + 1);
    const pitted = new Set(window.flatMap((f) => f.drivers.filter((d) => d.pitted_this_lap).map((d) => d.number)));
    const all = frameAt(frames, decision.lap)?.drivers ?? [];
    for (const d of all) if ((correct === "BOX") === pitted.has(d.number)) m.set(d.number, tag);
    return m;
  }, [decision, frames]);

  const team = decision.team;
  const engine = decision.engine;

  if (step === 3) return <Verdict decision={decision} lobby={lobby} lb={lb} camps={camps} onNext={onNext} />;

  const header = (
    <div className="flex items-end justify-between gap-6">
      <span className="text-24 font-semibold">{COPY.reveal.heading(decision.lap)}</span>
      <span className="nums shrink-0 whitespace-nowrap text-72 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.replay.lap(lap, total)}</span>
    </div>
  );

  // Step 1: the lobby's calls get the whole screen (docs/06 3.4: the biggest social moment). The tower returns at step 2.
  if (step === 0) {
    const cols = Math.min(players.length, 6) || 1;
    const quoteCls = cols > 4 ? "text-24" : "text-32";
    return (
      <main className="flex h-dvh flex-col gap-6 overflow-hidden p-12">
        <span className="text-24 font-semibold">{COPY.reveal.heading(decision.lap)}</span>
        <h2 className="nums text-40 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.reveal.split(box, stay)}</h2>
        <ol className="grid min-h-0 content-start gap-0.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {players.map((p, i) => (
            <li key={p.name} className="row-in flex min-h-0 flex-col gap-4 bg-surface p-6" style={{ animationDelay: `${i * 600}ms` }}>
              <span className="text-40 font-bold uppercase stretch-75 leading-hero">{tla(p.name)}</span>
              <CallWord call={p.sub?.call ?? null} className={`text-56 stretch-75! ${p.sub?.call ? "" : "text-ink-3"}`} />
              {p.sub?.transcript ? <q className={`line-clamp-6 ${quoteCls} leading-body text-ink`}>{p.sub.transcript}</q> : null}
            </li>
          ))}
        </ol>
      </main>
    );
  }

  return (
    <main className="grid h-dvh grid-cols-[minmax(420px,5fr)_7fr] gap-12 overflow-hidden p-12">
      <section className="min-h-0">
        {frame && <Tower drivers={frame.drivers} playerNumber={decision.player_role.number} dim={step < 2} pitTags={step >= 2 ? pitTags : undefined} />}
      </section>
      <section className="flex min-h-0 flex-col gap-6">
        {header}

        <div className="row-in flex flex-col gap-4 bg-surface p-6">
          <div className="flex flex-col gap-1">
            <span className="text-56 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.reveal.teamRow(decision.player_role.team, team.call)}</span>
            <span className="text-20 text-ink-2">{team.reasons[0] ?? COPY.empty.noRadio}</span>
          </div>
          <div className="row-in flex flex-col gap-1" style={{ animationDelay: "600ms" }}>
            <span className="nums text-56 font-extrabold uppercase stretch-125 tracking-hero leading-hero text-engine">
              {COPY.reveal.engineRow(engine.call, Math.round(engine.confidence * 100))}
            </span>
            {engine.reasons.length ? (
              <ol className="flex list-decimal flex-col gap-1 pl-6 text-20 text-ink-2">
                {engine.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ol>
            ) : (
              <span className="text-20 text-ink-2">{COPY.empty.noEngine}</span>
            )}
          </div>
        </div>
        <ol className="flex flex-wrap gap-0.5">
          {players.map((p) => (
            <li key={p.name} className="flex h-24 min-w-36 flex-col justify-center gap-1 bg-surface px-4">
              <span className="text-40 font-bold uppercase stretch-75 leading-hero">{tla(p.name)}</span>
              <CallWord call={p.sub?.call ?? null} className={`text-24 ${p.sub?.call ? "" : "text-ink-3"}`} />
            </li>
          ))}
        </ol>
        {step === 2 && <p className="text-24 text-ink-2">{COPY.reveal.outcome[decision.id] ?? ""}</p>}
      </section>
    </main>
  );
}

function FactorDots({ named, factors, onDeep = false }: { named: string[]; factors: string[]; onDeep?: boolean }) {
  return (
    <>
      {factors.map((f) => (
        <span key={f} className="text-center text-24" aria-label={`${factorLabel(f)}: ${named.includes(f) ? "yes" : "no"}`}>
          {named.includes(f) ? COPY.reveal.named : <span className={onDeep ? "text-ink" : "text-ink-3"}>{COPY.reveal.notNamed}</span>}
        </span>
      ))}
    </>
  );
}

function Verdict({
  decision,
  lobby,
  lb,
  camps,
  onNext,
}: {
  decision: DecisionPoint;
  lobby: LobbyStateResponse;
  lb: LeaderboardResponse | null;
  camps: CampsResponse | null;
  onNext: () => void;
}) {
  const correct = decision.ground_truth.correct;
  const subs = [...lobby.submissions].sort((a, b) => b.total - a.total || a.seconds_to_call - b.seconds_to_call);
  const factors = decision.factors;
  const rowH = subs.length > 5 ? "h-10" : "h-14";
  const cols = `minmax(120px,1.2fr) 248px repeat(${factors.length}, minmax(64px,0.8fr)) 56px 104px`;

  const best = subs.filter((s) => s.factors_named.length > 0);
  const bestK = best.length ? Math.max(...best.map((s) => s.factors_named.length)) : 0;
  const bestRows = best.filter((s) => s.factors_named.length === bestK).slice(0, 2);

  type Row = { key: string; label: React.ReactNode; call: Call | null; named: string[]; time: number | null; total: number; kind: "player" | "team" | "engine" };
  const rows: Row[] = [
    ...subs.map((s) => ({ key: s.player_name, label: tla(s.player_name), call: s.call, named: s.factors_named, time: s.seconds_to_call, total: s.total, kind: "player" as const })),
    ...(lb
      ? [
          { key: "team", label: decision.player_role.team, call: lb.team.call, named: lb.team.factors_named, time: null, total: lb.team.total, kind: "team" as const },
          { key: "engine", label: COPY.reveal.engine, call: lb.engine.call, named: lb.engine.factors_named, time: null, total: lb.engine.total, kind: "engine" as const },
        ]
      : []),
  ];

  return (
    <main className="flex h-dvh flex-col gap-4 overflow-hidden p-12">
      <div className="flex shrink-0 flex-col gap-4 bg-surface px-6 py-6">
        <h1 className={`whitespace-nowrap text-96 font-extrabold uppercase tracking-hero leading-hero ${correct === "STAY" ? "stretch-75" : "stretch-112"}`}>
          {COPY.reveal.verdict(correct)}
        </h1>
        <div className="flex items-center gap-6">
          <span className="nums shrink-0 whitespace-nowrap text-72 font-extrabold stretch-100 leading-hero text-flag-green">
            +{decision.ground_truth.swing_s.toFixed(1)} s
          </span>
          <p className="min-w-0 text-24 text-ink-2">
            {COPY.reveal.swing(correct, decision.ground_truth.swing_s, decision.reveal_to_lap)} {COPY.reveal.outcome[decision.id] ?? ""}
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-8">
        <section className="col-span-9 flex min-h-0 flex-col gap-4">
          <div role="table" className="flex flex-col gap-0.5">
            <div role="row" className="grid min-h-8 items-end gap-x-4 px-4 pb-1 text-14 font-semibold uppercase tracking-label text-ink-3" style={{ gridTemplateColumns: cols }}>
              <span role="columnheader">{COPY.reveal.who}</span>
              <span role="columnheader">{COPY.reveal.call}</span>
              {factors.map((f) => (
                <span role="columnheader" key={f} className="text-center normal-case tracking-normal leading-row">
                  {factorLabel(f)}
                </span>
              ))}
              <span role="columnheader" className="text-right">{COPY.reveal.speed}</span>
              <span role="columnheader" className="text-right">{COPY.reveal.score}</span>
            </div>
            {rows.map((r) => (
              <div
                role="row"
                key={r.key}
                className={`grid ${rowH} items-center gap-x-4 px-4 ${r.kind === "engine" ? "bg-engine-deep" : "bg-surface"}`}
                style={{ gridTemplateColumns: cols }}
              >
                <span role="cell" className="truncate text-24 font-bold uppercase stretch-75">
                  {r.label}
                </span>
                <span role="cell" className="flex items-baseline gap-3 whitespace-nowrap">
                  <CallWord call={r.call} className={`text-32 stretch-75! ${r.call === correct ? "text-ink" : "text-ink-2"}`} />
                  {r.call === correct && (
                    <span className={`text-32 font-extrabold uppercase stretch-75 leading-hero ${r.kind === "engine" ? "text-ink" : "text-flag-green"}`}>{COPY.reveal.right}</span>
                  )}
                </span>
                <FactorDots named={r.named} factors={factors} onDeep={r.kind === "engine"} />
                <span role="cell" className={`nums text-right text-20 ${r.kind === "engine" ? "text-ink" : "text-ink-2"}`}>
                  {r.time != null ? fmtSeconds(r.time) : ""}
                </span>
                <span role="cell" className="nums text-right text-24 font-semibold">
                  {r.total} <span className={`text-16 ${r.kind === "engine" ? "text-ink" : "text-ink-3"}`}>{COPY.score.outOf(MAX_TOTAL)}</span>
                </span>
              </div>
            ))}
          </div>
          {bestRows.map((s) => (
            <p key={s.player_name} className="line-clamp-2 text-24">
              <span className="font-semibold">{COPY.reveal.bestReason(tla(s.player_name), bestK, factors.length)}</span>{" "}
              <q className="text-ink">{s.transcript}</q>
            </p>
          ))}
        </section>

        <section className="col-span-3 flex min-h-0 flex-col gap-3 overflow-hidden">
          <Label>{COPY.reveal.camps}</Label>
          {camps && camps.camps.length > 0 ? (
            <ol className="flex flex-col gap-0.5">
              {camps.camps.slice(0, 4).map((c) => (
                <li key={c.factor} className="flex flex-col gap-1 bg-surface px-4 py-3">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="nums text-20 font-bold">{COPY.reveal.camp(c.count, camps.submitted, factorLabel(c.factor))}</span>
                    <span className="text-16 font-semibold uppercase stretch-75 text-ink-2">{c.players.map(tla).join(" ")}</span>
                  </span>
                  {c.quotes[0] && <q className="line-clamp-1 text-16 text-ink-2">{c.quotes[0]}</q>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-20 text-ink-3">{camps ? COPY.reveal.noFactor : COPY.reveal.grading}</p>
          )}
        </section>
      </div>

      <div className="flex shrink-0 items-end justify-between gap-6">
        <Button className="h-14 text-20" onClick={onNext}>
          {COPY.reveal.showScores}
        </Button>
        <p className="text-14 text-ink-3">{COPY.reveal.credit}</p>
      </div>
    </main>
  );
}

export function HostScoreboard({ code, decision, lobby }: { code: string; decision: DecisionPoint; lobby: LobbyStateResponse }) {
  const router = useRouter();
  const lb = useLeaderboard(decision.id, true);
  const [selected, setSelected] = useState<string | null>(null);

  const teamTotal = lb?.team.total ?? null;
  const engineTotal = lb?.engine.total ?? null;
  const pctOf = (name: string) => lb?.rows.find((r) => r.kind === "player" && r.name === name && r.lobby_code === code)?.percentile ?? null;

  type Row = { key: string; kind: "player" | "team" | "engine"; label: string; name: string; total: number; c: number; r: number; sub?: Submission };
  const unsorted: Row[] = [
    ...lobby.submissions.map((s) => ({ key: s.player_name, kind: "player" as const, label: tla(s.player_name), name: s.player_name, total: s.total, c: s.score_call, r: s.score_reasoning, sub: s })),
    ...(lb
      ? [
          { key: "team", kind: "team" as const, label: decision.player_role.team, name: COPY.leaderboard.teamRow(decision.player_role.team), total: lb.team.total, c: lb.team.score_call, r: lb.team.score_reasoning },
          { key: "engine", kind: "engine" as const, label: COPY.reveal.engine, name: COPY.leaderboard.engineRow, total: lb.engine.total, c: lb.engine.score_call, r: lb.engine.score_reasoning },
        ]
      : []),
  ];
  const rows = unsorted.sort(
    (a, b) =>
      b.total - a.total ||
      (a.kind === "player" ? 0 : 1) - (b.kind === "player" ? 0 : 1) ||
      (a.sub?.seconds_to_call ?? 0) - (b.sub?.seconds_to_call ?? 0),
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

  return (
    <main className="grid h-dvh grid-cols-12 gap-12 overflow-hidden p-12">
      <section className="col-span-7 flex min-h-0 flex-col gap-4">
        <p className="text-24 text-ink-2">{facts.join(" ")}</p>
        <ol className="flex flex-col gap-0.5">
          {rows.map((r, i) => {
            const p1 = i === 0;
            const on = sel?.key === r.key;
            const pct = r.kind === "player" ? pctOf(r.name) : null;
            const b = r.sub ? badgesFor(r.sub, decision, teamTotal, engineTotal) : null;
            return (
              <li key={r.key}>
                <button
                  onClick={() => setSelected(r.key)}
                  className={`grid w-full grid-cols-[32px_minmax(96px,auto)_56px_56px_1fr] items-center gap-x-4 px-4 text-left transition-colors duration-[120ms] ${p1 ? "h-14" : "h-9"} ${
                    on ? "bg-ink text-bg" : r.kind === "engine" ? "bg-engine-deep hover:bg-surface-2" : "bg-surface hover:bg-surface-2"
                  }`}
                  aria-pressed={on}
                >
                  <span className="nums text-right text-20 font-semibold">{i + 1}</span>
                  <span className={`truncate font-bold uppercase stretch-75 ${p1 ? "text-40 leading-hero" : "text-20"}`}>{r.label}</span>
                  <span className="nums text-right text-20 font-semibold">{r.total}</span>
                  <span className="nums text-right text-16">{pct != null ? `${pct}%` : ""}</span>
                  <span className="min-w-0">{b && <BadgeTags badges={b} size="sm" inverted={on} />}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <Button variant="secondary" className="mt-auto h-14 self-start text-20" onClick={() => router.push("/")}>
          {COPY.score.newLobby}
        </Button>
      </section>

      <section className="col-span-5 flex min-h-0 flex-col gap-8">
        {sel && (
          <>
            <h1 className="text-96 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{sel.label}</h1>
            <p className="nums text-40 font-semibold stretch-75">
              {COPY.score.equation(sel.c, sel.r, sel.total)} <span className="text-ink-3">{COPY.score.outOf(MAX_TOTAL)}</span>
            </p>
            {selPct != null && (
              <div className="flex flex-col gap-2">
                <p className="flex items-baseline gap-4">
                  <span className="text-24">{COPY.score.percentile(selPct).pre}</span>
                  <span className="nums text-72 font-extrabold stretch-125 leading-hero">{COPY.score.percentile(selPct).num}</span>
                  <span className="text-24">{COPY.score.percentile(selPct).post}</span>
                </p>
                <p className="text-20 text-ink-2">
                  {lb && COPY.score.percentileHelp(lb.total_players - 1)} {selRank > 0 && COPY.score.lobbyRank(selRank, lobbyPlayers.length)}.
                </p>
              </div>
            )}
            {sel.sub && (
              <>
                <BadgeTags badges={badgesFor(sel.sub, decision, teamTotal, engineTotal)} />
                {sel.sub.transcript && <q className="line-clamp-3 text-24 text-ink">{sel.sub.transcript}</q>}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
