"use client";
// The host laptop in a race lobby (Round 6): lobby, the replay between freezes, each freeze on the called
// car's team-colour field with why it froze, a short reveal (the takes, then the right call), and the race
// scoreboard at the flag. No scores show mid-race. Before a freeze's reveal it reads blind routes only.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COPY } from "@/lib/copy";
import type { FreezeRevealResponse, LobbyStateResponse, RaceCall, RaceEntry, RaceLeaderboardResponse, RaceRevealResponse } from "@/lib/client/api";
import { playFreezeTone } from "@/lib/client/cue";
import { fieldStyle } from "@/lib/client/field";
import { noopSubscribe } from "@/lib/client/identity";
import { useDataMode, type DataMode } from "@/lib/client/mode";
import { CALL_WINDOW_S, tla } from "@/lib/client/race";
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
  useFreezeReveal,
  useRaceBoard,
  useRaceEntry,
  useRaceFrames,
  useRaceFreeze,
  useRaceReveal,
  type RaceLobby,
} from "@/lib/client/raceLobby";
import { kickPlayer } from "@/lib/client/session";
import { lapTimeText, telemetry } from "@/lib/client/telemetry";
import { useTicker, type Conn } from "@/lib/client/useLobby";
import type { LapFrame } from "@/lib/types";
import { Centered, DarkModeToggle, Freeze, PlayerSlots, Top } from "../host/HostScreen";
import { LineChart } from "../host/HostCharts";
import { HostQr } from "../host/HostQr";
import { Tower } from "../Tower";
import { Brand, Button, CallWord, ConnNotice, ModeToggle, ScChip, TrackStrip } from "../ui";
import { RaceProgress, Triggers } from "./parts";

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
  const freezeRev = useFreezeReveal(code, phase === "reveal_freeze" ? r.freeze_lap : null);
  const full = useRaceReveal(code, phase === "done");
  const board = useRaceBoard(r.race_key, code, "done", phase === "done");
  const [mode, setMode] = useDataMode(code, "host");
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

  // Auto-advance on the server clock: replay -> freeze (or the flag) when the segment ends; freeze -> reveal
  // after the call window or once every car with a call is in; reveal -> replay after the hold.
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
    if (phase === "replay" && segmentDone(race, t)) {
      advanced.current = k;
      void setPhase(nextAfterReplay(r), r.freeze_index);
    } else if (phase === "freeze" && (elapsed >= (CALL_WINDOW_S + 1.5) * 1000 || (allIn && elapsed > 1500))) {
      advanced.current = k;
      void setPhase("reveal_freeze", r.freeze_index);
    } else if (phase === "reveal_freeze" && elapsed >= REVEAL_HOLD_MS) {
      advanced.current = k;
      void setPhase("replay", r.freeze_index);
    }
  }, [phase, race, r, t, elapsed, allIn, setPhase]);

  const muteBtn = (variant: "secondary" | "inverse") => (
    <Button variant={variant} size="sm" aria-pressed={muted} onClick={() => setMuted((m) => !m)}>
      {muted ? COPY.cue.unmute : COPY.cue.mute}
    </Button>
  );

  let body: React.ReactNode;
  if (phase === "waiting") {
    body = (
      <RaceLobbyView
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
    body = (
      <ReplayView
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
        <div className="flex flex-col gap-3">
          <span className="meta">{COPY.race.whyTitle}</span>
          <Triggers freeze={f} />
          {others.map((c) => {
            const o = freeze.drivers[c];
            return o ? <Triggers key={c} freeze={o} showCar /> : null;
          })}
          {idle.length > 0 && <p className="font-mono text-sm font-bold">{COPY.race.noCallHost(idle)}</p>}
        </div>
      );
      body = (
        <div style={fieldStyle(colourOf(car))}>
          <Freeze
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
    body = freezeRev ? (
      <FreezeRevealView
        race={race}
        rev={freezeRev}
        colourOf={colourOf}
        left={Math.max(0, Math.ceil((REVEAL_HOLD_MS - elapsed) / 1000))}
        onResume={() => setPhase("replay", r.freeze_index)}
        mode={mode}
        setMode={setMode}
      />
    ) : (
      <Centered text={COPY.reveal.grading} />
    );
  } else {
    body = full && board ? <ScoreboardView race={race} full={full} board={board} colourOf={colourOf} /> : <Centered text={COPY.reveal.grading} />;
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
          <PlayerSlots players={race.players} carFor={carFor} colourOf={colourOf} onKick={onKick} />
          <div style={fieldStyle(car?.team_colour ?? null)} className="mt-7 flex items-center justify-between gap-6 bg-field px-7 py-5 text-on-field">
            <b className="text-[2.125rem] font-black leading-none tracking-[-0.02em]">
              {same ? (car ? COPY.host.carBand(car.code, car.number) : (race.driver_code ?? "")) : COPY.race.lobbyChoose}
            </b>
            <span className="meta text-[15px]">{same ? COPY.race.lobbyCar : car ? "" : COPY.homeUi.modes.race.name}</span>
          </div>
          <p className="mt-4 text-xl font-bold">{COPY.race.raceLine(r.name, r.total_laps)}</p>
          {!same && (
            <p className="mt-2 font-mono text-sm text-[#bdbdbd]">
              {picks.length
                ? picks.map((c) => COPY.host.drives(c, race.players.filter((p) => carFor(p.name) === c).map((p) => tla(p.name)))).join(" · ")
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
                <p className="nums mt-1 text-[1.875rem] font-bold leading-none">
                  {watchSide === "behind" ? "+" : "−"}
                  {watch.now?.toFixed(1) ?? "–"}
                </p>
                <p className="nums mt-1 text-sm">{COPY.host.rate(watch.rate)}</p>
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
            <p className="border-t-2 border-ink pt-2 text-base">{COPY.race.audible.hint}</p>
          </div>
        </div>
      </section>
    </main>
  );
}

// Minimal per-freeze reveal: the room's takes on each called car, then the right call. No scores mid-race.
function FreezeRevealView({
  race,
  rev,
  colourOf,
  left,
  onResume,
  mode,
  setMode,
}: {
  race: RaceLobby;
  rev: FreezeRevealResponse;
  colourOf: (c: string | null) => string | null;
  left: number;
  onResume: () => void;
  mode: DataMode;
  setMode: (m: DataMode) => void;
}) {
  const r = race.race;
  const cars = Object.entries(rev.drivers).filter((e): e is [string, NonNullable<(typeof e)[1]>] => e[1] != null);
  const compact = cars.length > 1;
  return (
    <main className="grid h-dvh grid-rows-[auto_1fr] gap-y-6 overflow-hidden px-14 py-10">
      <header className="flex items-center justify-between gap-6 font-mono text-lg font-bold uppercase">
        <span>{COPY.race.revealTag(r.freeze_index + 1, r.freeze_count, rev.lap)}</span>
        <span className="flex items-center gap-4 font-sans normal-case">
          <ModeToggle mode={mode} onChange={setMode} size="sm" />
          <span className="nums text-base">{COPY.race.resumeIn(left)}</span>
          <Button variant="secondary" size="sm" onClick={onResume}>
            {COPY.race.resumeNow}
          </Button>
        </span>
      </header>
      <div className={`grid min-h-0 gap-6 ${compact ? "grid-rows-2" : ""}`}>
        {cars.map(([code, d]) => {
          const takes = rev.calls.filter((c) => c.kind === "freeze" && c.driver_code === code);
          const waiting = race.players.filter((p) => raceCarOf(race, p.name) === code && !takes.some((c) => c.player_name === p.name));
          return (
            <section key={code} className="grid min-h-0 grid-cols-12 gap-x-6 border-t-2 border-ink pt-4">
              <div className="col-span-7 flex min-h-0 flex-col">
                <span className="meta text-ink-2">{COPY.race.roomOn(code)}</span>
                <Takes calls={takes} missing={waiting.map((p) => p.name)} compact={compact} />
              </div>
              <div style={fieldStyle(colourOf(code))} className="rise col-span-5 flex min-h-0 flex-col bg-field px-7 py-5 text-on-field" >
                <span className="meta">{COPY.host.outcome}</span>
                <span className={`display mt-2 leading-none ${compact ? "text-[3rem]" : "text-[4.5rem]"}`}>{COPY.race.winning(d.correct)}</span>
                <span className={`nums mt-3 font-bold ${compact ? "text-xl" : "text-[1.75rem]"}`}>
                  {d.swing_s != null && !d.swing_deferred ? `${COPY.race.worthLabel}: ${COPY.race.worth(d.swing_s)}` : COPY.race.worthDeferred}
                </span>
                {mode === "advanced" && (
                  <div className="mt-auto flex flex-col gap-1 pt-4 font-mono text-sm">
                    <span>{COPY.race.window(d.window[0], d.window[1])}</span>
                    <span>{COPY.race.comparison(d.comparison.boxed, d.comparison.stayed)}</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function Takes({ calls, missing, compact }: { calls: RaceCall[]; missing: string[]; compact: boolean }) {
  if (!calls.length) return <p className="mt-3 text-2xl font-bold">{COPY.race.nobodyCalled}</p>;
  const cap = compact ? 4 : 6;
  return (
    <>
      <ol className={`mt-4 grid min-h-0 gap-x-8 gap-y-4 overflow-hidden ${calls.length > 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {calls.slice(0, cap).map((c, i) => (
          <li key={c.player_name} className="rise flex flex-col gap-1.5 border-l-[3px] border-ink pl-5" style={{ animationDelay: `${150 + i * 200}ms` }}>
            <span className="flex items-baseline gap-3">
              <b className={`${compact ? "text-2xl" : "text-[2rem]"} font-black tracking-tight`}>{tla(c.player_name)}</b>
              <CallWord call={c.call} className="font-mono text-lg font-bold" />
            </span>
            {c.transcript && <q className={`${compact ? "line-clamp-1 text-lg" : "line-clamp-3 text-2xl"} font-medium leading-snug`}>{c.transcript}</q>}
          </li>
        ))}
      </ol>
      {(calls.length > cap || missing.length > 0) && (
        <p className="mt-3 font-mono text-sm font-bold">
          {calls.length > cap && `+ ${calls.slice(cap).map((c) => tla(c.player_name)).join(" · ")}`}
          {missing.length > 0 && ` ${COPY.reveal.noCall}: ${missing.map(tla).join(" · ")}`}
        </p>
      )}
    </>
  );
}

// At the flag: every player's race total with the freeze-by-freeze breakdown and audibles, team and engine
// rows per car, and the audible results.
function ScoreboardView({
  race,
  full,
  board,
  colourOf,
}: {
  race: RaceLobby;
  full: RaceRevealResponse;
  board: RaceLeaderboardResponse;
  colourOf: (c: string | null) => string | null;
}) {
  const router = useRouter();
  const laps = full.freezes.map((f) => f.lap);
  const audibles = full.calls.filter((c) => c.kind === "audible");
  const rows = board.rows;
  const many = rows.length > 8;
  const cols = `48px minmax(180px,1.4fr) 72px repeat(${laps.length}, minmax(0,1fr)) 110px 96px`;
  let rank = 0;
  return (
    <main className="grid h-dvh grid-rows-[auto_auto_1fr_auto] gap-y-5 overflow-hidden px-14 py-10">
      <header className="flex items-center justify-between gap-6 font-mono text-lg font-bold uppercase">
        <span>{COPY.race.scoreboardTag(race.race.name)}</span>
        <Button variant="secondary" size="sm" className="font-sans normal-case" onClick={() => router.push("/")}>
          {COPY.race.newLobby}
        </Button>
      </header>
      <h1 className="display text-[4.5rem] leading-none">{COPY.race.flagTitle}</h1>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_380px] gap-x-12">
        <div role="table" className="flex min-h-0 flex-col overflow-hidden">
          <div role="row" className="grid h-9 items-center gap-x-3 border-b-2 border-ink" style={{ gridTemplateColumns: cols }}>
            <span className="meta">{COPY.race.cols.rank}</span>
            <span className="meta">{COPY.race.cols.player}</span>
            <span className="meta">{COPY.race.cols.car}</span>
            {laps.map((l) => (
              <span key={l} className="meta text-right">
                {COPY.race.freezeCol(l)}
              </span>
            ))}
            <span className="meta text-right">{COPY.race.cols.audibles}</span>
            <span className="meta text-right">{COPY.race.cols.total}</span>
          </div>
          {rows.map((row, i) => {
            const player = row.kind === "player";
            if (player) rank++;
            const aud = row.audibles.reduce((s, a) => s + a.total, 0);
            return (
              <div
                role="row"
                key={`${row.kind}-${row.name}-${i}`}
                className={`rise grid items-center gap-x-3 border-b border-line ${many ? "h-11" : "h-14"} ${player ? "" : "text-ink-2"}`}
                style={{ gridTemplateColumns: cols, animationDelay: `${i * 60}ms` }}
              >
                <span className="nums text-sm">{player ? String(rank).padStart(2, "0") : ""}</span>
                <span className={`truncate font-black tracking-tight ${many ? "text-xl" : "text-[1.75rem]"}`}>{player ? tla(row.name) : row.name}</span>
                <span className="flex items-center gap-1.5 font-mono text-sm font-bold">
                  <span aria-hidden className="h-4 w-1" style={{ backgroundColor: colourOf(row.driver_code) ?? "currentColor" }} />
                  {row.driver_code}
                </span>
                {laps.map((l) => {
                  const f = row.freezes.find((x) => x.lap === l);
                  return (
                    <span key={l} className="flex flex-col items-end leading-tight">
                      {f ? (
                        <>
                          <CallWord call={f.call} className="text-sm font-bold" />
                          <span className="nums text-xs">{f.total}</span>
                        </>
                      ) : (
                        <span className="nums text-xs text-ink-3">–</span>
                      )}
                    </span>
                  );
                })}
                <span className="nums text-right text-base">{player ? (row.audibles.length ? COPY.race.pts(aud) : "–") : ""}</span>
                <span className={`nums text-right font-bold ${many ? "text-xl" : "text-[1.75rem]"}`}>{row.total}</span>
              </div>
            );
          })}
        </div>
        <section className="flex min-h-0 flex-col overflow-hidden">
          <span className="meta border-b-2 border-ink pb-1">{COPY.race.audiblesTitle}</span>
          {audibles.length === 0 ? (
            <p className="mt-3 text-base text-ink-2">{COPY.race.noAudibles}</p>
          ) : (
            <ol className="flex flex-col">
              {audibles.slice(0, 10).map((a) => (
                <li key={`${a.player_name}-${a.lap}`} className="flex flex-col gap-0.5 border-b border-line py-2">
                  <span className="flex items-baseline justify-between gap-3">
                    <b className="font-bold">{COPY.race.audibleRow(tla(a.player_name), a.driver_code, a.lap)}</b>
                    <span className="nums font-bold">{a.status === "scored" ? COPY.race.pts(a.total) : "0"}</span>
                  </span>
                  <span className="font-mono text-xs">{COPY.race.audibleStatus[a.status] ?? a.status}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <p className="text-sm text-ink-2">{COPY.host.scoringRule(50)}</p>
    </main>
  );
}
