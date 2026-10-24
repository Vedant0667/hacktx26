"use client";
// `/host/[code]`: the laptop shared screen. Driven by lobby phase; the host clicks advance it.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COPY } from "@/lib/copy";
import { data, type BlindDecision } from "@/lib/client/api";
import { noopSubscribe, recallHostToken, rememberHost } from "@/lib/client/identity";
import { CALL_WINDOW_S, callMomentFrames, frameAt, raceControl, replayDoneMs, replayLap, tla } from "@/lib/client/race";
import { useLobby, useReveal, useTicker } from "@/lib/client/useLobby";
import { playFreezeTone } from "@/lib/client/cue";
import { useDataMode, type DataMode } from "@/lib/client/mode";
import { GapLine, RejoinCaveat, StoryFacts, TradeOff, getBrief } from "../DecisionBrief";
import type { LapFrame } from "@/lib/types";
import { QrCode } from "../QrCode";
import { Tower } from "../Tower";
import { Button, ConnNotice, Label, ModeToggle, StatusStrip } from "../ui";
import { HostReveal, HostScoreboard } from "./HostReveal";

export function HostScreen({ code }: { code: string }) {
  const { lobby, conn, serverNow, setPhase, phaseErr } = useLobby(code);
  // Blind decision and frames until the reveal; the full set arrives from the reveal route.
  const [decision, setDecision] = useState<BlindDecision | null>(null);
  const [frames, setFrames] = useState<LapFrame[] | null>(null);
  const [dataErr, setDataErr] = useState(false);
  const reveal = useReveal(code, lobby?.phase);
  const hostToken = useSyncExternalStore(noopSubscribe, () => recallHostToken(code), () => null);
  const [mode, setMode] = useDataMode(code, "host");
  const t = useTicker(serverNow, 100);
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");

  useEffect(() => {
    rememberHost(code);
  }, [code]);

  const decisionId = lobby?.decision_id;
  useEffect(() => {
    if (!decisionId) return;
    Promise.all([data.decision(decisionId), data.frames(decisionId)])
      .then(([d, f]) => {
        setDecision(d);
        setFrames(f);
      })
      .catch(() => setDataErr(true));
  }, [decisionId]);

  const phase = lobby?.phase;
  const [muted, setMuted] = useState(false);
  const cued = useRef("");
  useEffect(() => {
    if (!lobby || lobby.phase !== "decision") return;
    const k = `${lobby.phase_started_at}`;
    if (cued.current === k) return;
    cued.current = k;
    if (!muted) playFreezeTone();
  }, [lobby, muted]);
  const elapsed = lobby ? t - lobby.phase_started_at : 0;

  // Auto-advance: replay freezes on the decision lap; the call window closes after CALL_WINDOW_S, 40 s (or when everyone is in).
  const advanced = useRef<string>("");
  useEffect(() => {
    if (!lobby || !decision) return;
    const key = `${lobby.phase}:${lobby.phase_started_at}`;
    if (advanced.current === key) return;
    if (lobby.phase === "replay" && elapsed >= replayDoneMs(decision)) {
      advanced.current = key;
      void setPhase("decision");
    } else if (lobby.phase === "decision") {
      const allIn = lobby.players.length > 0 && lobby.submissions.length >= lobby.players.length;
      if (elapsed >= (CALL_WINDOW_S + 1.5) * 1000 || (allIn && elapsed > 1500)) {
        advanced.current = key;
        void setPhase("reveal");
      }
    }
  }, [lobby, decision, elapsed, setPhase]);

  if (dataErr) return <Centered text={COPY.error.data} />;
  if (!lobby || !decision || !frames) return <><ConnNotice conn={conn} code={code} /><Centered text="" /></>;

  const joinUrl = origin ? `${origin.replace(/^https?:\/\//, "")}/play/${code}` : "";
  const joinHref = origin ? `${origin}/play/${code}` : "";

  return (
    <>
      <ConnNotice conn={conn} code={code} />
      {(!hostToken || phaseErr === "forbidden") && (
        <p role="alert" className="fixed inset-x-0 bottom-0 z-40 bg-flag-red px-4 py-2 text-center text-20 font-semibold text-bg">
          {COPY.error.notHost(code)}
        </p>
      )}
      {phase === "waiting" && (
        <Waiting code={code} joinUrl={joinUrl} joinHref={joinHref} decision={decision} players={lobby.players} onStart={() => setPhase("replay")} modeToggle={<ModeToggle mode={mode} onChange={setMode} />} />
      )}
      {(phase === "replay" || phase === "decision") && (
        <RaceView
          code={code}
          decision={decision}
          frames={frames}
          lap={phase === "replay" ? replayLap(decision, elapsed) : decision.lap}
          frozen={phase === "decision"}
          elapsed={elapsed}
          players={lobby.players}
          submitted={new Set(lobby.submissions.map((s) => s.player_name))}
          onAdvance={() => setPhase(phase === "replay" ? "decision" : "reveal")}
          mode={mode}
          modeToggle={<span className="flex items-center gap-4"><ModeToggle mode={mode} onChange={setMode} size="sm" /><Button variant="secondary" className="h-9 px-3 text-14" aria-pressed={muted} onClick={() => setMuted((m) => !m)}>{muted ? COPY.cue.unmute : COPY.cue.mute}</Button></span>}
        />
      )}
      {(phase === "reveal" || phase === "done") && !reveal && <Centered text="" />}
      {phase === "reveal" && reveal && (
        <HostReveal
          code={code}
          decision={reveal.decision}
          frames={reveal.frames}
          lobby={lobby}
          elapsed={elapsed}
          onNext={() => setPhase("done")}
          mode={mode}
          modeToggle={<ModeToggle mode={mode} onChange={setMode} size="sm" />}
          gt={reveal.ground_truth}
        />
      )}
      {phase === "done" && reveal && <HostScoreboard code={code} decision={reveal.decision} lobby={lobby} />}
    </>
  );
}

function Centered({ text }: { text: string }) {
  return <main className="grid min-h-dvh place-items-center p-12 text-24 text-ink-2">{text}</main>;
}

function Waiting({
  code,
  joinUrl,
  joinHref,
  decision,
  players,
  onStart,
  modeToggle,
}: {
  code: string;
  joinUrl: string;
  joinHref: string;
  decision: BlindDecision;
  players: { name: string; joined_at: number }[];
  onStart: () => void;
  modeToggle: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const r = decision.player_role;
  return (
    <main className="grid h-dvh grid-cols-12 gap-12 overflow-hidden p-12">
      <section className="col-span-7 flex min-h-0 flex-col gap-8">
        <div className="flex items-start gap-8">
          {joinHref ? <QrCode value={joinHref} size={264} label={COPY.room.scanAlt(joinUrl)} /> : <div className="size-[264px] bg-surface" />}
          <div className="flex flex-col gap-4">
            <Label>{COPY.home.joinLabel}</Label>
            <h1 className="nums text-96 font-extrabold uppercase stretch-125 leading-hero tracking-code" aria-label={COPY.room.heading(code)}>
              {code}
            </h1>
          </div>
        </div>
        <p className="text-40 font-semibold leading-row stretch-75">{COPY.room.share(joinUrl)}</p>
        <p className="text-24 text-ink-2">{COPY.waiting.race(decision.race, r.team, r.driver, r.number)}</p>
        <div className="mt-auto flex items-center gap-8">
        <Button
          className="h-14 text-24"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await onStart();
            setBusy(false);
          }}
        >
          {COPY.waiting.hostButton}
        </Button>
        {modeToggle}
        </div>
      </section>

      <section className="col-span-5 flex min-h-0 flex-col gap-4">
        <h2 className="nums text-40 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.waiting.count(players.length)}</h2>
        {/* The lobby is a starting grid: each phone takes the next slot, staggered two by two. */}
        <ol className="grid min-h-0 grid-cols-2 gap-x-6 overflow-hidden pb-16 pt-2">
          {Array.from({ length: Math.min(10, Math.max(6, players.length + (players.length % 2 ? 1 : 2))) }, (_, i) => {
            const p = players[i];
            return (
              <li key={p?.name ?? `open-${i}`} className={`h-[104px] ${i % 2 ? "translate-y-[52px]" : ""}`}>
                <div className={`flex h-[88px] flex-col justify-between border-x-2 border-t-2 px-4 pt-2 ${p ? "grid-in border-ink" : "border-rule"}`}>
                  <span className={`nums text-16 font-semibold uppercase tracking-label ${p ? "text-ink-2" : "text-ink-3"}`}>{COPY.play.gridSlot(i + 1)}</span>
                  {p ? (
                    <span className="flex items-baseline gap-3 pb-2">
                      <span className="text-56 font-extrabold uppercase stretch-75 leading-hero">{tla(p.name)}</span>
                      <span className="truncate text-20 text-ink-2">{p.name}</span>
                    </span>
                  ) : (
                    <span className="pb-3 text-20 text-ink-3">{COPY.play.open}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {players.length <= 1 && <p className="text-24 text-ink-2">{COPY.waiting.alone(code)}</p>}
      </section>
    </main>
  );
}

function RaceView({
  code,
  decision,
  frames,
  lap,
  frozen,
  elapsed,
  players,
  submitted,
  onAdvance,
  mode,
  modeToggle,
}: {
  code: string;
  decision: BlindDecision;
  frames: LapFrame[];
  lap: number;
  frozen: boolean;
  elapsed: number;
  players: { name: string }[];
  submitted: Set<string>;
  onAdvance: () => void;
  mode: DataMode;
  modeToggle: React.ReactNode;
}) {
  const seen = callMomentFrames(frames, decision);
  const frame = frameAt(seen, lap);
  const total = decision.total_laps;
  const msgs = raceControl(seen, lap, decision.replay_from_lap).slice(0, 8);
  const brief = getBrief(decision, frames);
  const left = Math.max(0, Math.ceil(CALL_WINDOW_S - elapsed / 1000));
  const r = decision.player_role;

  return (
    <main className="grid h-dvh grid-cols-[minmax(420px,5fr)_7fr] gap-12 overflow-hidden p-12">
      <section className="min-h-0">
        {frame && <Tower drivers={frame.drivers} playerNumber={r.number} dim={frozen} mode={mode} />}
      </section>
      <section className={`flex min-h-0 flex-col ${frozen ? "gap-3" : "gap-6"}`}>
        <div className="flex items-end justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-24 font-semibold">{decision.race}</span>
            <span className="truncate whitespace-nowrap text-20 text-ink-2">
              {r.team}, {r.driver} #{r.number} · {COPY.room.heading(code)}
            </span>
          </div>
          <span className="nums shrink-0 whitespace-nowrap text-72 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.replay.lap(lap, total)}</span>
        </div>

        {!frozen ? (
          <>
            {frame && <StatusStrip status={frame.track_status} />}
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <Label>{COPY.replay.messages}</Label>
              <ol className="flex flex-col gap-1">
                {msgs.map((m, i) => (
                  <li key={`${m.lap}-${m.kind}-${m.code ?? m.status}-${i}`} className="flex gap-6 text-20 font-semibold uppercase stretch-75 leading-row">
                    <span className="nums w-24 text-ink-3">{COPY.replay.lap(m.lap, total).split("/")[0]}</span>
                    <span className={m.kind === "status" ? (m.status === "GREEN" ? "text-flag-green" : "text-flag-yellow") : "text-ink"}>
                      {m.kind === "status" ? COPY.replay.msgStatus[m.status!] : COPY.replay.msgPit(m.code!)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex items-center gap-8">
              <Button variant="secondary" className="h-14 text-20" onClick={onAdvance}>
                {COPY.replay.skip}
              </Button>
              {modeToggle}
            </div>
          </>
        ) : (
          <>
            {/* At 5 s and below the banner turns red; numerals stay bg (4.7:1), docs/06 flag-red rule. */}
            <div
              className={`wipe-in relative z-20 flex h-[120px] shrink-0 items-center gap-6 px-6 text-bg transition-colors duration-200 ${left <= 5 ? "bg-flag-red" : "on-yellow bg-flag-yellow"}`}
            >
              <span
                className={`min-w-0 flex-1 whitespace-nowrap font-extrabold uppercase tracking-hero leading-hero ${decision.trigger === "VSC" ? "text-40 stretch-62" : "text-56 stretch-75"}`}
              >
                {COPY.freeze.bannerShort(decision.trigger, decision.lap)}
              </span>
              <span className="nums w-[168px] shrink-0 text-right text-96 font-extrabold stretch-125 leading-hero" aria-live="polite">
                {left}
              </span>
              <span
                className="countdown-bar absolute inset-x-0 bottom-0 h-2 bg-bg"
                style={{ animationDuration: `${CALL_WINDOW_S}s`, animationDelay: `-${elapsed / 1000}s` }}
              />
            </div>
            <h2 className="text-56 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.freeze.question}</h2>
            {brief.frame && (
              <div className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-4 text-14 font-semibold uppercase tracking-label text-ink-3">
                  <span>{COPY.rejoin.title}</span>
                  <span className="normal-case tracking-normal">{COPY.rejoin.assumption}</span>
                </span>
                <GapLine frame={brief.frame} playerNumber={r.number} rejoin={brief.rejoin} />
                {brief.rejoin && <RejoinCaveat frame={brief.frame} lap={decision.lap} className="text-16" />}
              </div>
            )}
            <TradeOff brief={brief} mode={mode} />
            <StoryFacts decision={decision} brief={brief} mode={mode} />
            <div className="mt-auto flex items-end justify-between gap-6">
              <div className="flex min-w-0 flex-col gap-2">
                <p className="nums text-20 font-semibold">{left === 0 ? COPY.freeze.timeUp : COPY.freeze.waitingOn(Math.max(0, players.length - submitted.size))}</p>
                <LobbyStrip players={players} submitted={submitted} />
              </div>
              <div className="flex shrink-0 flex-col items-end gap-3">
                {modeToggle}
                <Button variant="secondary" className="h-14 text-20" onClick={onAdvance}>
                  {COPY.freeze.showCalls}
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function LobbyStrip({ players, submitted }: { players: { name: string }[]; submitted: Set<string> }) {
  return (
    <ol className="flex flex-wrap gap-0.5">
      {players.map((p) => {
        const inn = submitted.has(p.name);
        return (
          <li key={p.name} className={`flex h-20 min-w-28 flex-col justify-center gap-1 px-4 transition-colors duration-200 ${inn ? "bg-ink text-bg" : "bg-surface"}`}>
            <span className="text-40 font-bold uppercase stretch-75 leading-hero">{tla(p.name)}</span>
            <span
              className={`self-start px-1 text-20 font-semibold uppercase tracking-label ${inn ? "bg-flag-green text-bg" : "text-ink-3"}`}
            >
              {inn ? COPY.freeze.called : COPY.freeze.notCalled}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

