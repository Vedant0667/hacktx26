"use client";
// Race Night phone replay (P04Replay): status strip, team slab with your position and tyre, ahead/behind gaps
// (F1 signs: minus = ahead), the track map, Simple/Advanced (Advanced adds the timing tower), and the dock:
// race lobbies get the Box now audible with its cooldown, moment lobbies the "decision coming" footer.
// RNReplay mirrors PlayScreen's Replay props; RNRaceReplay mirrors RacePlay's Replay props.
import "./phone.css";
import { useState, type FormEvent, type ReactNode } from "react";
import { COPY } from "@/lib/copy";
import { ApiError, api, type BlindDecision } from "@/lib/client/api";
import type { DataMode } from "@/lib/client/mode";
import { callMomentFrames, replayLap } from "@/lib/client/race";
import { numberOf, replayDecision, useAudibleCooldown, type RaceLobby } from "@/lib/client/raceLobby";
import { telemetry } from "@/lib/client/telemetry";
import { placeCars, trackFor } from "@/lib/tracks";
import type { LapFrame } from "@/lib/types";
import { Banner, GapValue, Label, Logo, ModeTabs, Num, RNRoot, SkewButton, TowerRow, TyreBadge } from "../kit";
import { TrackMap } from "../TrackMap";
import { RN_PHONE_COPY as C } from "./copy";

function lapTimeOf(f: LapFrame): number {
  const t = f.drivers.map((d) => d.lap_time_s).filter((x): x is number => x != null && x > 0);
  return t.length ? Math.min(...t) : 95;
}

function ReplayView({
  frame,
  seen,
  number,
  totalLaps,
  trackId,
  tele,
  mode,
  setMode,
  noCar,
  dock,
}: {
  frame: LapFrame;
  seen: LapFrame[];
  number: number | null;
  totalLaps: number;
  trackId: string | null | undefined;
  tele: ReturnType<typeof telemetry> | null;
  mode: DataMode;
  setMode: (m: DataMode) => void;
  noCar?: ReactNode;
  dock: ReactNode;
}) {
  const f = frame;
  const mine = number != null ? f.drivers.find((d) => d.number === number) : undefined;
  const sorted = [...f.drivers].sort((a, b) => a.position - b.position);
  const i = Math.max(0, sorted.findIndex((d) => d.number === number));
  const rows = 6;
  const start = Math.max(0, Math.min(sorted.length - rows, i - 2));
  const near = sorted.slice(start, start + rows);
  const outline = trackFor(trackId);
  const caution = f.track_status !== "GREEN";
  const ahead = tele?.gapAhead ?? null;
  const behind = tele?.gapBehind ?? null;
  const aheadCar = ahead ? f.drivers.find((d) => d.code === ahead.code) : undefined;
  const behindCar = behind ? f.drivers.find((d) => d.code === behind.code) : undefined;
  const placed = outline ? placeCars(f.drivers, { lapTimeS: lapTimeOf(f), leaderFraction: 0.1 }) : [];
  void seen;
  return (
    <RNRoot team={mine?.team_colour} neutral={!mine?.team_colour}>
      <main className="rnp">
        {caution ? (
          <Banner kind={f.track_status === "SC" ? "sc" : "vsc"} size="phone" />
        ) : (
          <div aria-hidden style={{ height: 6, background: "#22C55E", flexShrink: 0 }} />
        )}
        <header className="rnp-head">
          <Logo size="phone" />
          <span className="rnp-cond" style={{ fontSize: 18, fontWeight: 800 }} aria-label={COPY.phone.replayStatus(f.lap, totalLaps)}>
            {COPY.race.lapTag(f.lap, totalLaps)}
          </span>
        </header>
        <div className="rnp-hero" style={{ minHeight: 170, paddingTop: 26 }}>
          {mine ? (
            <>
              <span className="rnp-label" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                {mine.code}
                {mine.compound && <TyreBadge compound={mine.compound} age={mine.tyre_age} />}
              </span>
              <div className="rnp-cond" style={{ fontSize: 104, fontWeight: 900, lineHeight: 0.9, marginTop: 6 }}>
                P{mine.position}
              </div>
              <span className="sr-only">
                {COPY.phone.carLine(mine.number, mine.position, mine.compound ? (COPY.compounds[mine.compound] ?? mine.compound) : null, mine.tyre_age)}
              </span>
            </>
          ) : (
            <>
              <div className="rnp-cond" style={{ fontSize: 48, fontWeight: 900, lineHeight: 0.95 }}>
                {COPY.race.watching}
              </div>
              {noCar && <p style={{ marginTop: 8, fontSize: 15, fontWeight: 600 }}>{noCar}</p>}
            </>
          )}
        </div>
        <div className="rnp-body" style={{ paddingTop: 20, gap: 16 }}>
          {(ahead || behind) && (
            <div style={{ display: "grid", gridTemplateColumns: "90px 70px 1fr auto", alignItems: "center", rowGap: 10 }}>
              {ahead && (
                <>
                  <Label>{C.ahead}</Label>
                  <b className="rnp-cond" style={{ fontSize: 24, fontWeight: 900 }}>{ahead.code}</b>
                  <span>{aheadCar?.compound && <TyreBadge compound={aheadCar.compound} showAge={false} />}</span>
                  {ahead.now != null ? <GapValue delta={-Math.abs(ahead.now)} size={26} weight={900} /> : <span />}
                </>
              )}
              {behind && (
                <>
                  <Label>{C.behind}</Label>
                  <b className="rnp-cond" style={{ fontSize: 24, fontWeight: 900 }}>{behind.code}</b>
                  <span>{behindCar?.compound && <TyreBadge compound={behindCar.compound} showAge={false} />}</span>
                  {behind.now != null ? <GapValue delta={Math.abs(behind.now)} size={26} weight={900} /> : <span />}
                </>
              )}
            </div>
          )}
          {outline && (
            <TrackMap
              track={outline}
              cars={placed}
              followed={mine?.code ?? null}
              near={[ahead?.code, behind?.code].filter((x): x is string => !!x)}
              caution={caution}
              size="phone"
              ariaLabel={COPY.tele.title}
              style={{ alignSelf: "center", maxWidth: "100%" }}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Label>{COPY.tele.title}</Label>
            <ModeTabs mode={mode} onChange={setMode} />
          </div>
          {(mode === "advanced" || !outline) && (
            <ol>
              {near.map((d) => (
                <TowerRow
                  key={d.number}
                  size="phone"
                  pos={d.position}
                  code={d.code}
                  teamColour={d.team_colour}
                  gap={d.position === 1 ? COPY.replay.leader : d.gap_to_leader_s != null ? `+${d.gap_to_leader_s.toFixed(1)}` : ""}
                  compound={d.compound}
                  age={d.tyre_age}
                  me={d.number === number}
                />
              ))}
            </ol>
          )}
        </div>
        {dock}
      </main>
    </RNRoot>
  );
}

// Moment lobby replay: replaces PlayScreen's Replay (same props).
export function RNReplay({ decision, frames, elapsed, mode, setMode, me }: { decision: BlindDecision; frames: LapFrame[]; elapsed: number; mode: DataMode; setMode: (m: DataMode) => void; me: string }) {
  const lap = replayLap(decision, elapsed);
  const seen = callMomentFrames(frames, decision).filter((f) => f.lap <= lap);
  const f = seen[seen.length - 1];
  if (!f) return null;
  const tele = telemetry(seen, { ...decision, lap: f.lap }, mode === "advanced" ? 8 : 6);
  const togo = Math.max(0, decision.lap - lap);
  const progress = (lap - decision.replay_from_lap) / Math.max(1, decision.lap - decision.replay_from_lap);
  void me;
  return (
    <ReplayView
      frame={f}
      seen={seen}
      number={decision.player_role.number}
      totalLaps={decision.total_laps}
      trackId={decision.id}
      tele={tele}
      mode={mode}
      setMode={setMode}
      dock={
        <div className="rnp-foot" style={{ position: "relative" }}>
          <div className="rnp-bar" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} aria-hidden />
          <span style={{ fontSize: 19, fontWeight: 700, flex: 1 }}>{COPY.tele.decisionComing}</span>
          <Num value={COPY.tele.lapsToGo(togo)} size={18} weight={800} />
        </div>
      }
    />
  );
}

// Race lobby replay: replaces RacePlay's Replay (same props).
export function RNRaceReplay({ code, race, me, car, frames, lap, mode, setMode }: { code: string; race: RaceLobby; me: string; car: string | null; frames: LapFrame[]; lap: number; mode: DataMode; setMode: (m: DataMode) => void }) {
  const r = race.race;
  const f = frames.find((x) => x.lap === lap) ?? frames.at(-1);
  if (!f)
    return (
      <RNRoot neutral>
        <main className="rnp">
          <p style={{ padding: "96px 24px 0", fontSize: 18, fontWeight: 700 }}>{COPY.race.loading}</p>
        </main>
      </RNRoot>
    );
  const n = numberOf(frames, car);
  const seen = frames.filter((x) => x.lap <= f.lap);
  const tele = n != null ? telemetry(seen, replayDecision(r, n, f.lap), mode === "advanced" ? 8 : 6) : null;
  return (
    <ReplayView
      frame={f}
      seen={seen}
      number={n}
      totalLaps={r.total_laps}
      trackId={r.race_key}
      tele={tele}
      mode={mode}
      setMode={setMode}
      noCar={COPY.race.noCar}
      dock={
        car ? (
          <RNAudibleDock code={code} me={me} lap={f.lap} />
        ) : (
          <div className="rnp-foot">
            <span style={{ fontSize: 19, fontWeight: 700, flex: 1 }}>{COPY.race.watching}</span>
            <Label>{COPY.race.lapTag(f.lap, r.total_laps)}</Label>
          </div>
        )
      }
    />
  );
}

// The audible: same logic as RacePlay's AudibleDock (one per 5 laps, server next_lap drives the cooldown).
export function RNAudibleDock({ code, me, lap }: { code: string; me: string; lap: number }) {
  const [next, setNext] = useAudibleCooldown(code, me);
  const [why, setWhy] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cooling = next != null && lap < next;
  const left = cooling ? next - lap : 0;
  const GAP = 5;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (cooling || sending) return;
    setSending(true);
    setErr(null);
    try {
      const res = await api.audible(code, why.trim());
      setNext(res.next_lap);
      setNote(COPY.race.audible.sent(res.audible.lap));
      setWhy("");
      setTyping(false);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.status === 429 && typeof e2.body?.next_lap === "number") setNext(e2.body.next_lap);
      else if (e2 instanceof ApiError && e2.status === 409) setErr(COPY.race.audible.closed);
      else if (e2 instanceof ApiError && e2.status === 403) setErr(COPY.race.audible.notYou);
      else setErr(COPY.race.audible.failed);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="rnp-dock" style={{ marginTop: "auto" }} noValidate>
      {typing && (
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="audible-why" className="sr-only">
            {COPY.race.audible.whyLabel}
          </label>
          <input
            id="audible-why"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder={COPY.race.audible.whyPlaceholder}
            maxLength={400}
            enterKeyHint="send"
            autoFocus
            className="rnp-input"
          />
        </div>
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <SkewButton type="submit" variant="primary" size="phone" full disabled={cooling || sending} aria-busy={sending || undefined} sub={cooling ? COPY.race.freezeMark(next!) : undefined}>
            <span className="sr-only">{COPY.race.audible.title} </span>
            {sending ? COPY.race.audible.sending : COPY.race.audible.button}
            {!cooling && <span className="sr-only"> {COPY.race.audible.ready}</span>}
          </SkewButton>
          {cooling && (
            <div aria-hidden style={{ position: "absolute", left: 8, right: 8, bottom: -6, height: 4, background: "#1F232A" }}>
              <div style={{ height: 4, background: "var(--team)", width: `${Math.round(((GAP - left) / GAP) * 100)}%`, transition: "width .7s ease-out" }} />
            </div>
          )}
        </div>
        <SkewButton variant="secondary" size="phone-sm" onClick={() => setTyping((v) => !v)} aria-expanded={typing} aria-controls="audible-why">
          {typing ? COPY.race.audible.whyClose : COPY.race.audible.why}
        </SkewButton>
      </div>
      <div aria-live="polite" style={{ marginTop: 12, fontSize: 15, color: "#A9AEB8" }}>
        {err ? (
          <p className="rnp-err">{err}</p>
        ) : cooling ? (
          <p style={{ fontWeight: 700, color: "#fff" }}>
            {COPY.race.audible.cooldown(next!)} · {COPY.race.audible.lapsLeft(left)}
          </p>
        ) : note ? (
          <p style={{ fontWeight: 700, color: "#fff" }}>{note}</p>
        ) : (
          <p>{COPY.race.audible.hint}</p>
        )}
      </div>
    </form>
  );
}
