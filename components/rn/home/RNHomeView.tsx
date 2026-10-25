"use client";
// Race Night host home (mockup H01): the builder on the dark ground (mode, race or moment cards with the real
// track outline, drivers) and the neutral slab on the right with the lobby you are about to create. Neutral page
// chrome: team colour appears only on the driver chip's tick. Join a room sits top right of the builder (first on
// phones). Pure presentation: state and actions come in as props (useHomeBuilder).
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { DriverMode } from "@/lib/client/api";
import { trackFor } from "@/lib/tracks";
import { Logo, OutlineNumber, RNRoot, SkewButton, Slab } from "../kit";
import { TrackMap } from "../TrackMap";
import { RN_HOME_COPY as C } from "./copy";
import "./home.css";

export type HomeMode = "race" | "moment";
export interface HomeCard {
  key: string; // race_key or decision id
  trackId: string; // for trackFor()
  title: string; // "Singapore 2026"
  sub: string; // "62 laps · 4 calls"
}
export interface HomeDriver {
  code: string;
  number: number;
  name: string;
  team: string;
  team_colour: string | null;
  meta: string | null; // "4 calls" or "P3"
  calls: number | null;
}
export interface RNHomeViewProps {
  mode: HomeMode;
  onMode: (m: HomeMode) => void;
  cards: HomeCard[] | "loading" | "error";
  selectedCard: string | null;
  onPickCard: (key: string) => void;
  driverMode: DriverMode;
  onDriverMode: (m: DriverMode) => void;
  drivers: HomeDriver[] | "loading" | "error";
  driverCode: string | null;
  onPickDriver: (code: string) => void;
  ready: boolean;
  busy: "create" | "join" | null;
  createErr: string | null;
  onCreate: (e?: FormEvent) => void;
  code: string;
  onCode: (code: string) => void;
  joinErr: string | null;
  onJoin: (e?: FormEvent) => void;
  dataError: string; // COPY.error.data
}

const STAGE_W = 1280;
const STAGE_H = 720;

// Host: scale the 1280-wide mockup stage to the window; the stage grows taller on taller windows.
function useStage(): { wide: boolean; scale: number; height: number } {
  const [s, setS] = useState({ wide: true, scale: 1, height: STAGE_H });
  useEffect(() => {
    const fit = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const wide = w >= 1024 && w > h;
      const scale = Math.min(w / STAGE_W, h / STAGE_H);
      setS({ wide, scale, height: Math.max(STAGE_H, h / scale) });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return s;
}

function Arrow({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <path d="M4 12h15M13 5.5l6.5 6.5-6.5 6.5" />
    </svg>
  );
}

function Opt({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="rnh-opt rn-d" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function StepNo({ n, label, white }: { n: string; label: string; white?: boolean }) {
  return (
    <span className="rnh-sn rn-d" data-white={white || undefined}>
      <span className="rn-num">{n}</span>
      {label}
    </span>
  );
}

function Thumb({ id, on }: { id: string; on: boolean }) {
  const t = trackFor(id);
  if (!t) return null;
  const [, , w, h] = t.viewBox.split(" ").map(Number);
  const width = Math.min(240, (164 * w) / h);
  return <TrackMap track={t} size="thumb" width={width} racingLine={on ? "#D5D8DE" : null} ariaLabel={t.name} />;
}

function Cards({ cards, selected, onPick, label, dataError }: { cards: RNHomeViewProps["cards"]; selected: string | null; onPick: (k: string) => void; label: string; dataError: string }) {
  if (cards === "loading") return <p className="rnh-note">{C.loadingRaces}</p>;
  if (cards === "error") return <p className="rnh-note">{dataError}</p>;
  return (
    <div role="group" aria-label={label} className="rnh-cards">
      {cards.map((c) => {
        const on = c.key === selected;
        return (
          <button key={c.key} type="button" className="rnh-card" aria-pressed={on} onClick={() => onPick(c.key)}>
            <span className="rnh-thumb">
              <Thumb id={c.trackId} on={on} />
            </span>
            <span className="rnh-cbody">
              <span className="rnh-ctitle rn-d">{c.title}</span>
              <span className="rnh-csub rn-num">{c.sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DriverChip({ drivers, code, onPick }: { drivers: HomeDriver[]; code: string | null; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const cur = drivers.find((d) => d.code === code) ?? null;
  return (
    <div ref={ref} className="rnh-chipwrap">
      <button type="button" className="rnh-chip" aria-label={C.driverChip(cur?.code ?? "")} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="rnh-tick" style={{ background: cur?.team_colour ?? "#A9AEB8" }} />
        <span className="rn-d rnh-chipcode">{cur?.code ?? "–"}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A9AEB8" strokeWidth="3" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div role="radiogroup" aria-label={C.pickerTitle} className="rnh-picker">
          {drivers.map((d) => (
            <button
              key={d.code}
              type="button"
              role="radio"
              aria-checked={d.code === code}
              className="rnh-pick"
              onClick={() => {
                onPick(d.code);
                setOpen(false);
              }}
            >
              <span className="rnh-tick" style={{ background: d.code === code ? (d.team_colour ?? "#A9AEB8") : "rgba(255,255,255,0.22)" }} />
              <span className="rn-d rnh-pcode">{d.code}</span>
              <span className="rnh-pname">{d.name}</span>
              {d.meta && <span className="rnh-pmeta rn-num">{d.meta}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function JoinForm({ p, phone }: { p: RNHomeViewProps; phone?: boolean }) {
  return (
    <form className="rnh-join" data-phone={phone || undefined} onSubmit={p.onJoin} noValidate>
      <label htmlFor="rnh-code" className="rnh-sn rn-d" data-white>
        {C.joinTitle}
      </label>
      <div className="rnh-joinrow">
        <input
          id="rnh-code"
          className="rnh-code rn-d"
          value={p.code}
          maxLength={4}
          placeholder="ABCD"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => p.onCode(e.target.value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 4))}
          aria-invalid={!!p.joinErr || undefined}
          aria-describedby="rnh-join-err"
        />
        <button type="submit" className="rnh-joinbtn" disabled={p.busy === "join"} aria-busy={p.busy === "join" || undefined}>
          <span>
            {C.join}
            <Arrow size={phone ? 22 : 18} />
          </span>
        </button>
      </div>
      <p id="rnh-join-err" role="alert" className="rnh-err">
        {p.joinErr}
      </p>
    </form>
  );
}

function Lobby({ p }: { p: RNHomeViewProps }) {
  const list = Array.isArray(p.drivers) ? p.drivers : [];
  const cur = list.find((d) => d.code === p.driverCode) ?? null;
  const same = p.driverMode === "same";
  return (
    <div className="rnh-lobby">
      <div className="rn-d rnh-ylbl">{C.yourLobby}</div>
      <div className="rn-d rnh-big" data-long={!same || undefined}>
        {same ? (cur?.code ?? "–") : C.chooseBig(list.length)}
      </div>
      <div className="rn-d rnh-line">{same ? (cur ? C.driverLine(cur.name, cur.team, cur.number) : " ") : C.chooseSub}</div>
    </div>
  );
}

function CreateButton({ p, phone }: { p: RNHomeViewProps; phone?: boolean }) {
  return (
    <>
      <SkewButton
        variant="dark"
        size={phone ? "phone" : "host"}
        full
        className="rnh-go"
        disabled={!p.ready || p.busy === "create"}
        aria-busy={p.busy === "create" || undefined}
        aria-describedby="rnh-create-err"
        onClick={() => p.onCreate()}
        align="start"
      >
        <span className="rnh-gorow">
          {p.busy === "create" ? C.creating : C.create}
          <Arrow size={phone ? 26 : 36} />
        </span>
      </SkewButton>
      <p id="rnh-create-err" role="alert" className="rnh-err rnh-err-ink">
        {p.createErr}
      </p>
    </>
  );
}

function Steps({ p }: { p: RNHomeViewProps }) {
  const list = Array.isArray(p.drivers) ? p.drivers : null;
  const stepLabel = p.mode === "race" ? C.step.race : C.step.moment;
  return (
    <>
      <div className="rnh-step rnh-s1">
        <StepNo n="01" label={C.step.mode} />
        <div role="group" aria-label={C.step.mode} className="rnh-opts">
          <Opt on={p.mode === "race"} onClick={() => p.onMode("race")}>
            {C.modes.race}
          </Opt>
          <Opt on={p.mode === "moment"} onClick={() => p.onMode("moment")}>
            {C.modes.moment}
          </Opt>
        </div>
        <span className="rnh-hint">{C.modeHint[p.mode]}</span>
      </div>
      <div className="rnh-s2">
        <div className="rnh-step">
          <StepNo n="02" label={stepLabel} white />
          <span className="rn-d rnh-h">{p.mode === "race" ? C.pickRace : C.pickMoment}</span>
        </div>
        <Cards cards={p.cards} selected={p.selectedCard} onPick={p.onPickCard} label={stepLabel} dataError={p.dataError} />
      </div>
      <div className="rnh-step rnh-s3">
        <StepNo n="03" label={C.step.drivers} />
        <div role="group" aria-label={C.step.drivers} className="rnh-opts">
          <Opt on={p.driverMode === "same"} onClick={() => p.onDriverMode("same")}>
            {C.driverModes.same}
          </Opt>
          <Opt on={p.driverMode === "choose"} onClick={() => p.onDriverMode("choose")}>
            {C.driverModes.choose}
          </Opt>
        </div>
        {p.driverMode === "same" &&
          (list ? <DriverChip drivers={list} code={p.driverCode} onPick={p.onPickDriver} /> : <span className="rnh-note">{p.drivers === "error" ? p.dataError : C.loadingDrivers}</span>)}
      </div>
    </>
  );
}

export function RNHomeView(p: RNHomeViewProps) {
  const { wide, scale, height } = useStage();
  const list = Array.isArray(p.drivers) ? p.drivers : [];
  const cur = p.driverMode === "same" ? (list.find((d) => d.code === p.driverCode) ?? null) : null;

  if (!wide) {
    return (
      <RNRoot neutral as="main" className="rnh-phone">
        <div className="rnh-ptop">
          <Logo size="phone" />
        </div>
        <JoinForm p={p} phone />
        <Steps p={p} />
        <div className="rnh-pslab">
          {cur && <OutlineNumber value={cur.number} size={150} style={{ position: "absolute", right: 12, top: 10, lineHeight: 0.8 }} />}
          <Lobby p={p} />
          <CreateButton p={p} phone />
        </div>
        <p className="rnh-foot">{C.footer}</p>
      </RNRoot>
    );
  }

  return (
    <RNRoot neutral as="main" className="rnh-host">
      <div className="rnh-stage" style={{ width: STAGE_W, height, transform: `scale(${scale})` }}>
        <Slab tone="neutral" style={{ left: 920, top: -40, width: 900, height: height + 80 }} />
        {cur && <OutlineNumber value={cur.number} size={250} style={{ position: "absolute", right: 56, top: 318, lineHeight: 0.8 }} />}
        <div className="rnh-logo">
          <Logo size="host" />
        </div>
        <JoinForm p={p} />
        <Steps p={p} />
        <p className="rnh-foot">{C.footer}</p>
        <Lobby p={p} />
        <div className="rnh-gowrap" style={{ top: height - 148 }}>
          <CreateButton p={p} />
        </div>
      </div>
    </RNRoot>
  );
}
