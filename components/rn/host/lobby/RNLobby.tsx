"use client";
// T1a: Race Night host lobby (mockup H02Lobby). RNLobbyView is the pure layout; RNHostLobby (moment) and
// RNRaceLobby (race) take the same props as the legacy Lobby / RaceLobbyView and map them onto it.
import { useEffect, useState, type ReactNode } from "react";
import { COPY } from "@/lib/copy";
import type { BlindDecision, LobbyStateResponse, RaceEntry } from "@/lib/client/api";
import type { DataMode } from "@/lib/client/mode";
import { raceCars, type RaceLobby } from "@/lib/client/raceLobby";
import { trackFor } from "@/lib/tracks";
import type { LapFrame } from "@/lib/types";
import { HostQr } from "@/components/host/HostQr";
import { carOf, carsInPlay } from "@/components/host/cars";
import { Label, Logo, ModeTabs, RNRoot, SkewButton, Slab } from "../../kit";
import { TrackMap } from "../../TrackMap";
import { LOBBY_COPY as L } from "./copy";
import "./lobby.css";

const MAX_PLAYERS = 12;

export interface RNLobbyViewProps {
  code: string;
  joinUrl: string;
  joinHref: string;
  players: { name: string }[];
  carFor: (name: string) => string | null;
  colourOf: (code: string | null) => string | null;
  onStart: () => Promise<unknown> | void;
  onKick: (name: string) => Promise<void>;
  mode: DataMode;
  setMode: (m: DataMode) => void;
  team: string | null; // slab colour; null = neutral (each-picks race lobby)
  trackId: string | null; // decision id or race key for the outline
  heading: string; // "Singapore 2026"
  sub: string; // "Marina Bay · 62 laps"
  carHeading: string; // "Everyone drives GAS" / "Each player picks a driver"
  carSub: string | null; // "Alpine #10" or the picks line
  note?: ReactNode; // error or replay note under the button
}

export function RNLobbyView(p: RNLobbyViewProps) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(null), 3000);
    return () => clearTimeout(id);
  }, [confirm]);
  const outline = trackFor(p.trackId);
  const neutral = !p.team;
  return (
    <RNRoot as="main" team={p.team} neutral={neutral} className="rnl">
      <Slab tone={neutral ? "neutral" : "team"} className="rnl-slab" />
      <header className="rnl-top">
        <Logo size="host" />
        <Label>{L.lobbyTag}</Label>
      </header>

      <section className="rnl-room">
        <Label>{COPY.host.roomCode}</Label>
        <h1 className="rnl-code" aria-label={COPY.room.heading(p.code)}>
          {p.code}
        </h1>
        <div className="rnl-join">
          <div className="rnl-qr">{p.joinHref ? <HostQr value={p.joinHref} size={220} label={COPY.room.scanAlt(p.joinUrl)} /> : <div className="rnl-qr-empty" />}</div>
          <div className="rnl-scan">
            <p className="rnl-scan-h">{L.scan}</p>
            <p className="rnl-scan-or">{L.orOpen}</p>
            <p className="rnl-scan-url">{p.joinUrl}</p>
          </div>
        </div>
        <p className="rnl-privacy">{L.privacy}</p>
      </section>

      <section className="rnl-grid" aria-label={COPY.host.players}>
        <div className="rnl-grid-head">
          <Label>{L.onTheGrid}</Label>
          <span className="rnl-count rn-num" aria-label={COPY.host.playersCount(p.players.length, MAX_PLAYERS)}>
            {L.gridCount(p.players.length, MAX_PLAYERS)}
          </span>
        </div>
        <ol className="rnl-list" data-dense={p.players.length > 8 || undefined}>
          {p.players.map((pl, i) => {
            const car = p.carFor(pl.name);
            const colour = p.colourOf(car);
            return (
              <li key={pl.name} className="rnl-row">
                <span className="rnl-pos rn-num">P{i + 1}</span>
                <span className="rnl-name">{pl.name}</span>
                {car && (
                  <span className="rnl-car rn-num">
                    <span aria-hidden className="rnl-tick" style={{ background: colour ?? "#5A5F68" }} />
                    {car}
                  </span>
                )}
                <button
                  type="button"
                  className="rnl-kick"
                  data-confirm={confirm === pl.name || undefined}
                  aria-label={confirm === pl.name ? COPY.host.confirmRemove : COPY.host.remove(pl.name)}
                  onClick={async () => {
                    if (confirm !== pl.name) return setConfirm(pl.name);
                    setConfirm(null);
                    await p.onKick(pl.name);
                  }}
                >
                  {confirm === pl.name ? COPY.host.confirmShort : COPY.host.removeShort}
                </button>
              </li>
            );
          })}
        </ol>
        {p.players.length < MAX_PLAYERS && (
          <p className="rnl-wait">
            <span aria-hidden className="rnl-dot" />
            {L.waiting}
          </p>
        )}
      </section>

      <section className="rnl-side" data-busy={(p.carSub?.length ?? 0) > 60 || p.heading.length > 22 || undefined}>
        <Label tone="ink">{L.race}</Label>
        <p className="rnl-race" data-long={p.heading.length > 22 || undefined}>
          {p.heading}
        </p>
        <p className="rnl-race-sub">{p.sub}</p>
        {outline && (
          <div className="rnl-map">
            <TrackMap track={outline} size="thumb" variant="silhouette" ink="var(--on-team)" width={200} ariaLabel={outline.name} />
          </div>
        )}
        <p className="rnl-drives">{p.carHeading}</p>
        {p.carSub && <p className="rnl-race-sub">{p.carSub}</p>}
      <div className="rnl-actions">
        <Label tone="ink" className="rnl-data-l">
          {L.dataOnScreen}
        </Label>
        <ModeTabs mode={p.mode} onChange={p.setMode} variant="split" />
        <SkewButton
          size="host"
          variant="dark"
          disabled={busy}
          aria-busy={busy || undefined}
          className="rnl-start"
          icon={null}
          onClick={async () => {
            setBusy(true);
            try {
              await p.onStart();
            } finally {
              setBusy(false);
            }
          }}
        >
          {COPY.waiting.hostButton}
          <span aria-hidden className="rnl-play">
            ▶
          </span>
        </SkewButton>
        {p.note && <p className="rnl-note">{p.note}</p>}
      </div>
      </section>
    </RNRoot>
  );
}

// ---- Moment lobby: same props as HostScreen.tsx Lobby.
const myCode = (frames: LapFrame[], n: number) => frames[frames.length - 1]?.drivers.find((d) => d.number === n);

export function RNHostLobby({
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
  const r = decision.player_role;
  const me = myCode(frames, r.number);
  const choose = lobby.driver_mode === "choose";
  const picks = carsInPlay(lobby);
  return (
    <RNLobbyView
      code={code}
      joinUrl={joinUrl}
      joinHref={joinHref}
      players={players}
      carFor={(name) => carOf(lobby, name)}
      colourOf={colourOf}
      onStart={onStart}
      onKick={onKick}
      mode={mode}
      setMode={setMode}
      team={choose ? null : (me?.team_colour ?? null)}
      trackId={decision.id}
      heading={decision.blind_title ?? decision.race}
      sub={COPY.host.replayNote(decision.replay_from_lap, decision.lap)}
      carHeading={choose ? COPY.race.lobbyChoose : L.everyoneDrives(me?.code ?? "")}
      carSub={
        choose
          ? picks.length
            ? picks.map((c) => COPY.host.drives(c, lobby.players.filter((p) => carOf(lobby, p.name) === c).map((p) => p.name))).join(" · ")
            : null
          : me
            ? `${me.team} #${me.number}`
            : COPY.host.carBand("", r.number)
      }
    />
  );
}

// ---- Race lobby: same props as RaceHost.tsx RaceLobbyView.
export function RNRaceLobby({
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
  const [err, setErr] = useState<string | null>(null);
  const joinUrl = origin ? `${origin.replace(/^https?:\/\//, "")}/play/${code}` : "";
  const joinHref = origin ? `${origin}/play/${code}` : "";
  const r = race.race;
  const same = race.driver_mode !== "choose";
  const car = same ? entry?.drivers.find((d) => d.code === race.driver_code) : null;
  const picks = raceCars(race);
  return (
    <RNLobbyView
      code={code}
      joinUrl={joinUrl}
      joinHref={joinHref}
      players={race.players}
      carFor={carFor}
      colourOf={colourOf}
      onStart={async () => setErr(await onStart())}
      onKick={onKick}
      mode={mode}
      setMode={setMode}
      team={same ? (car?.team_colour ?? null) : null}
      trackId={r.race_key}
      heading={r.name}
      sub={L.laps(r.total_laps)}
      carHeading={same ? L.everyoneDrives(car?.code ?? race.driver_code ?? "") : COPY.race.lobbyChoose}
      carSub={
        same
          ? car
            ? `${car.team} #${car.number}`
            : null
          : picks.length
            ? picks.map((c) => COPY.host.drives(c, race.players.filter((p) => carFor(p.name) === c).map((p) => p.name))).join(" · ")
            : COPY.race.pickWait
      }
      note={err ?? COPY.race.lobbyNote}
    />
  );
}
