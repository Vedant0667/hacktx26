"use client";
// T1a: Race Night host replay (mockup H03Replay). RNReplayView is the pure layout; RNHostReplay (moment) and
// RNRaceReplay (race) take the same props as the legacy Replay / ReplayView.
import type { ReactNode } from "react";
import { COPY } from "@/lib/copy";
import type { BlindDecision } from "@/lib/client/api";
import type { DataMode } from "@/lib/client/mode";
import { callMomentFrames, frameAt } from "@/lib/client/race";
import { numberOf, type RaceLobby } from "@/lib/client/raceLobby";
import { lapTimeText } from "@/lib/client/telemetry";
import { leaderFractionFor, placeCars, trackFor } from "@/lib/tracks";
import type { LapFrame } from "@/lib/types";
import { Banner, GapValue, Label, Logo, OutlineNumber, RNRoot, RN_KIT_COPY, SkewButton, TowerRow, TyreBadge } from "../../kit";
import { TrackMap } from "../../TrackMap";
import { LOBBY_COPY as L } from "../lobby/copy";
import "./replay.css";

export interface RNReplayViewProps {
  code: string;
  title: string; // race name / blind title
  frame: LapFrame | null;
  total: number;
  followedNumber: number;
  trackId: string | null;
  mode: DataMode;
  controls: ReactNode; // mode toggle, mute, continue (from the container)
  onAdvance?: () => void; // moment replay: skip to the freeze
  progress: { from: number; to: number; marks: number[]; endLabel: string };
  line: ReactNode; // the race-control line under the map
  lineLabel?: string;
}

const statusText = (s: LapFrame["track_status"]) => (s === "SC" ? L.sc : s === "VSC" ? L.vsc : L.green);

export function RNReplayView(p: RNReplayViewProps) {
  const frame = p.frame;
  const drivers = frame ? [...frame.drivers].sort((a, b) => a.position - b.position) : [];
  const me = drivers.find((d) => d.number === p.followedNumber) ?? null;
  const myGap = me?.gap_to_leader_s ?? null;
  const idx = me ? drivers.indexOf(me) : -1;
  const ahead = idx > 0 ? drivers[idx - 1] : null;
  const behind = idx >= 0 && idx < drivers.length - 1 ? drivers[idx + 1] : null;
  const leaderLap = drivers[0]?.lap_time_s ?? null;
  const lapTimeS = leaderLap && leaderLap > 40 ? leaderLap : 100;
  const outline = trackFor(p.trackId);
  const placed = me && myGap != null ? placeCars(drivers, { lapTimeS, leaderFraction: leaderFractionFor(0.62, myGap, lapTimeS) }) : placeCars(drivers, { lapTimeS });
  const delta = (g: number | null) => (g == null || myGap == null ? null : g - myGap);
  const span = Math.max(1, p.progress.to - p.progress.from);
  const pct = (lap: number) => Math.max(0, Math.min(1, (lap - p.progress.from) / span)) * 100;
  const status = frame?.track_status ?? "GREEN";
  const caution = status === "SC" || status === "VSC";
  return (
    <RNRoot as="main" team={me?.team_colour ?? null} className="rnr" data-status={status}>
      {caution ? <Banner kind={status === "SC" ? "sc" : "vsc"} text={status === "SC" ? L.sc : L.vsc} className="rnr-banner" /> : <div aria-hidden className="rnr-green" />}
      <div aria-hidden className="rnr-slab" />
      {me && <OutlineNumber value={me.number} size={300} className="rnr-outline" />}

      <header className="rnr-top">
        <Logo size="host" />
        <Label className="rnr-title">
          {p.title} · {COPY.host.room(p.code)}
        </Label>
        <span className="rnr-controls">
          {p.controls}
          {p.onAdvance && (
            <SkewButton size="host-sm" variant="secondary" onClick={p.onAdvance}>
              {COPY.replay.skip}
            </SkewButton>
          )}
        </span>
      </header>

      <section className="rnr-tower" aria-label={L.tower}>
        <div className="rnr-tower-head">
          <Label>{L.pos}</Label>
          <Label>{me ? L.gapTo(me.code) : ""}</Label>
        </div>
        {drivers.map((d) => {
          const dl = delta(d.gap_to_leader_s);
          return (
            <TowerRow
              key={d.number}
              pos={d.position}
              code={d.code}
              teamColour={d.team_colour}
              compound={d.compound}
              me={d.number === p.followedNumber}
              size="host-sm"
              gap={d.number === p.followedNumber ? RN_KIT_COPY.you : <GapValue delta={dl} unit={false} />}
            />
          );
        })}
      </section>

      <section className="rnr-center">
        <div className="rnr-map">
          {outline && (
            <TrackMap
              track={outline}
              size="host-lg"
              cars={placed}
              followed={me?.code ?? null}
              near={[ahead?.code, behind?.code].filter((c): c is string => !!c)}
              labelled={drivers[0] && drivers[0].number !== p.followedNumber ? [drivers[0].code] : []}
              caution={caution}
              ariaLabel={outline.name}
            />
          )}
        </div>
        <div className="rnr-rc">
          <Label tone={caution ? "yellow" : "green"}>{p.lineLabel ?? L.raceControl}</Label>
          <p>
            <b>
              {L.lap} {frame?.lap ?? ""} · {statusText(status)}
            </b>
            {p.line ? <> · {p.line}</> : null}
          </p>
        </div>
        <div className="rnr-prog">
          <div className="rnr-prog-head">
            <Label>{p.progress.marks.length ? L.callsSoFar(p.progress.marks.length) : ""}</Label>
            <Label>{p.progress.endLabel}</Label>
          </div>
          <div className="rnr-bar" aria-hidden>
            <div className="rnr-fill" style={{ width: `${pct(frame?.lap ?? p.progress.from)}%` }} />
            {p.progress.marks.map((m) => (
              <span key={m} className="rnr-mark" style={{ left: `${pct(m)}%` }}>
                <span className="rn-num">L{m}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="rnr-side">
        <p className="rnr-lap rn-num">
          <span className="rnr-lap-l">{L.lap}</span> {frame?.lap ?? "–"}
          <span className="rnr-lap-t"> / {p.total}</span>
        </p>
        {me && (
          <>
            <Label tone="ink" className="rnr-follow">
              {L.following(me.team, me.number)}
            </Label>
            <p className="rnr-pos rn-num">
              P{me.position} <span>{me.code}</span>
            </p>
            <p className="rnr-tyre rn-num">
              <TyreBadge compound={me.compound} age={me.tyre_age} ageStyle={{ color: "var(--on-team)", fontWeight: 800 }} />
              {me.lap_time_s != null && (
                <span>
                  <span className="rnr-mut">{L.lastLap}</span> {lapTimeText(me.lap_time_s)}
                </span>
              )}
            </p>
            {[ahead, behind].map((d) =>
              d ? (
                <p key={d.number} className="rnr-near rn-num">
                  <b>{d.code}</b>
                  <TyreBadge compound={d.compound} showAge={false} />
                  <GapValue delta={delta(d.gap_to_leader_s)} size={24} />
                </p>
              ) : null,
            )}
          </>
        )}
      </section>
    </RNRoot>
  );
}

// ---- Moment replay: same props as HostScreen.tsx Replay.
export function RNHostReplay({
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
  controls: ReactNode;
}) {
  const seen = callMomentFrames(frames, decision);
  const frame = frameAt(seen, lap) ?? null;
  const me = frame?.drivers.find((d) => d.number === decision.player_role.number);
  const lapsToCall = decision.lap - lap;
  return (
    <RNReplayView
      code={code}
      title={decision.blind_title ?? decision.race}
      frame={frame}
      total={decision.total_laps}
      followedNumber={decision.player_role.number}
      trackId={decision.id}
      mode={mode}
      controls={controls}
      onAdvance={onAdvance}
      progress={{ from: decision.replay_from_lap, to: decision.lap, marks: [], endLabel: COPY.host.callAt(decision.lap) }}
      line={
        <>
          {me ? COPY.host.youAre(me.code, me.position) : ""} {COPY.host.callIn(lapsToCall)}
        </>
      }
    />
  );
}

// ---- Race replay: same props as RaceHost.tsx ReplayView.
export function RNRaceReplay({
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
  controls: ReactNode;
}) {
  const r = race.race;
  const frame = frames.find((f) => f.lap === lap) ?? frames.at(-1) ?? null;
  const n = numberOf(frames, followed) ?? -1;
  return (
    <RNReplayView
      code={code}
      title={r.name}
      frame={frame}
      total={r.total_laps}
      followedNumber={n}
      trackId={r.race_key}
      mode={mode}
      controls={controls}
      progress={{ from: 0, to: r.total_laps, marks: r.past_freeze_laps, endLabel: L.flagAt(r.total_laps) }}
      line={
        <>
          <b>{COPY.race.audible.title}.</b> {COPY.race.audible.hint}
        </>
      }
    />
  );
}
