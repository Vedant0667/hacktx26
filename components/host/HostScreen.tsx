"use client";
// `/host/[code]`: the laptop shared screen, driven by lobby phase. Lobby on black, replay on white; at the
// freeze the screen floods with the player's team colour. Before the reveal it renders from the blind decision
// and frames only, with no race, team or driver name (decision.blind_title and driver codes instead).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COPY } from "@/lib/copy";
import { data, type BlindDecision, type DriversResponse, type LobbyStateResponse } from "@/lib/client/api";
import { asDriver } from "@/lib/client/drivers";
import { noopSubscribe, recallHostToken, rememberHost } from "@/lib/client/identity";
import { kickPlayer } from "@/lib/client/session";
import { CALL_WINDOW_S, callMomentFrames, frameAt, replayDoneMs, replayLap } from "@/lib/client/race";
import { lapTimeText, telemetry, type Telemetry } from "@/lib/client/telemetry";
import { useLobby, useTicker } from "@/lib/client/useLobby";
import { playFreezeTone } from "@/lib/client/cue";
import { useDataMode, type DataMode } from "@/lib/client/mode";
import { fieldStyle, isDarkField, teamColourOf } from "@/lib/client/field";
import type { LapFrame } from "@/lib/types";
import { RejoinCaveat, getBrief, type Brief } from "../DecisionBrief";
import { FieldTyres, IntervalChart, LapChart, NeighbourList, Note, PitLoss, RejoinStrip, Sec, StintTable, UndercutClock, intervalNote, simpleChartLabel } from "../Telemetry";
import { Tower } from "../Tower";
import { Brand, Button, ConnNotice, ModeToggle, ScChip, TrackStrip, TyreChip, clockText } from "../ui";
import { LineChart } from "./HostCharts";
import { HostQr } from "./HostQr";
import { HostReveal } from "./HostReveal";
import { carOf, carsInPlay, driverBy, lobbyCarCode } from "./cars";
import { RaceHost } from "../race/RaceHost";

const MAX_PLAYERS = 12;

export function HostScreen({ code }: { code: string }) {
  const { lobby, conn, serverNow, setPhase, phaseErr, refresh } = useLobby(code);
  // Blind decision and frames until the reveal; the full set arrives from the reveal route.
  const [decision, setDecision] = useState<BlindDecision | null>(null);
  const [frames, setFrames] = useState<LapFrame[] | null>(null);
  const [dataErr, setDataErr] = useState(false);
  // Round 4: the scorable cars, so the screen can follow the lobby's car and label each player's car.
  const [drivers, setDrivers] = useState<DriversResponse | null>(null);
  // Race lobbies (Round 6) reveal through /race/reveal; the moment reveal route answers 409 for them.
  const isRace = lobby?.mode === "race";
  const hostToken = useSyncExternalStore(noopSubscribe, () => recallHostToken(code), () => null);
  const [mode, setMode] = useDataMode(code, "host");
  const t = useTicker(serverNow, 100);
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");

  useEffect(() => {
    rememberHost(code);
  }, [code]);

  const decisionId = lobby?.decision_id;
  useEffect(() => {
    if (!decisionId || decisionId.startsWith("race:")) return;
    Promise.all([data.decision(decisionId), data.frames(decisionId)])
      .then(([d, f]) => {
        setDecision(d);
        setFrames(f);
      })
      .catch(() => setDataErr(true));
    data
      .drivers(decisionId)
      .then(setDrivers)
      .catch(() => setDrivers(null));
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

  // Auto-advance: replay freezes on the decision lap; the call window closes after CALL_WINDOW_S (or when everyone is in).
  const advanced = useRef<string>("");
  useEffect(() => {
    if (!lobby || !decision) return;
    const key = `${lobby.phase}:${lobby.phase_started_at}`;
    if (advanced.current === key) return;
    if (lobby.phase === "replay" && elapsed >= replayDoneMs(decision)) {
      advanced.current = key;
      void setPhase("decision").then((e) => retryLater(advanced, key, e));
    } else if (lobby.phase === "decision") {
      const allIn = lobby.players.length > 0 && lobby.submissions.length >= lobby.players.length;
      if (elapsed >= (CALL_WINDOW_S + 1.5) * 1000 || (allIn && elapsed > 1500)) {
        advanced.current = key;
        void setPhase("reveal").then((e) => retryLater(advanced, key, e));
      }
    }
  }, [lobby, decision, elapsed, setPhase]);

  if (isRace && lobby)
    return <RaceHost code={code} lobby={lobby} conn={conn} serverNow={serverNow} setPhase={setPhase} refresh={refresh} hostToken={hostToken} phaseErr={phaseErr} />;
  if (dataErr) return <Centered text={COPY.error.data} />;
  if (!lobby || !decision || !frames)
    return (
      <>
        <ConnNotice conn={conn} code={code} />
        <Centered text="" />
      </>
    );

  const joinUrl = origin ? `${origin.replace(/^https?:\/\//, "")}/play/${code}` : "";
  const joinHref = origin ? `${origin}/play/${code}` : "";
  // Every pre-reveal view follows the lobby's car (blind decision re-pointed at it).
  const carCode = lobbyCarCode(lobby, drivers);
  const car = asDriver(decision, driverBy(drivers, carCode));
  const team = teamColourOf(frames, car.player_role.number);
  const colourOf = (code: string | null) => driverBy(drivers, code)?.team_colour ?? null;
  const muteBtn = (variant: "secondary" | "inverse") => (
    <Button variant={variant} size="sm" aria-pressed={muted} onClick={() => setMuted((m) => !m)}>
      {muted ? COPY.cue.unmute : COPY.cue.mute}
    </Button>
  );

  return (
    <div style={fieldStyle(team)}>
      <ConnNotice conn={conn} code={code} />
      {(!hostToken || phaseErr === "forbidden") && (
        <p role="alert" className="fixed inset-x-0 bottom-0 z-[var(--z-toast)] bg-white px-4 py-3 text-center text-base font-bold text-ink shadow-[0_-2px_0_var(--color-ink)]">
          {COPY.error.notHost(code)}
        </p>
      )}
      {phase === "waiting" && (
        <Lobby
          code={code}
          joinUrl={joinUrl}
          joinHref={joinHref}
          decision={car}
          frames={frames}
          lobby={lobby}
          colourOf={colourOf}
          players={lobby.players}
          onStart={() => setPhase("replay")}
          onKick={async (name) => {
            try {
              await kickPlayer(code, name);
            } finally {
              await refresh();
            }
          }}
          mode={mode}
          setMode={setMode}
        />
      )}
      {phase === "replay" && (
        <Replay
          code={code}
          decision={car}
          frames={frames}
          lap={replayLap(decision, elapsed)}
          onAdvance={() => setPhase("decision")}
          mode={mode}
          controls={
            <>
              <ModeToggle mode={mode} onChange={setMode} size="sm" />
              {muteBtn("secondary")}
            </>
          }
        />
      )}
      {phase === "decision" && (
        <Freeze
          code={code}
          decision={car}
          lobby={lobby}
          frames={frames}
          team={team}
          elapsed={elapsed}
          players={lobby.players}
          submitted={new Set(lobby.submissions.map((s) => s.player_name))}
          onAdvance={() => setPhase("reveal")}
          mode={mode}
          setMode={setMode}
          mute={muteBtn("inverse")}
        />
      )}
      {/* Round 7: one end screen for reveal and done (no steps, no duel, no camps). */}
      {(phase === "reveal" || phase === "done") && <HostReveal code={code} carCode={carCode} lobby={lobby} elapsed={elapsed} />}
    </div>
  );
}

// A phase change that failed (network, 5xx, a 409 with no wait) must not freeze the screen until a reload:
// clear the latch after a pause so the auto-advance effect tries again. Shared with race mode.
export function retryLater(latch: { current: string }, key: string, err: string | null) {
  if (!err) return;
  setTimeout(() => {
    if (latch.current === key) latch.current = "";
  }, 2000);
}

export function Centered({ text }: { text: string }) {
  return <main className="grid min-h-dvh place-items-center p-14 text-lg font-bold text-ink-2">{text}</main>;
}

export function Top({ left, right, className = "" }: { left: React.ReactNode; right: React.ReactNode; className?: string }) {
  return (
    <header className={`flex items-center justify-between gap-6 font-mono text-lg font-bold uppercase ${className}`}>
      <span className="flex items-center gap-3">{left}</span>
      <span className="flex items-center gap-3">{right}</span>
    </header>
  );
}

const myCode = (frames: LapFrame[], n: number) => frames[frames.length - 1]?.drivers.find((d) => d.number === n)?.code ?? "";

function Lobby({
  code,
  joinUrl,
  joinHref,
  decision,
  frames,
  lobby,
  colourOf,
  players,
  onStart,
  onKick,
  mode,
  setMode,
}: {
  code: string;
  joinUrl: string;
  joinHref: string;
  decision: BlindDecision;
  frames: LapFrame[];
  lobby: LobbyStateResponse;
  colourOf: (code: string | null) => string | null;
  players: { name: string; joined_at: number }[];
  onStart: () => void;
  onKick: (name: string) => Promise<void>;
  mode: DataMode;
  setMode: (m: DataMode) => void;
}) {
  const [busy, setBusy] = useState(false);
  const r = decision.player_role;
  return (
    <main className="on-dark grid h-dvh grid-rows-[auto_1fr_auto] overflow-hidden bg-ink px-14 py-10 text-white">
      <Top
        left={
          <>
            <Brand kind="wordmark" height={22} />
            <span aria-hidden>·</span>
            {COPY.host.room(code)}
          </>
        }
        right={COPY.host.playersCount(players.length, MAX_PLAYERS)}
      />

      <div className="grid min-h-0 grid-cols-12 items-center gap-x-6">
        <section className="col-span-6 flex flex-col">
          <span className="meta">{COPY.host.roomCode}</span>
          <h1 className="nums mt-3 text-[9.375rem] font-bold leading-none tracking-[-0.03em]" aria-label={COPY.room.heading(code)}>
            {code}
          </h1>
          <p className="mt-4 max-w-[30ch] text-[1.625rem] font-medium leading-snug text-[#cfcfcf]">
            {COPY.host.scanOr(joinUrl.split("/")[0])} <b className="font-bold text-white">/play/{code}</b>.
          </p>
          <div className="mt-8 flex items-end gap-6">
            {joinHref ? <HostQr value={joinHref} size={200} label={COPY.room.scanAlt(joinUrl)} /> : <div className="size-[200px] bg-[#222]" />}
            <div className="flex flex-col items-start gap-4">
              <Brand kind="mark" height={120} label={false} />
              <p className="font-mono text-[15px] leading-relaxed text-[#bdbdbd]">{joinUrl}</p>
            </div>
          </div>
        </section>

        <section className="col-span-6 flex min-h-0 flex-col">
          <span className="meta mb-2">{COPY.host.players}</span>
          <PlayerSlots players={players} carFor={(name) => carOf(lobby, name)} colourOf={colourOf} onKick={onKick} />
          <div className="mt-7 flex items-center justify-between gap-6 bg-field px-7 py-5 text-on-field">
            <b className="text-[2.125rem] font-black leading-none tracking-[-0.02em]">{COPY.host.carBand(myCode(frames, r.number), r.number)}</b>
            <span className="meta text-[15px]">{COPY.host.yourCar}</span>
          </div>
          <p className="mt-4 text-xl font-bold">{decision.blind_title}</p>
          {lobby.driver_mode === "choose" && carsInPlay(lobby).length > 0 && <p className="mt-2 font-mono text-sm text-[#bdbdbd]">{carLine(lobby)}</p>}
        </section>
      </div>

      <footer className="flex items-center justify-between gap-6 border-t-2 border-white pt-[18px]">
        <span className="flex items-center gap-6">
          <span className="font-mono text-[15px] text-[#bdbdbd]">{COPY.host.replayNote(decision.replay_from_lap, decision.lap)}</span>
          <DarkModeToggle mode={mode} onChange={setMode} />
        </span>
        <Button
          variant="inverse"
          size="md"
          busy={busy}
          className="text-[1.375rem]! font-black"
          onClick={async () => {
            setBusy(true);
            await onStart();
            setBusy(false);
          }}
        >
          {COPY.waiting.hostButton}
        </Button>
      </footer>
    </main>
  );
}

// The 12 lobby slots on the black lobby screen: code, car tag and a two-tap remove control per player.
// Shared with the race lobby.
export function PlayerSlots({
  players,
  carFor,
  colourOf,
  onKick,
}: {
  players: { name: string }[];
  carFor: (name: string) => string | null;
  colourOf: (code: string | null) => string | null;
  onKick: (name: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(null), 3000);
    return () => clearTimeout(id);
  }, [confirm]);
  return (
      <ol className="grid grid-cols-3 border-t-2 border-white">
            {Array.from({ length: MAX_PLAYERS }, (_, i) => {
              const p = players[i];
              return (
                <li key={p?.name ?? `open-${i}`} className={`flex h-[78px] items-center gap-3 border-b border-[#444] px-3 ${i % 3 !== 2 ? "border-r" : ""} ${p ? "rise" : ""}`}>
                  <span className="nums text-[15px] text-[#8c8c8c]">{String(i + 1).padStart(2, "0")}</span>
                  {p ? (
                    <span className="flex min-w-0 flex-1 flex-col items-start">
                      <span className="flex w-full min-w-0 items-center gap-2.5">
                        <span className="truncate text-[1.75rem] font-black leading-none tracking-[-0.02em]">{p.name}</span>
                        <CarTag code={carFor(p.name)} colour={colourOf(carFor(p.name))} />
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirm !== p.name) return setConfirm(p.name);
                          setConfirm(null);
                          await onKick(p.name);
                        }}
                        aria-label={confirm === p.name ? COPY.host.confirmRemove : COPY.host.remove(p.name)}
                        className={`mt-1.5 font-mono text-sm font-bold uppercase leading-none ${confirm === p.name ? "bg-white px-1 py-0.5 text-ink" : "text-[#9a9a9a] underline underline-offset-2 hover:text-white"}`}
                      >
                        {confirm === p.name ? COPY.host.confirmShort : COPY.host.removeShort}
                      </button>
                    </span>
                  ) : (
                    <span className="text-[2rem] font-bold leading-none tracking-[-0.02em] text-[#8c8c8c]">{COPY.play.open.toLowerCase()}</span>
                  )}
                </li>
              );
            })}
          </ol>
  );
}

// A player's car: its code with a small team swatch (a colour, never a logo).
export function CarTag({ code, colour }: { code: string | null; colour: string | null }) {
  if (!code) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-base font-bold leading-none">
      <span aria-hidden className="h-4 w-1" style={{ backgroundColor: colour ?? "currentColor" }} />
      {code}
    </span>
  );
}

// "PIA: PRI, MAR · HAM: JOR"
function carLine(lobby: LobbyStateResponse) {
  return carsInPlay(lobby)
    .map((c) => COPY.host.drives(c, lobby.players.filter((p) => carOf(lobby, p.name) === c).map((p) => p.name)))
    .join(" · ");
}

// The Simple / Advanced control on the black lobby: white border, the active segment white.
export function DarkModeToggle({ mode, onChange }: { mode: DataMode; onChange: (m: DataMode) => void }) {
  return (
    <div role="group" aria-label={COPY.mode.label} className="inline-flex shrink-0 border-2 border-white">
      {(["simple", "advanced"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={`meta h-8 px-2.5 transition-colors duration-150 ${mode === m ? "bg-white text-ink" : "text-white hover:bg-[#262626]"}`}
        >
          {COPY.mode[m]}
        </button>
      ))}
    </div>
  );
}

function Replay({
  code,
  decision,
  frames,
  lap,
  onAdvance,
  mode,
  controls,
}: {
  code: string;
  decision: BlindDecision;
  frames: LapFrame[];
  lap: number;
  onAdvance: () => void;
  mode: DataMode;
  controls: React.ReactNode;
}) {
  const seen = callMomentFrames(frames, decision);
  const frame = frameAt(seen, lap);
  const total = decision.total_laps;
  const r = decision.player_role;
  // Telemetry as of the current replay lap: laps before it are complete.
  const tele: Telemetry | null = telemetry(
    seen.filter((f) => f.lap <= lap),
    { ...decision, lap },
    60,
  );
  const me = frame?.drivers.find((d) => d.number === r.number);
  const span = Math.max(1, decision.lap - decision.replay_from_lap);
  const progress = Math.min(1, (lap - decision.replay_from_lap) / span);
  const lapsToCall = decision.lap - lap;
  const xLabels = tele ? tele.laps.map((l) => `L${l}`) : [];
  const watch = tele?.gapBehind ?? tele?.gapAhead ?? null;
  const watchSide = tele?.gapBehind ? "behind" : "ahead";

  return (
    <main className="grid h-dvh grid-cols-[322px_1fr] grid-rows-[auto_auto_1fr] gap-x-6 gap-y-4 overflow-hidden px-14 pb-8 pt-0">
      <div className="col-span-2 -mx-14 min-h-6">{frame && <TrackStrip status={frame.track_status} size="host" />}</div>
      <Top
        className="col-span-2"
        left={
          <>
            {COPY.host.replayTag}
            {frame && <ScChip status={frame.track_status} />}
          </>
        }
        right={
          <>
            <span className="flex items-center gap-3 font-sans normal-case">
              {controls}
              <Button variant="secondary" size="sm" onClick={onAdvance}>
                {COPY.replay.skip}
              </Button>
            </span>
            <span className="ml-4">{COPY.host.room(code)}</span>
          </>
        }
      />
      <section className="min-h-0 overflow-hidden border-t-2 border-ink [&_li[aria-current]]:border-field [&_li[aria-current]]:bg-field [&_li[aria-current]]:text-on-field">
        {frame && <Tower drivers={frame.drivers} playerNumber={r.number} mode={mode} showPit={false} />}
      </section>
      <section className="flex min-h-0 flex-col border-t-2 border-ink">
        <div className="flex items-end justify-between gap-6 pt-3">
          <span className="font-black leading-[0.85] tracking-[-0.04em]">
            <span className="text-[8.5rem]">L{lap}</span>
            <span className="text-[3rem] text-ink-3">/{total}</span>
          </span>
          <p className="max-w-[26ch] pb-2 text-right text-[1.625rem] font-medium leading-snug">
            {me && <b className="font-black">{COPY.host.youAre(me.code, me.position)}</b>} {COPY.host.callIn(lapsToCall)}
          </p>
        </div>
        <div className="relative mt-5 h-2 bg-soft-2" aria-hidden>
          <div className="h-full bg-ink transition-[width] duration-700 ease-out" style={{ width: `${progress * 100}%` }} />
          <span className="absolute -top-1 right-0 h-4 w-[3px] bg-ink" />
        </div>
        <span className="meta mt-2 self-end">{COPY.host.callAt(decision.lap)}</span>

        <div className="mt-3 grid min-h-0 flex-1 grid-cols-[1fr_314px] gap-12">
          <div className="min-w-0">
            <span className="meta">{COPY.host.lapTimeTitle}</span>
            {tele && (
              <div className="mt-2">
                <LineChart
                  invert
                  width={600}
                  height={300}
                  xLabels={xLabels}
                  lines={[
                    { label: tele.me.code, values: tele.me.times, tier: 0 },
                    ...(tele.ahead ? [{ label: tele.ahead.code, values: tele.ahead.times, tier: 1 }] : []),
                    ...(tele.behind ? [{ label: tele.behind.code, values: tele.behind.times, tier: 2 }] : []),
                  ]}
                />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            {watch && (
              <div className="border-t-2 border-ink pt-2">
                <span className="meta">{COPY.host.gapTitle(watch.code, watchSide)}</span>
                <p className="nums mt-1 text-[1.875rem] font-bold leading-none">{watch.now != null ? COPY.tele.gapS(watch.now) : "–"}</p>
                <p className="nums mt-1 text-sm">{COPY.host.rate(watch.rate)}</p>
                <div className="mt-2">
                  <LineChart width={314} height={150} labelRight={48} xLabels={xLabels} decimals={1} lines={[{ label: watch.code, values: watch.series, tier: 0 }]} />
                </div>
              </div>
            )}
            {tele && (
              <div className="border-t-2 border-ink pt-2">
                <span className="meta">{COPY.host.tyreTitle}</span>
                <p className="nums mt-1 text-[1.875rem] font-bold leading-none">
                  {COPY.host.tyreNow(tele.deg.compound ? (COPY.compounds[tele.deg.compound] ?? tele.deg.compound) : "–", tele.deg.age)}
                </p>
                <p className="nums mt-1 text-sm">{tele.deg.best != null ? COPY.host.bestSoFar(lapTimeText(tele.deg.best)) : COPY.host.noTimes}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

// Exported for race mode, which passes the freeze as a blind decision, the players who owe a call, and
// `why` (trigger chips) plus `label` (the status line) for its own context.
export function Freeze({
  code,
  decision,
  lobby,
  frames,
  team,
  elapsed,
  players,
  submitted,
  onAdvance,
  mode,
  setMode,
  mute,
  why,
  label,
  carFor: carForProp,
}: {
  code: string;
  decision: BlindDecision;
  lobby: LobbyStateResponse;
  frames: LapFrame[];
  team: string | null;
  elapsed: number;
  players: { name: string }[];
  submitted: Set<string>;
  onAdvance: () => void;
  mode: DataMode;
  setMode: (m: DataMode) => void;
  mute: React.ReactNode;
  why?: React.ReactNode;
  label?: string;
  carFor?: (name: string) => string | null;
}) {
  const brief = getBrief(decision, frames);
  const left = Math.max(0, Math.ceil(CALL_WINDOW_S - elapsed / 1000));
  const urgent = left <= 5 && left > 0;
  const r = decision.player_role;
  const me = brief.frame?.drivers.find((d) => d.number === r.number);
  const waiting = Math.max(0, players.length - submitted.size);
  const allIn = players.length > 0 && waiting === 0;
  // The server keeps the call window open for 40 s unless everyone has called; useLobby retries until then.
  const [asked, setAsked] = useState(false);
  const room = (compact: boolean) => (
    <RoomStrip
      players={players}
      submitted={submitted}
      waiting={waiting}
      left={left}
      dark={isDarkField(team)}
      compact={compact}
      carFor={carForProp ?? (carsInPlay(lobby).length > 1 ? (name) => carOf(lobby, name) : undefined)}
    >
      <ModeToggle mode={mode} onChange={setMode} size="sm" onField />
      {mute}
      <Button
        variant="inverse"
        size="sm"
        onClick={() => {
          setAsked(true);
          onAdvance();
        }}
      >
        {asked && !allIn && left > 0 ? COPY.host.callsIn(left) : COPY.freeze.showCalls}
      </Button>
    </RoomStrip>
  );
  const status = brief.frame?.track_status ?? decision.trigger;
  const props = { brief, decision, left, urgent, meCode: me?.code ?? "", code, room, mode, status, why, label };
  return mode === "advanced" ? <AdvancedFreeze {...props} /> : <SimpleFreeze {...props} />;
}

function RoomStrip({
  players,
  submitted,
  waiting,
  left,
  dark,
  compact,
  carFor,
  children,
}: {
  carFor?: (name: string) => string | null;
  players: { name: string }[];
  submitted: Set<string>;
  waiting: number;
  left: number;
  dark: boolean;
  compact: boolean;
  children: React.ReactNode;
}) {
  // With a full room only the codes show: filled means called, dashed underline means still thinking.
  const words = !compact && players.length <= 5;
  return (
    <footer className={`flex border-t-2 border-on-field pt-3 ${compact ? "flex-col items-start gap-3" : "items-center justify-between gap-6"}`}>
      <ol className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
        {players.map((p) => {
          const inn = submitted.has(p.name);
          return (
            <li
              key={p.name}
              aria-label={COPY.host.playerState(p.name, inn)}
              className={`flex min-w-0 items-baseline gap-2 px-2 py-0.5 transition-colors duration-200 ${inn ? (dark ? "bg-white text-ink" : "on-dark bg-ink text-white") : "border-b-2 border-dashed border-on-field"}`}
            >
              <span className="max-w-[14ch] truncate text-2xl font-black tracking-tight">{p.name}</span>
              {carFor && <span className="font-mono text-base font-bold">{carFor(p.name)}</span>}
              {words && <span className="font-mono text-lg font-medium">{inn ? COPY.host.called : COPY.host.thinking}</span>}
            </li>
          );
        })}
        <li className="nums ml-2 text-2xl font-bold">{left === 0 ? COPY.freeze.timeUp : COPY.freeze.waitingOn(waiting)}</li>
      </ol>
      <span className="flex shrink-0 items-center gap-3">{children}</span>
    </footer>
  );
}

type FreezeProps = {
  brief: Brief;
  decision: BlindDecision;
  left: number;
  urgent: boolean;
  meCode: string;
  code: string;
  room: (compact: boolean) => React.ReactNode;
  mode: DataMode;
  status: "GREEN" | "SC" | "VSC";
  why?: React.ReactNode;
  label?: string;
};

function Clock({ left, urgent, className }: { left: number; urgent: boolean; className: string }) {
  return (
    <span key={urgent ? left : "n"} aria-live="polite" className={`nums self-start font-bold leading-none tracking-[-0.04em] ${className} ${urgent ? "tick bg-on-field px-3 text-field" : ""}`}>
      {clockText(left)}
    </span>
  );
}

// "Box now and you come out P10, 0.2 s behind HUL. The stop costs 14.2 s under the safety car, 28.3 s at green. 50 laps left on 7-lap mediums."
function Sentence({ brief, decision, className }: { brief: Brief; decision: BlindDecision; className: string }) {
  const { rejoin, loss, story, ctx } = brief;
  if (!ctx) return null;
  const compound = ctx.compound ? (COPY.compounds[ctx.compound] ?? ctx.compound) : null;
  return (
    <p className={className}>
      {rejoin && <b className="font-black">{COPY.host.boxNowSentence(rejoin.pos, rejoin.ahead)}</b>} {loss && COPY.host.stopCost(decision.trigger, loss.under, loss.normal)}{" "}
      {story && COPY.host.lapsLeftOn(story.lapsLeft, ctx.age, compound)}
    </p>
  );
}

function Options({ brief, compact }: { brief: Brief; compact: boolean }) {
  const { ctx, rejoin, story } = brief;
  if (!ctx) return null;
  const behind = ctx.behind !== "–" ? brief.frame?.drivers.find((d) => d.position === ctx.pos + 1) : null;
  const h = compact ? "h-[104px] px-7" : "h-[124px] px-8";
  const word = compact ? "text-[2.75rem]" : "text-[3.25rem]";
  const sub = `mt-2.5 flex items-center gap-2 font-mono ${compact ? "text-sm" : "text-base"}`;
  return (
    <div className="flex flex-col">
      <div className={`flex flex-col justify-center bg-white text-ink ${h}`}>
        <b className={`${word} font-black leading-none tracking-[-0.03em]`}>{COPY.freeze.options.STAY}</b>
        <span className={sub}>
          <TyreChip compound={ctx.compound} age={ctx.age} size="sm" />
          {COPY.host.stayLine(ctx.pos, behind ? { code: behind.code, gap: ctx.behind } : null)}
        </span>
      </div>
      <div className={`on-dark flex flex-col justify-center bg-ink text-white ${h}`}>
        <b className={`${word} font-black leading-none tracking-[-0.03em]`}>{COPY.freeze.options.BOX}</b>
        <span className={sub}>{rejoin ? COPY.host.boxLine(rejoin.pos, story?.lapsLeft ?? 0) : COPY.story.boxTyres}</span>
      </div>
    </div>
  );
}

function SimpleFreeze({ brief, decision, left, urgent, meCode, code, room, status, why, label }: FreezeProps) {
  const t = brief.tele;
  return (
    <main className="flood flex h-dvh flex-col overflow-hidden bg-field text-on-field">
      <TrackStrip status={status} size="host" />
      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr_auto_auto] gap-y-4 px-14 pb-7 pt-5">
        <Top left={label ?? COPY.host.statusLong(decision.trigger, decision.lap, decision.total_laps)} right={`${COPY.mode.simple} · ${COPY.host.room(code)}`} />
        <div className="grid min-h-0 grid-cols-12 items-center gap-x-6">
          <section className="col-span-7 flex flex-col">
            <Clock left={left} urgent={urgent} className="text-[length:min(4.75rem,7dvh)]" />
            <h1 className={`display mt-3 leading-[0.92] ${why ? "text-[length:min(3.75rem,5.6dvh)]" : "text-[length:min(4.5rem,6.6dvh)]"}`}>
              {brief.ctx ? COPY.host.lead(meCode, brief.ctx.pos) : ""} {COPY.freeze.question}
            </h1>
            {why && <div className="mt-4">{why}</div>}
            <Sentence brief={brief} decision={decision} className="mt-4 max-w-[60ch] text-[1.375rem] font-medium leading-[1.3]" />
            {brief.rejoin && <RejoinCaveat frame={brief.frame} lap={decision.lap} className="mt-1.5 text-base font-medium" />}
          </section>
          <section className="col-span-5 col-start-8">
            <Options brief={brief} compact={false} />
          </section>
        </div>
        {t && (
          <section className="grid grid-cols-12 gap-x-6 border-t-2 border-on-field pt-3">
            <div className="col-span-5">
              <span className="meta">{simpleChartLabel(t)}</span>
              <div className="mt-1">
                <LapChart laps={t.laps} cars={[t.me, t.ahead, t.behind]} height={100} status={t.status} />
              </div>
            </div>
            <div className="col-span-7">
              <NeighbourList t={t} big />
            </div>
          </section>
        )}
        {room(false)}
      </div>
    </main>
  );
}

function AdvancedFreeze({ brief, decision, left, urgent, meCode, code, room, mode, status, why, label }: FreezeProps) {
  const t = brief.tele;
  const r = decision.player_role;
  const pos = brief.ctx?.pos;
  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <TrackStrip status={status} size="host" />
      <div className="grid min-h-0 flex-1 grid-cols-[520px_1fr]">
        <section className="flood flex min-h-0 flex-col bg-field pb-8 pl-14 pr-10 pt-6 text-on-field">
          <Top className="text-[15px]" left={label ?? COPY.host.statusLong(decision.trigger, decision.lap, decision.total_laps)} right={code} />
          <Clock left={left} urgent={urgent} className="mt-5 text-[4.5rem]" />
          <h1 className="display mt-3 text-[3.125rem] leading-[0.94]">
            {brief.ctx ? COPY.host.lead(meCode, brief.ctx.pos) : ""} {COPY.freeze.question}
          </h1>
          {why && <div className="mt-3">{why}</div>}
          {brief.rejoin && (
            <p className="mt-3 text-lg font-medium leading-[1.35]">
              {COPY.host.boxNowLead} <b className="font-black">{COPY.host.boxNowShort(brief.rejoin.pos, brief.rejoin.ahead, brief.rejoin.behind)}</b>{" "}
              {brief.story && brief.ctx && COPY.host.lapsLeftOn(brief.story.lapsLeft, brief.ctx.age, brief.ctx.compound ? (COPY.compounds[brief.ctx.compound] ?? brief.ctx.compound) : null)}
            </p>
          )}
          {brief.rejoin && <RejoinCaveat frame={brief.frame} lap={decision.lap} className="mt-1 text-base font-bold" />}
          <div className="mt-auto pt-4">
            <Options brief={brief} compact />
          </div>
          <div className="mt-4">{room(true)}</div>
        </section>
        <section className="grid min-h-0 grid-cols-2 grid-rows-[auto_auto_auto_1fr] gap-x-12 overflow-hidden bg-white pb-8 pl-12 pr-14 pt-6 text-ink">
          <Top className="col-span-2 mb-2 text-[15px]" left={COPY.mode.advanced} right={`${meCode} #${r.number}${pos ? ` · P${pos}` : ""}`} />
          {t ? (
            <>
              <Sec label={COPY.host.stintTimes} meta={t.stintLaps.length ? `L${t.stintLaps[0]}-${t.stintLaps[t.stintLaps.length - 1]} · s` : undefined}>
                <LapChart laps={t.stintLaps} cars={[t.stint.me, t.stint.ahead, t.stint.behind]} height={130} axis />
              </Sec>
              <Sec label={COPY.host.intervalsTitle} meta="s">
                <IntervalChart t={t} height={130} />
              </Sec>
              <Sec label={COPY.host.fieldTyres} meta={t.ages.length ? COPY.host.agesRange(Math.min(...t.ages), Math.max(...t.ages)) : undefined}>
                <FieldTyres t={t} me={r.number} onField={false} />
              </Sec>
              <Sec label={COPY.host.pitLoss} meta="s">
                {brief.loss && <PitLoss under={brief.loss.under} normal={brief.loss.normal} trigger={decision.trigger} />}
              </Sec>
              <div className="flex min-h-0 flex-col overflow-hidden">
                <Sec label={COPY.host.stint} meta={`${meCode} #${r.number}`}>
                  <StintTable t={t} normal={decision.pit_loss?.normal_s ?? null} />
                </Sec>
                <UndercutClock t={t} mode={mode} />
              </div>
              <div className="flex min-h-0 flex-col overflow-hidden">
                <Sec label={COPY.host.rejoinTitle} meta={COPY.host.gapToLeader}>
                  {brief.frame && <RejoinStrip t={t} frameCars={brief.frame.drivers.map((d) => ({ code: d.code, gap: d.gap_to_leader_s, number: d.number }))} />}
                  <Note>{intervalNote(t)}</Note>
                </Sec>
                <NeighbourList t={t} />
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
