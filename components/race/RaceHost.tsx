"use client";
// The host laptop in a race lobby (Round 6): lobby, the replay between freezes, each freeze on the called
// car's team-colour field with why it froze, then a short "calls locked" beat and the race goes on (Round 7:
// nobody learns who was right until the flag). At the flag: the shared game summary (components/EndScreen.tsx).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COPY } from "@/lib/copy";
import type { LobbyStateResponse, RaceEntry } from "@/lib/client/api";
import { playFreezeTone } from "@/lib/client/cue";
import { fieldStyle } from "@/lib/client/field";
import { noopSubscribe } from "@/lib/client/identity";
import { useDataMode, type DataMode } from "@/lib/client/mode";
import { CALL_WINDOW_S } from "@/lib/client/race";
import {
  REVEAL_HOLD_MS,
  clockLap,
  featuredCar,
  freezeDecision,
  nextAfterReplay,
  numberOf,
  raceCarOf,
  raceCars,
  racePhase,
  replayDecision,
  segmentDone,
  useRaceEntry,
  useRaceFrames,
  useRaceFreeze,
  type RaceLobby,
} from "@/lib/client/raceLobby";
import { kickPlayer } from "@/lib/client/session";
import { lapTimeText, telemetry } from "@/lib/client/telemetry";
import { useTicker, type Conn } from "@/lib/client/useLobby";
import type { LapFrame } from "@/lib/types";
import { Centered, DarkModeToggle, Freeze, PlayerSlots, Top, retryLater } from "../host/HostScreen";
import { LineChart } from "../host/HostCharts";
import { HostQr } from "../host/HostQr";
import { Tower } from "../Tower";
import { Brand, Button, ConnNotice, ModeToggle, Num, ScChip, TrackStrip } from "../ui";
import { RaceProgress, Triggers } from "./parts";
import { HostSummary, Scoring } from "../EndScreen";
import { useSummary } from "@/lib/client/results";
import { useRaceNight } from "@/lib/client/uiFlag";
import { RNRaceLobby } from "../rn/host/lobby/RNLobby";
import { RNRaceReplay } from "../rn/host/replay/RNReplay";
import { RNHostSummary, RNScoring } from "../rn/end/RNHostEnd";
import { RNFreeze, RNLocked } from "../rn/host/freeze/RNFreeze";
import { RNControlButton, RNMuteButton } from "../rn/host/controls";

const MAX_PLAYERS = 12;

export function RaceHost({
  code,
  lobby,
  conn,
  serverNow,
  setPhase,
  refresh,
  hostToken,
  phaseErr,
}: {
  code: string;
  lobby: LobbyStateResponse;
  conn: Conn;
  serverNow: () => number;
  setPhase: (phase: string, freezeIndex?: number) => Promise<string | null>;
  refresh: () => Promise<void>;
  hostToken: string | null;
  phaseErr: "forbidden" | null;
}) {
  const race = lobby as RaceLobby;
  const r = race.race;
  const phase = racePhase(race);
  const entry = useRaceEntry(r.race_key);
  const frames = useRaceFrames(code, lobby);
  const freeze = useRaceFreeze(code, lobby);
  const { summary, failed } = useSummary(code, phase === "done");
  const [mode, setMode] = useDataMode(code, "host");
  const rn = useRaceNight();
  const t = useTicker(serverNow, 100);
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
  const [muted, setMuted] = useState(false);
  const elapsed = t - race.phase_started_at;

  const followed = race.driver_code ?? raceCars(race)[0] ?? entry?.default_driver ?? null;
  const colourOf = (c: string | null) => (c ? (entry?.drivers.find((d) => d.code === c)?.team_colour ?? null) : null);
  const carFor = (name: string) => raceCarOf(race, name);

  // Freeze cue, once per freeze.
  const cued = useRef("");
  useEffect(() => {
    if (phase !== "freeze") return;
    const k = `${race.phase_started_at}`;
    if (cued.current === k) return;
    cued.current = k;
    if (!muted) playFreezeTone();
  }, [phase, race.phase_started_at, muted]);

  // Auto-advance on the server clock: replay -> freeze (or the flag) when the segment ends; freeze -> the
  // "calls locked" beat after the call window or once every car with a call is in; then back to the replay.
  const advanced = useRef("");
  const need = r.calls_needed ?? [];
  const owing = race.players.filter((p) => {
    const c = carFor(p.name);
    return c != null && need.includes(c);
  });
  const allIn = owing.length > 0 && owing.every((p) => r.called.includes(p.name));
  useEffect(() => {
    const k = `${phase}:${race.phase_started_at}`;
    if (advanced.current === k) return;
    // A failed request clears the latch after a pause (retryLater), so the race never sticks until a reload.
    if (phase === "replay" && segmentDone(race, t)) {
      advanced.current = k;
      void setPhase(nextAfterReplay(r), r.freeze_index).then((e) => retryLater(advanced, k, e));
    } else if (phase === "freeze" && (elapsed >= (CALL_WINDOW_S + 1.5) * 1000 || (allIn && elapsed > 1500))) {
      advanced.current = k;
      void setPhase("reveal_freeze", r.freeze_index).then((e) => retryLater(advanced, k, e));
    } else if (phase === "reveal_freeze" && elapsed >= REVEAL_HOLD_MS) {
      advanced.current = k;
      void setPhase("replay", r.freeze_index).then((e) => retryLater(advanced, k, e));
    }
  }, [phase, race, r, t, elapsed, allIn, setPhase]);

  const muteBtn = (variant: "secondary" | "inverse") =>
    rn ? (
      <RNMuteButton muted={muted} onToggle={() => setMuted((m) => !m)} tone="dark" />
    ) : (
      <Button variant={variant} size="sm" aria-pressed={muted} onClick={() => setMuted((m) => !m)}>
        {muted ? COPY.cue.unmute : COPY.cue.mute}
      </Button>
    );

  let body: React.ReactNode;
  if (phase === "waiting") {
    const LobbyV = rn ? RNRaceLobby : RaceLobbyView;
    body = (
      <LobbyV
        code={code}
        origin={origin}
        race={race}
        entry={entry}
        colourOf={colourOf}
        carFor={carFor}
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
    );
  } else if (phase === "replay") {
    const ReplayV = rn ? RNRaceReplay : ReplayView;
    body = (
      <ReplayV
        code={code}
        race={race}
        frames={frames}
        lap={Math.min(clockLap(race, t), frames.at(-1)?.lap ?? 0)}
        followed={followed}
        mode={mode}
        controls={
          <>
            <ModeToggle mode={mode} onChange={setMode} size="sm" />
            {muteBtn("secondary")}
            {segmentDone(race, t) &&
              (rn ? (
                <RNControlButton onClick={() => void setPhase(nextAfterReplay(r), r.freeze_index)}>{COPY.race.continue}</RNControlButton>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => void setPhase(nextAfterReplay(r), r.freeze_index)}>
                  {COPY.race.continue}
                </Button>
              ))}
          </>
        }
      />
    );
  } else if (phase === "freeze") {
    const car = featuredCar(r, followed);
    const f = car ? freeze?.drivers[car] : null;
    const n = numberOf(frames, car);
    const atLap = frames.some((x) => x.lap === r.freeze_lap);
    if (!freeze || !f || n == null || !atLap) body = <Centered text={COPY.race.loading} />;
    else {
      const others = need.filter((c) => c !== car);
      const idle = raceCars(race).filter((c) => !need.includes(c));
      const why = (
        <div className="flex flex-col gap-2.5">
          <span className="meta opacity-80">{COPY.race.whyTitle}</span>
          <Triggers freeze={f} />
          {others.map((c) => {
            const o = freeze.drivers[c];
            return o ? <Triggers key={c} freeze={o} showCar compact /> : null;
          })}
          {idle.length > 0 && <p className="text-sm font-semibold opacity-85">{COPY.race.noCallHost(idle)}</p>}
        </div>
      );
      const FreezeV = rn ? RNFreeze : Freeze;
      body = (
        <div style={rn ? undefined : fieldStyle(colourOf(car))}>
          <FreezeV
            code={code}
            decision={freezeDecision(r, f, n, frames, r.segment_start_lap)}
            lobby={race}
            frames={frames.filter((x) => x.lap <= f.lap)}
            team={colourOf(car)}
            elapsed={elapsed}
            players={owing}
            submitted={new Set(r.called)}
            onAdvance={() => setPhase("reveal_freeze", r.freeze_index)}
            mode={mode}
            setMode={setMode}
            mute={muteBtn("inverse")}
            why={why}
            label={`${COPY.race.freezeTag(r.freeze_index + 1, r.freeze_count)} · ${COPY.race.lapTag(f.lap, r.total_laps)}`}
            carFor={need.length > 1 ? carFor : undefined}
          />
        </div>
      );
    }
  } else if (phase === "reveal_freeze") {
    const left = Math.max(0, Math.ceil((REVEAL_HOLD_MS - elapsed) / 1000));
    body = rn ? (
      <RNLocked left={left} onResume={() => setPhase("replay", r.freeze_index)} team={colourOf(followed)} players={race.players} called={r.called} holdS={Math.round(REVEAL_HOLD_MS / 1000)} />
    ) : (
      <Locked left={left} onResume={() => setPhase("replay", r.freeze_index)} />
    );
  } else {
    body = summary ? (
      rn ? (
        <RNHostSummary summary={summary} code={code} carCode={followed} />
      ) : (
        <div style={fieldStyle(colourOf(followed))}>
          <HostSummary summary={summary} code={code} carCode={followed} />
        </div>
      )
    ) : rn ? (
      <RNScoring elapsedMs={elapsed} failed={failed} big />
    ) : (
      <Scoring elapsedMs={elapsed} failed={failed} big />
    );
  }

  return (
    <div>
      <ConnNotice conn={conn} code={code} />
      {(!hostToken || phaseErr === "forbidden") && (
        <p role="alert" className="fixed inset-x-0 bottom-0 z-[var(--z-toast)] bg-white px-4 py-3 text-center text-base font-bold text-ink shadow-[0_-2px_0_var(--color-ink)]">
          {COPY.error.notHost(code)}
        </p>
      )}
      {body}
    </div>
  );
}

function RaceLobbyView({
  code,
  origin,
  race,
  entry,
  colourOf,
  carFor,
  onStart,
  onKick,
  mode,
  setMode,
}: {
  code: string;
  origin: string;
  race: RaceLobby;
  entry: RaceEntry | null;
  colourOf: (c: string | null) => string | null;
  carFor: (name: string) => string | null;
  onStart: () => Promise<string | null>;
  onKick: (name: string) => Promise<void>;
  mode: DataMode;
  setMode: (m: DataMode) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const joinUrl = origin ? `${origin.replace(/^https?:\/\//, "")}/play/${code}` : "";
  const joinHref = origin ? `${origin}/play/${code}` : "";
  const r = race.race;
  const same = race.driver_mode !== "choose";
  const car = same ? entry?.drivers.find((d) => d.code === race.driver_code) : null;
  const picks = raceCars(race);
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
        right={COPY.host.playersCount(race.players.length, MAX_PLAYERS)}
      />
      <div className="grid min-h-0 grid-cols-12 items-center gap-x-6">
        <section className="col-span-6 flex flex-col">
          <span className="meta">{COPY.host.roomCode}</span>
          <h1 className="mt-4 text-[9.375rem] font-black leading-[0.86] tracking-[-0.04em]" aria-label={COPY.room.heading(code)}>
            {code}
          </h1>
          <p className="mt-4 max-w-[30ch] text-[1.625rem] font-medium leading-snug text-[#cfcfcf]">
            {COPY.host.scanOr(joinUrl.split("/")[0])} <b className="font-bold text-white">/play/{code}</b>.
          </p>
          <div className="mt-8 flex items-end gap-6">
            {joinHref ? <HostQr value={joinHref} size={200} label={COPY.room.scanAlt(joinUrl)} /> : <div className="size-[200px] bg-[#222]" />}
            <div className="flex flex-col items-start gap-4">
              <Brand kind="mark" height={120} label={false} />
              <p className="nums text-[15px] font-medium leading-relaxed text-[#bdbdbd]">{joinUrl}</p>
            </div>
          </div>
        </section>
        <section className="col-span-6 flex min-h-0 flex-col">
          <span className="meta mb-2">{COPY.host.players}</span>
          <PlayerSlots players={race.players} carFor={carFor} colourOf={colourOf} onKick={onKick} />
          <div style={fieldStyle(car?.team_colour ?? null)} className="mt-7 flex items-center justify-between gap-6 bg-field px-7 py-5 text-on-field">
            <b className="text-[2.125rem] font-black leading-none tracking-[-0.02em]">
              {same ? (car ? COPY.host.carBand(car.code, car.number) : (race.driver_code ?? "")) : COPY.race.lobbyChoose}
            </b>
            <span className="meta text-[15px]">{same ? COPY.race.lobbyCar : car ? "" : COPY.homeUi.modes.race.name}</span>
          </div>
          <p className="mt-4 text-xl font-bold">{COPY.race.raceLine(r.name, r.total_laps)}</p>
          {!same && (
            <p className="mt-2 text-sm font-medium text-[#bdbdbd]">
              {picks.length
                ? picks.map((c) => COPY.host.drives(c, race.players.filter((p) => carFor(p.name) === c).map((p) => p.name))).join(" · ")
                : COPY.race.pickWait}
            </p>
          )}
        </section>
      </div>
      <footer className="flex items-center justify-between gap-6 border-t-2 border-white pt-[18px]">
        <span className="flex min-w-0 items-center gap-6">
          <span className="max-w-[70ch] text-[15px] text-[#bdbdbd]">{err ?? COPY.race.lobbyNote}</span>
          <DarkModeToggle mode={mode} onChange={setMode} />
        </span>
        <Button
          variant="inverse"
          size="md"
          busy={busy}
          className="shrink-0 text-[1.375rem]! font-black"
          onClick={async () => {
            setBusy(true);
            setErr(await onStart());
            setBusy(false);
          }}
        >
          {COPY.waiting.hostButton}
        </Button>
      </footer>
    </main>
  );
}

function ReplayView({
  code,
  race,
  frames,
  lap,
  followed,
  mode,
  controls,
}: {
  code: string;
  race: RaceLobby;
  frames: LapFrame[];
  lap: number;
  followed: string | null;
  mode: DataMode;
  controls: React.ReactNode;
}) {
  const r = race.race;
  const frame = frames.find((f) => f.lap === lap) ?? frames.at(-1);
  if (!frame) return <Centered text={COPY.race.loading} />;
  const n = numberOf(frames, followed) ?? -1;
  const seen = frames.filter((f) => f.lap <= frame.lap);
  const tele = n >= 0 ? telemetry(seen, replayDecision(r, n, frame.lap), 8) : null;
  const me = frame.drivers.find((d) => d.number === n);
  const xLabels = tele ? tele.laps.map((l) => `L${l}`) : [];
  const watch = tele?.gapAhead ?? tele?.gapBehind ?? null;
  const watchSide = tele?.gapAhead ? "ahead" : "behind";
  return (
    <main className="grid h-dvh grid-cols-[322px_1fr] grid-rows-[auto_auto_1fr] gap-x-6 gap-y-4 overflow-hidden px-14 pb-8 pt-0" style={fieldStyle(me?.team_colour ?? null)}>
      <div className="col-span-2 -mx-14 min-h-6">
        <TrackStrip status={frame.track_status} size="host" />
      </div>
      <Top
        className="col-span-2"
        left={
          <>
            {COPY.race.replayTag} · {r.name}
            <ScChip status={frame.track_status} />
          </>
        }
        right={
          <>
            <span className="flex items-center gap-3 font-sans normal-case">{controls}</span>
            <span className="ml-4">{COPY.host.room(code)}</span>
          </>
        }
      />
      <section className="min-h-0 overflow-hidden border-t-2 border-ink [&_li[aria-current]]:border-field [&_li[aria-current]]:bg-field [&_li[aria-current]]:text-on-field">
        <Tower drivers={frame.drivers} playerNumber={n} mode={mode} showPit={mode === "advanced"} />
      </section>
      <section className="flex min-h-0 flex-col border-t-2 border-ink">
        <div className="flex items-end justify-between gap-6 pt-3">
          <span className="font-black leading-[0.85] tracking-[-0.04em]">
            <span className="text-[8.5rem]">L{frame.lap}</span>
            <span className="text-[3rem] text-ink-3">/{r.total_laps}</span>
          </span>
          {me && (
            <p className="max-w-[26ch] pb-2 text-right text-[1.625rem] font-medium leading-snug">
              <b className="font-black">{COPY.host.youAre(me.code, me.position)}</b> {COPY.race.follows(me.code)}.
            </p>
          )}
        </div>
        <div className="mt-5">
          <RaceProgress total={r.total_laps} lap={frame.lap} past={r.past_freeze_laps} />
        </div>
        <div className="mt-5 grid min-h-0 flex-1 grid-cols-[1fr_314px] gap-12">
          <div className="min-w-0">
            <span className="meta">{COPY.host.lapTimeTitle}</span>
            {tele && (
              <div className="mt-2">
                <LineChart
                  invert
                  fit
                  text={1.3}
                  aspect={0.42}
                  maxHeight={500}
                  width={600}
                  height={260}
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
                <p className="mt-2 text-[2.25rem] font-extrabold leading-none tracking-[-0.03em]">{watch.now != null ? <Num value={COPY.tele.gapS(watch.now)} /> : "–"}</p>
                <p className="nums mt-1.5 text-sm font-medium opacity-75">{COPY.host.rate(watch.rate)}</p>
              </div>
            )}
            {tele && (
              <div className="border-t-2 border-ink pt-2">
                <span className="meta">{COPY.host.tyreTitle}</span>
                <p className="nums mt-2 text-[1.875rem] font-extrabold leading-none tracking-[-0.02em]">
                  {COPY.host.tyreNow(tele.deg.compound ? (COPY.compounds[tele.deg.compound] ?? tele.deg.compound) : "–", tele.deg.age)}
                </p>
                <p className="nums mt-1.5 text-sm font-medium opacity-75">{tele.deg.best != null ? COPY.host.bestSoFar(lapTimeText(tele.deg.best)) : COPY.host.noTimes}</p>
              </div>
            )}
            <p className="border-t-2 border-ink pt-3 text-xl font-medium leading-snug">
              <b className="font-black">{COPY.race.audible.title}.</b> {COPY.race.audible.hint}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

// Round 7: after a freeze the race goes on. No right call, swing or score until the flag.
function Locked({ left, onResume }: { left: number; onResume: () => void }) {
  return (
    <main className="flex h-dvh flex-col justify-center gap-6 px-14">
      <h1 className="display text-[5rem] leading-[0.95]">{COPY.end.lockedTitle}</h1>
      <p className="max-w-[48ch] text-2xl font-medium leading-snug text-ink-2">{COPY.end.lockedSub}</p>
      <div className="mt-2 flex items-center gap-6 border-t-2 border-ink pt-5">
        <span className="nums text-xl font-semibold">{COPY.end.lockedIn(left)}</span>
        <Button variant="secondary" size="sm" onClick={onResume}>
          {COPY.race.resumeNow}
        </Button>
      </div>
    </main>
  );
}
