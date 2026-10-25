"use client";
// Race Night host freeze (H04 Simple, H05 Advanced, H10 quick moment) and the calls-locked beat (H06).
// Drop-in for components/host/HostScreen.tsx Freeze: same props, same derived data (getBrief), same
// "Show the calls" behaviour. Presentation only. The stage is drawn at 1280x720 and scaled to the viewport.
import "./freeze.css";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { COPY } from "@/lib/copy";
import type { BlindDecision, LobbyStateResponse } from "@/lib/client/api";
import { CALL_WINDOW_S } from "@/lib/client/race";
import { carOf, carsInPlay } from "@/components/host/cars";
import type { DataMode } from "@/lib/client/mode";
import type { LapFrame } from "@/lib/types";
import { getBrief, type Brief } from "@/components/DecisionBrief";
import { leaderFractionFor, placeCars, trackFor } from "@/lib/tracks";
import { TrackMap } from "@/components/rn/TrackMap";
import { Banner, Countdown, GapValue, Label, Logo, ModeTabs, Num, OutlineNumber, RNRoot, RN_KIT_COPY, SkewButton, StartLights, TowerRow, TyreBadge } from "@/components/rn/kit";
import { FREEZE_COPY as C } from "./copy";

// ------------------------------------------------------------------------------------------------
// Stage scaling: one 1280x720 design, scaled to fit (1920x1080 = 1.5, 1440x900 = 1.125, 1366x768 = 1.067).

const W = 1280;
const H = 720;
function subscribe(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
// Snapshot as a string so useSyncExternalStore sees a stable value between resizes.
function useViewport(): [number, number] {
  const v = useSyncExternalStore(
    subscribe,
    () => `${window.innerWidth}x${window.innerHeight}`,
    () => `${W}x${H}`,
  );
  const [w, h] = v.split("x").map(Number);
  return [w, h];
}

// The stage fills the viewport (so the banner and the slab run edge to edge); the 1280x720 design frame
// sits centred inside it.
function Stage({ team, children, label, status }: { team: string | null; children: ReactNode; label: string; status: "GREEN" | "SC" | "VSC" }) {
  const [vw, vh] = useViewport();
  const s = Math.min(vw / W, vh / H);
  const sw = vw / s;
  const sh = vh / s;
  return (
    <RNRoot as="main" team={team} className="rnf-viewport" aria-label={label}>
      <div className="rnf-stage" style={{ width: sw, height: sh, transform: `scale(${s})` }}>
        <TopBanner status={status} />
        <div className="rnf-frame" style={{ left: (sw - W) / 2, top: (sh - H) / 2, width: W, height: H }}>
          {children}
        </div>
      </div>
    </RNRoot>
  );
}

function TopBanner({ status }: { status: "GREEN" | "SC" | "VSC" }) {
  if (status === "GREEN") return <Banner kind="green" text={COPY.mode.label} className="rnf-banner" />;
  return <Banner kind={status === "SC" ? "sc" : "vsc"} text={C.banner[status]} className="rnf-banner" />;
}

// ------------------------------------------------------------------------------------------------
// Props: identical to the legacy Freeze (components/host/HostScreen.tsx).

export interface RNFreezeProps {
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
  mute: ReactNode;
  why?: ReactNode;
  label?: string;
  carFor?: (name: string) => string | null;
}

type View = {
  brief: Brief;
  decision: BlindDecision;
  left: number;
  meCode: string;
  status: "GREEN" | "SC" | "VSC";
  label: string;
  players: { name: string }[];
  submitted: Set<string>;
  carFor?: (name: string) => string | null;
  why?: ReactNode;
  mode: DataMode;
  setMode: (m: DataMode) => void;
  controls: ReactNode;
};

export function RNFreeze(props: RNFreezeProps) {
  const { code, decision, lobby, frames, team, elapsed, players, submitted, onAdvance, mode, setMode, mute, why, label, carFor: carForProp } = props;
  const brief = getBrief(decision, frames);
  const left = Math.max(0, Math.ceil(CALL_WINDOW_S - elapsed / 1000));
  const me = brief.frame?.drivers.find((d) => d.number === decision.player_role.number);
  const waiting = Math.max(0, players.length - submitted.size);
  const allIn = players.length > 0 && waiting === 0;
  const [asked, setAsked] = useState(false);
  const status = brief.frame?.track_status ?? decision.trigger;
  const carFor = carForProp ?? (carsInPlay(lobby).length > 1 ? (name: string) => carOf(lobby, name) : undefined);
  const controls = (
    <div className="rnf-controls">
      {mute}
      <SkewButton
        variant="primary"
        size="host-sm"
        onClick={() => {
          setAsked(true);
          onAdvance();
        }}
      >
        {asked && !allIn && left > 0 ? COPY.host.callsIn(left) : COPY.freeze.showCalls}
      </SkewButton>
    </div>
  );
  const v: View = {
    brief,
    decision,
    left,
    meCode: me?.code ?? "",
    status,
    label: (label ?? COPY.host.statusLong(decision.trigger, decision.lap, decision.total_laps)) + ` · ${COPY.host.room(code)}`,
    players,
    submitted,
    carFor,
    why,
    mode,
    setMode,
    controls,
  };
  return (
    <Stage team={team} label={COPY.freeze.question} status={status}>
      {mode === "advanced" ? <Advanced {...v} /> : <Simple {...v} />}
    </Stage>
  );
}

// ------------------------------------------------------------------------------------------------
// Shared pieces

function CalledLine({ players, submitted, left, carFor, inline }: Pick<View, "players" | "submitted" | "left" | "carFor"> & { inline?: boolean }) {
  const owing = players.filter((p) => !submitted.has(p.name)).map((p) => p.name);
  const n = players.length - owing.length;
  return (
    <div className={inline ? "rnf-called rnf-called-inline" : "rnf-called"}>
      <span className="rn-d rnf-called-n">{C.calledOf(n, players.length)}</span>
      <span className="rnf-called-sub">{left === 0 ? COPY.freeze.timeUp : C.waitingNames(owing)}</span>
      <ul className="rnf-sr">
        {players.map((p) => (
          <li key={p.name}>
            {COPY.host.playerState(p.name, submitted.has(p.name))}
            {carFor ? ` ${carFor(p.name) ?? ""}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function lapTimeOf(frame: LapFrame | undefined): number {
  const ts = (frame?.drivers ?? []).map((d) => d.lap_time_s).filter((x): x is number => typeof x === "number" && x > 0).sort((a, b) => a - b);
  return ts.length ? ts[Math.floor(ts.length / 2)] : 100;
}

function FreezeMap({ brief, decision, meCode, size, width }: { brief: Brief; decision: BlindDecision; meCode: string; size: "host" | "host-sm"; width: number }) {
  const outline = trackFor(decision.id) ?? trackFor(decision.race);
  const f = brief.frame;
  if (!outline || !f) return null;
  const lap = lapTimeOf(f);
  const me = f.drivers.find((d) => d.code === meCode);
  const leaderFraction = me?.gap_to_leader_s != null ? leaderFractionFor(0.22, me.gap_to_leader_s, lap) : 0;
  const cars = placeCars(f.drivers, { lapTimeS: lap, leaderFraction });
  const n = brief.tele?.neighbours;
  const near = [n?.ahead?.code, n?.behind?.code].filter((x): x is string => !!x);
  const rj = brief.rejoin;
  const ghost = rj ? { fraction: placeCars([{ code: "_", gap_to_leader_s: rj.gapToLeader }], { lapTimeS: lap, leaderFraction })[0]?.fraction ?? 0, label: C.ghost(rj.pos) } : null;
  const labelled = rj?.ahead?.code && !near.includes(rj.ahead.code) ? [rj.ahead.code] : [];
  return (
    <TrackMap
      track={outline}
      cars={cars}
      followed={meCode}
      near={near}
      labelled={labelled}
      ghost={ghost}
      caution={f.track_status !== "GREEN"}
      size={size}
      width={width}
      pulse
      ariaLabel={C.mapLabel(meCode)}
    />
  );
}

function Spark({ t, w, h }: { t: NonNullable<Brief["tele"]>; w: number; h: number }) {
  const pts = t.laps.map((lap, i) => ({ lap, v: t.me.times[i] })).filter((p): p is { lap: number; v: number } => p.v != null);
  if (pts.length < 2) return null;
  const vs = pts.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const x = (i: number) => 8 + (i / (pts.length - 1)) * (w - 16);
  const y = (v: number) => (hi === lo ? h / 2 : 8 + (1 - (v - lo) / (hi - lo)) * (h - 22));
  const best = vs.indexOf(lo);
  const last = pts.length - 1;
  const caution = t.status[t.callLap] && t.status[t.callLap] !== "GREEN";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="rnf-spark">
      {caution && <rect x={w - 26} y={0} width={26} height={h - 12} fill="rgba(255,212,59,0.18)" />}
      <polyline points={pts.slice(0, last).map((p, i) => `${x(i)},${y(p.v)}`).join(" ")} fill="none" stroke="#fff" strokeWidth={2} />
      <line x1={x(last - 1)} y1={y(pts[last - 1].v)} x2={x(last)} y2={y(pts[last].v)} stroke="#FFD43B" strokeWidth={2} strokeDasharray="4 3" />
      {pts.map((p, i) => (
        <circle key={p.lap} cx={x(i)} cy={y(p.v)} r={i === last ? 5 : 3.5} fill={i === best ? "#A855F7" : i === last ? "#FFD43B" : i >= last - 2 ? "#E8B92E" : "#fff"} />
      ))}
      <text x={x(0)} y={h - 1} className="rnf-spark-t">
        L{pts[0].lap}
      </text>
      <text x={w - 2} y={h - 1} textAnchor="end" className="rnf-spark-t">
        L{pts[last].lap}
        {caution ? ` ${t.status[t.callLap]}` : ""}
      </text>
    </svg>
  );
}

function Trend({ rate }: { rate: number | null }) {
  if (rate == null) return <span className="rnf-trend" />;
  const closing = rate < 0;
  return (
    <span className="rnf-trend" data-closing={closing}>
      {closing ? "▼" : "▲"} {Math.abs(rate).toFixed(1)}
      <span className="rn-u">{C.perLap}</span>
    </span>
  );
}

function NeighbourRows({ t }: { t: NonNullable<Brief["tele"]> }) {
  const n = t.neighbours;
  const rows = [
    n.ahead && { pos: n.me.pos - 1, code: n.ahead.code, colour: t.ahead?.colour, compound: n.ahead.compound, age: n.ahead.age, delta: t.gapAhead?.now != null ? -Math.abs(t.gapAhead.now) : null, rate: t.gapAhead?.rate ?? null },
    n.behind && { pos: n.me.pos + 1, code: n.behind.code, colour: t.behind?.colour, compound: n.behind.compound, age: n.behind.age, delta: t.gapBehind?.now != null ? Math.abs(t.gapBehind.now) : null, rate: t.gapBehind?.rate ?? null },
  ].filter(Boolean) as { pos: number; code: string; colour: string | null | undefined; compound: string | null; age: number | null; delta: number | null; rate: number | null }[];
  return (
    <div className="rnf-nrows">
      {rows.map((r) => (
        <div key={r.code} className="rnf-nrow rn-num">
          <span className="rn-d rnf-np">P{r.pos}</span>
          <span className="rnf-tick" style={{ background: r.colour ?? "#5A5F68" }} />
          <span className="rn-d rnf-nc">{r.code}</span>
          <TyreBadge compound={r.compound} age={r.age} ageStyle={{ fontWeight: 700 }} />
          <GapValue delta={r.delta} size={17} className="rnf-ng" />
          <Trend rate={r.rate} />
        </div>
      ))}
    </div>
  );
}

function Options({ brief, layout }: { brief: Brief; layout: "row" | "stack" }) {
  const { ctx, rejoin, story } = brief;
  if (!ctx) return null;
  const behind = ctx.behind !== "–" ? brief.frame?.drivers.find((d) => d.position === ctx.pos + 1) : null;
  const stay = COPY.host.stayLine(ctx.pos, behind ? { code: behind.code, gap: ctx.behind } : null);
  const box = rejoin ? COPY.host.boxLine(rejoin.pos, story?.lapsLeft ?? 0) : COPY.story.boxTyres;
  return (
    <div className="rnf-opts" data-layout={layout}>
      <div className="rnf-opt" data-tone="dark">
        <span className="rnf-cs">
          <b className="rn-d">{COPY.freeze.options.STAY}</b>
          <span className="rnf-opt-sub">{stay}</span>
        </span>
      </div>
      <div className="rnf-opt" data-tone="light">
        <span className="rnf-cs">
          <b className="rn-d">{COPY.freeze.options.BOX}</b>
          <span className="rnf-opt-sub">{box}</span>
        </span>
      </div>
    </div>
  );
}

function Headline({ v, cls }: { v: View; cls: string }) {
  return (
    <h1 className={`rn-d ${cls}`}>
      {C.headline(v.meCode, v.brief.ctx?.pos)} <span className="rnf-h-q">{COPY.freeze.question}</span>
    </h1>
  );
}

// ------------------------------------------------------------------------------------------------
// Simple (H04)

function Simple(v: View) {
  const t = v.brief.tele;
  const f = v.brief.frame;
  return (
    <div className="rnf-simple">
      <div className="rn-slab rnf-slab-s" aria-hidden />
      <Logo className="rnf-logo" />
      <div className="rnf-s-clock">
        <StartLights left={v.left} size="host" />
        <div className="rnf-s-cl">
          <Countdown left={v.left} size="host" />
          <CalledLine players={v.players} submitted={v.submitted} left={v.left} carFor={v.carFor} />
        </div>
      </div>
      <div className="rnf-s-q">
        <Label>{v.label}</Label>
        <Headline v={v} cls="rnf-h-s" />
        {v.why ? <div className="rnf-why">{v.why}</div> : null}
      </div>
      <section className="rnf-panel rnf-s-panel">
        <div className="rnf-s-map">
          <FreezeMap brief={v.brief} decision={v.decision} meCode={v.meCode} size="host" width={352} />
        </div>
        <div className="rnf-rc">
          <Label tone="yellow">{C.raceControl}</Label>
          <b>{C.rcLine[v.status]}</b>
          <span className="rnf-muted">{C.rcLap(f?.lap ?? v.decision.lap)}</span>
        </div>
        <ModeTabs mode={v.mode} onChange={v.setMode} variant="underline" className="rnf-s-tabs" />
        {t && (
          <>
            <div className="rnf-s-gaps">
              <Label>{C.gapTo(v.meCode)}</Label>
              <NeighbourRows t={t} />
            </div>
            <div className="rnf-s-lap">
              <Label>{C.lapTime(t.deg.delta)}</Label>
              <Spark t={t} w={196} h={70} />
            </div>
          </>
        )}
      </section>
      <div className="rnf-s-opts">
        <Options brief={v.brief} layout="row" />
      </div>
      <div className="rnf-s-ctl">{v.controls}</div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Advanced (H05)

function Advanced(v: View) {
  const t = v.brief.tele;
  const f = v.brief.frame;
  const meNum = v.decision.player_role.number;
  const mePos = v.brief.ctx?.pos ?? 0;
  const meGap = f?.drivers.find((d) => d.number === meNum)?.gap_to_leader_s ?? null;
  const tower = (f?.drivers ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .filter((d) => Math.abs(d.position - mePos) <= 3);
  const loss = v.brief.loss;
  const uc = t?.undercut[0] ?? null;
  const counts = { S: 0, M: 0, H: 0, I: 0, W: 0 } as Record<string, number>;
  for (const d of f?.drivers ?? []) {
    const l = (d.compound ?? "").charAt(0).toUpperCase();
    if (l in counts) counts[l] += 1;
  }
  const total = f?.drivers.length ?? 0;
  return (
    <div className="rnf-adv">
      <div className="rn-slab rnf-slab-a" aria-hidden />
      <Logo className="rnf-logo" />
      <div className="rnf-a-clock">
        <StartLights left={v.left} size="host-sm" />
        <Countdown left={v.left} size="host-md" />
      </div>
      <div className="rnf-a-q">
        <Label>{v.label}</Label>
        <Headline v={v} cls="rnf-h-a" />
        <CalledLine players={v.players} submitted={v.submitted} left={v.left} carFor={v.carFor} inline />
      </div>
      <div className="rnf-a-opts">
        <Options brief={v.brief} layout="stack" />
      </div>
      <div className="rnf-a-cols">
        <section className="rnf-col">
          <div className="rnf-sec-h">
            <Label>{C.timing}</Label>
            <span className="rnf-meta">{C.gapToMe(v.meCode)}</span>
          </div>
          {tower.map((d) => (
            <TowerRow
              key={d.number}
              pos={d.position}
              code={d.code}
              teamColour={d.team_colour}
              compound={d.compound}
              me={d.number === meNum}
              size="host-sm"
              gap={d.number === meNum ? RN_KIT_COPY.you : <GapValue delta={d.gap_to_leader_s != null && meGap != null ? d.gap_to_leader_s - meGap : null} unit={false} />}
            />
          ))}
          <div className="rnf-sec-h rnf-mt">
            <Label>{C.fieldTyres}</Label>
            <span className="rnf-meta">{C.cars(total)}</span>
          </div>
          <div className="rnf-tyrebar">
            {(["S", "M", "H", "I", "W"] as const).map((k) => (counts[k] ? <span key={k} data-c={k} style={{ flex: counts[k] }} /> : null))}
          </div>
          <div className="rnf-tyrecounts">
            {(["S", "M", "H", "I", "W"] as const).map((k) =>
              counts[k] ? (
                <span key={k}>
                  <TyreBadge compound={{ S: "SOFT", M: "MEDIUM", H: "HARD", I: "INTERMEDIATE", W: "WET" }[k]} showAge={false} />
                  <Num value={counts[k]} size={17} />
                </span>
              ) : null,
            )}
          </div>
        </section>
        <section className="rnf-col">
          {uc && (
            <div className="rnf-uc">
              <div className="rnf-sec-h">
                <Label tone="white">{C.undercut}</Label>
                {Math.abs(uc.boxNow) < 1 && <Label tone="yellow">{C.veryTight}</Label>}
              </div>
              <div className="rnf-uc-v">
                <Num value={`${uc.boxNow >= 0 ? "+" : "−"}${Math.abs(uc.boxNow).toFixed(1)}`} size={60} weight={900} style={{ color: "#FFD43B" }} />
                <span>{C.boxNowGap(uc.code)}</span>
              </div>
              <p className="rnf-small">
                {COPY.tele.ucUntil(uc.lapsUntilUndercut)} {C.outLap}
              </p>
            </div>
          )}
          {loss && (
            <div className="rnf-block">
              <div className="rnf-sec-h">
                <Label>{C.pitLoss}</Label>
                {loss.normal > loss.under && <span className="rnf-meta">{C.cheaper(loss.normal - loss.under)}</span>}
              </div>
              {[
                { k: C.lossNow[v.status], s: loss.under, c: "#FFD43B" },
                { k: C.green, s: loss.normal, c: "#5A5F68" },
              ].map((r) => (
                <div key={r.k} className="rnf-bar">
                  <span>{r.k}</span>
                  <span className="rnf-bar-track">
                    <span style={{ width: `${(r.s / Math.max(loss.normal, loss.under)) * 100}%`, background: r.c }} />
                  </span>
                  <Num value={r.s.toFixed(1)} unit="s" size={17} />
                </div>
              ))}
            </div>
          )}
          {t && (
            <div className="rnf-block">
              <div className="rnf-sec-h">
                <Label>{C.intervals}</Label>
              </div>
              {[
                { k: C.ahead, code: t.neighbours.ahead?.code, d: t.gapAhead?.now != null ? -Math.abs(t.gapAhead.now) : null, r: t.gapAhead?.rate ?? null },
                { k: C.behind, code: t.neighbours.behind?.code, d: t.gapBehind?.now != null ? Math.abs(t.gapBehind.now) : null, r: t.gapBehind?.rate ?? null },
              ]
                .filter((r) => r.code)
                .map((r) => (
                  <div key={r.k} className="rnf-int">
                    <span className="rnf-muted">{r.k}</span>
                    <span className="rn-d rnf-nc">{r.code}</span>
                    <GapValue delta={r.d} size={17} />
                    <Trend rate={r.r} />
                  </div>
                ))}
            </div>
          )}
        </section>
        <section className="rnf-col">
          {t && (
            <div className="rnf-block rnf-block-top">
              <div className="rnf-sec-h">
                <Label>{C.lapTime(t.deg.delta)}</Label>
              </div>
              <Spark t={t} w={244} h={80} />
            </div>
          )}
          <div className="rnf-block">
            <div className="rnf-sec-h">
              <Label tone="yellow">{C.raceControl}</Label>
              <span className="rnf-meta">{C.rcLap(f?.lap ?? v.decision.lap)}</span>
            </div>
            <b className="rnf-rc-b">{C.rcLine[v.status]}</b>
            <span className="rnf-small">{C.rcGaps(Math.max(1, v.decision.lap - 1))}</span>
          </div>
          {v.why ? <div className="rnf-why rnf-why-a">{v.why}</div> : null}
        </section>
      </div>
      <section className="rnf-panel rnf-a-panel">
        <FreezeMap brief={v.brief} decision={v.decision} meCode={v.meCode} size="host-sm" width={300} />
        <ModeTabs mode={v.mode} onChange={v.setMode} variant="underline" className="rnf-a-tabs" />
      </section>
      <div className="rnf-a-ctl">{v.controls}</div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Calls locked (H06). Replaces RaceHost's Locked ({ left, onResume }); the extra props are optional
// context the container already has (the freeze's decision + frames, players, team colour, label).

export interface RNLockedProps {
  left: number;
  onResume: () => void;
  team?: string | null;
  label?: string;
  players?: { name: string }[];
  called?: string[];
  decision?: BlindDecision;
  frames?: LapFrame[];
  holdS?: number;
}

export function RNLocked({ left, onResume, team = null, label, players = [], called, decision, frames, holdS = 8 }: RNLockedProps) {
  const brief = decision && frames ? getBrief(decision, frames) : null;
  const me = brief?.frame?.drivers.find((d) => d.number === decision?.player_role.number);
  const status = brief?.frame?.track_status ?? decision?.trigger ?? "GREEN";
  const lockedN = called ? called.length : players.length;
  const pct = holdS > 0 ? Math.max(0, Math.min(1, 1 - left / holdS)) : 1;
  return (
    <Stage team={team} label={C.lockedTitle} status={status}>
      <div className="rnf-locked">
        <div className="rn-slab rnf-slab-l" aria-hidden />
        {decision && <OutlineNumber value={decision.player_role.number} size={240} stroke="rgba(7,8,10,0.22)" style={{ position: "absolute", right: 56, top: 70 }} />}
        <Logo className="rnf-logo" />
        <div className="rnf-l-head">
          {label && <Label>{label}</Label>}
          <h1 className="rn-d rnf-l-h">{C.lockedTitle}</h1>
          <p className="rn-d rnf-l-sub">{C.answersAt}</p>
        </div>
        {players.length > 0 && (
          <div className="rnf-l-who">
            <span className="rn-d rnf-l-n">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <rect x="5" y="11" width="14" height="10" rx="1" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              {C.lockedCount(lockedN, players.length)}
            </span>
            <p className="rnf-l-names">{players.map((p) => p.name).join(" · ")}</p>
          </div>
        )}
        <div className="rnf-l-foot">
          <div className="rnf-l-row">
            <span className="rn-d rnf-l-resume">{COPY.end.lockedIn(left)}</span>
            <SkewButton variant="secondary" size="host-sm" onClick={onResume}>
              {COPY.race.resumeNow}
            </SkewButton>
          </div>
          <div className="rnf-l-prog" aria-hidden>
            <span style={{ width: `${pct * 100}%` }} />
          </div>
        </div>
        {brief && decision && me && (
          <section className="rnf-panel rnf-l-panel">
            <FreezeMap brief={brief} decision={decision} meCode={me.code} size="host" width={320} />
            <div className="rnf-l-cap">
              <span className="rn-d">{C.headline(me.code, me.position).replace(".", "")}</span>
              {brief.story && <span className="rnf-muted">{C.lapsLeft(status === "GREEN" ? C.green : status, brief.story.lapsLeft)}</span>}
            </div>
          </section>
        )}
      </div>
    </Stage>
  );
}

