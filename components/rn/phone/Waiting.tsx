"use client";
// Race Night phone waiting (P03Waiting): team slab with the car code and outline number, the room list
// (you first-class, "Picking" for players without a car yet), Simple/Advanced, and the waiting dots.
// RNWaiting mirrors PlayScreen's Waiting props; RNRaceWaiting mirrors RacePlay's Waiting props.
import "./phone.css";
import type { ReactNode } from "react";
import { COPY } from "@/lib/copy";
import type { BlindDecision, LobbyStateResponse, RaceEntry } from "@/lib/client/api";
import type { DataMode } from "@/lib/client/mode";
import type { RaceLobby } from "@/lib/client/raceLobby";
import { Label, Logo, ModeTabs, OutlineNumber, RNRoot, RN_KIT_COPY } from "../kit";
import { RN_PHONE_COPY as C } from "./copy";

type Player = { name: string; driver_code?: string | null };

function WaitingView({
  code,
  me,
  team,
  carCode,
  carNumber,
  kicker,
  title,
  sub,
  players,
  fallbackCode,
  note,
  mode,
  setMode,
}: {
  code: string;
  me: string;
  team: string | null | undefined;
  carCode: string | null;
  carNumber: number | null;
  kicker: string;
  title: string;
  sub?: ReactNode;
  players: Player[];
  fallbackCode?: string | null;
  note?: ReactNode;
  mode: DataMode;
  setMode: (m: DataMode) => void;
}) {
  const slot = Math.max(1, players.findIndex((p) => p.name === me) + 1);
  return (
    <RNRoot team={team} neutral={!team}>
      <main className="rnp">
        <header className="rnp-head">
          <Logo size="phone" />
          <span className="rnp-room">{COPY.room.heading(code)}</span>
        </header>
        <div className="rnp-hero">
          {carNumber != null && <OutlineNumber value={carNumber} size={240} style={{ position: "absolute", right: -40, top: 40 }} />}
          <span className="rnp-label">{kicker}</span>
          <div className="rnp-cond" style={{ fontSize: carCode ? 112 : 56, fontWeight: 900, lineHeight: 0.9, marginTop: 10, overflowWrap: "anywhere" }}>
            {carCode ?? me}
          </div>
        </div>
        <div className="rnp-body" style={{ paddingTop: 28 }}>
          <h1 className="rnp-cond" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.05 }}>
            {title}
          </h1>
          {sub && <p style={{ marginTop: 6, fontSize: 15, color: "#A9AEB8" }}>{sub}</p>}
          <div className="rnp-row" style={{ marginTop: 18, borderBottomColor: "#2A2F37" }}>
            <Label>{C.room}</Label>
            <Label>{COPY.waiting.count(players.length)}</Label>
          </div>
          <ol>
            {players.map((p) => {
              const you = p.name === me;
              const car = p.driver_code || fallbackCode;
              return (
                <li key={p.name} className="rnp-row" aria-current={you || undefined}>
                  <span style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    {you && <Label>{RN_KIT_COPY.you}</Label>}
                  </span>
                  {car ? (
                    <span className="rnp-cond" style={{ fontSize: 22, fontWeight: 900, color: you && team ? "var(--team)" : undefined }}>
                      {car}
                    </span>
                  ) : (
                    <span style={{ fontSize: 15, fontWeight: 600, color: "#A9AEB8" }}>{C.picking}</span>
                  )}
                </li>
              );
            })}
          </ol>
          {note && <p style={{ marginTop: 16, fontSize: 15, color: "#A9AEB8" }}>{note}</p>}
          <div style={{ marginTop: "auto", paddingTop: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <Label>{C.dataOnPhone}</Label>
            <ModeTabs mode={mode} onChange={setMode} />
          </div>
        </div>
        <div className="rnp-foot" aria-live="polite">
          <span className="rnp-dots" aria-hidden>
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <span style={{ fontSize: 19, fontWeight: 700, flex: 1 }}>{COPY.tele.waitingHost}</span>
          <Label>{COPY.play.gridSlot(slot)}</Label>
        </div>
      </main>
    </RNRoot>
  );
}

// Moment lobby: replaces PlayScreen's Waiting. Extra props: code (PlayScreen has it), team colour (from
// lobby.players / drivers if known; falls back to neutral).
export function RNWaiting({
  code,
  lobby,
  decision,
  me,
  mode,
  setMode,
  teamColour,
  carCode,
}: {
  code: string;
  lobby: LobbyStateResponse;
  decision: BlindDecision | null;
  me: string;
  mode: DataMode;
  setMode: (m: DataMode) => void;
  teamColour?: string | null;
  carCode?: string | null;
}) {
  const role = decision?.player_role;
  const mine = lobby.players.find((p) => p.name === me);
  const code3 = carCode ?? mine?.driver_code ?? null;
  return (
    <WaitingView
      code={code}
      me={me}
      team={teamColour}
      carCode={code3}
      carNumber={role?.number ?? null}
      kicker={role ? C.carLabel(role.number, role.team) : COPY.play.youAre(me)}
      title={role ? `${COPY.play.youAre(me)}.` : COPY.play.youAre(me)}
      sub={decision?.blind_title}
      players={lobby.players}
      note={COPY.waiting.playerView}
      mode={mode}
      setMode={setMode}
    />
  );
}

// Race lobby: replaces RacePlay's Waiting. Extra prop: code (RacePlay has it).
export function RNRaceWaiting({
  code,
  race,
  me,
  driver,
  mode,
  setMode,
}: {
  code: string;
  race: RaceLobby;
  me: string;
  driver: RaceEntry["drivers"][number] | null;
  mode: DataMode;
  setMode: (m: DataMode) => void;
}) {
  return (
    <WaitingView
      code={code}
      me={me}
      team={driver?.team_colour}
      carCode={driver?.code ?? null}
      carNumber={driver?.number ?? null}
      kicker={driver ? C.carLabel(driver.number, driver.team) : COPY.play.youAre(me)}
      title={driver ? `${COPY.drivers.picked(driver.code)} #${driver.number}.` : COPY.play.youAre(me)}
      sub={
        <>
          {COPY.race.raceLine(race.race.name, race.race.total_laps)}
          {driver ? ` ${COPY.homeUi.previewRaceSub(driver.freeze_count)}` : ""}
        </>
      }
      players={race.players}
      fallbackCode={race.driver_code}
      note={
        <>
          <b style={{ color: "#fff" }}>{COPY.race.audible.title}.</b> {COPY.race.audible.hint}
        </>
      }
      mode={mode}
      setMode={setMode}
    />
  );
}
