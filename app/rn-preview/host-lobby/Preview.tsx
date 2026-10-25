"use client";
// Dev-only preview of the T1a host lobby and replay views with real fixtures.
import { useState } from "react";
import type { BlindDecision, LobbyStateResponse, RaceEntry } from "@/lib/client/api";
import type { DataMode } from "@/lib/client/mode";
import type { RaceLobby } from "@/lib/client/raceLobby";
import type { LapFrame } from "@/lib/types";
import { RNHostLobby, RNRaceLobby } from "@/components/rn/host/lobby/RNLobby";
import { RNHostReplay, RNRaceReplay } from "@/components/rn/host/replay/RNReplay";
import decisionJson from "@/components/rn/host/lobby/fixtures/decision.json";
import framesJson from "@/components/rn/host/lobby/fixtures/frames.json";
import racesJson from "@/components/rn/host/lobby/fixtures/races.json";

const decision = decisionJson as unknown as BlindDecision;
const frames = framesJson as unknown as LapFrame[];
const races = racesJson as unknown as RaceEntry[];
const sg = races.find((r) => r.race_key === "2026-singapore") ?? races[0];

const NAMES = ["Vedant", "Maya", "Ekb", "Jordan", "Priya", "Sam", "Alexandria-Rose", "Tom", "Lee", "Noor", "Kai", "Bea"];
const CARS = ["HAM", "LEC", "GAS", "HAM", "NOR", "PIA"];
const players = (n: number) => NAMES.slice(0, n).map((name, i) => ({ name, joined_at: i, driver_code: CARS[i % CARS.length] }));
const colourOf = (c: string | null) => frames.at(-1)?.drivers.find((d) => d.code === c)?.team_colour ?? null;
const noop = async () => {};

function momentLobby(n: number, choose: boolean): LobbyStateResponse {
  return { code: "DCFH", players: players(n), driver_mode: choose ? "choose" : "same", driver_code: choose ? null : "HAM" } as unknown as LobbyStateResponse;
}
function raceLobby(n: number, choose: boolean, marks = false): RaceLobby {
  return {
    code: "DCFH",
    mode: "race",
    players: players(n),
    driver_mode: choose ? "choose" : "same",
    driver_code: choose ? null : "GAS",
    race: { race_key: sg.race_key, name: sg.name, total_laps: sg.total_laps, past_freeze_laps: marks ? [14, 22, 28] : [] },
  } as unknown as RaceLobby;
}

export function Preview({ state: raw }: { state: string }) {
  const state = raw.replace(/-adv$/, "");
  const [mode, setMode] = useState<DataMode>(raw.endsWith("-adv") ? "advanced" : "simple");
  const common = { code: "DCFH", colourOf, onKick: noop, mode, setMode };
  const join = { joinUrl: "outpacef1.vercel.app/play/DCFH", joinHref: "https://outpacef1.vercel.app/play/DCFH" };
  switch (state) {
    case "lobby0":
      return <RNHostLobby {...common} {...join} decision={decision} frames={frames} lobby={momentLobby(0, false)} players={[]} onStart={() => {}} />;
    case "lobby12":
      return <RNHostLobby {...common} {...join} decision={decision} frames={frames} lobby={momentLobby(12, true)} players={players(12)} onStart={() => {}} />;
    case "race-lobby":
      return <RNRaceLobby {...common} origin="https://outpacef1.vercel.app" race={raceLobby(6, false)} entry={sg} carFor={() => "GAS"} onStart={async () => "Could not start. Try again."} />;
    case "race-lobby-each":
      return (
        <RNRaceLobby
          {...common}
          origin="https://outpacef1.vercel.app"
          race={raceLobby(12, true)}
          entry={sg}
          carFor={(n) => players(12).find((p) => p.name === n)?.driver_code ?? null}
          onStart={async () => null}
        />
      );
    case "replay":
      return <RNHostReplay {...common} decision={decision} frames={frames} lap={30} onAdvance={() => {}} controls={null} />;
    case "replay-vsc":
      return <RNHostReplay {...common} decision={decision} frames={frames} lap={39} onAdvance={() => {}} controls={null} />;
    case "replay-empty":
      return <RNRaceReplay {...common} race={raceLobby(6, false, true)} frames={[]} lap={31} followed="GAS" controls={null} />;
    case "race-replay":
      return <RNRaceReplay {...common} race={raceLobby(6, false, true)} frames={frames} lap={31} followed="GAS" controls={null} />;
    default:
      return <RNHostLobby {...common} {...join} decision={decision} frames={frames} lobby={momentLobby(6, false)} players={players(6)} onStart={() => {}} />;
  }
}
