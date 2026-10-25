"use client";
// Development-only preview of the Race Night phone views (?s=join|pick|waiting|racewait).
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BlindDriver, LobbyStateResponse } from "@/lib/client/api";
import type { DataMode } from "@/lib/client/mode";
import type { RaceLobby } from "@/lib/client/raceLobby";
import { RNJoinForm } from "@/components/rn/phone/JoinForm";
import { RNRaceWaiting, RNWaiting } from "@/components/rn/phone/Waiting";
import { RNRaceReplay } from "@/components/rn/phone/Replay";
import { RNNoCall } from "@/components/rn/phone/NoCall";
import type { BlindFreeze } from "@/lib/client/api";
import type { LapFrame } from "@/lib/types";

const field = [
  ["VER", 1, "#3671C6"], ["NOR", 4, "#FF8000"], ["LEC", 16, "#E8002D"], ["HAM", 44, "#E8002D"], ["RUS", 63, "#27F4D2"],
  ["PIA", 81, "#FF8000"], ["ALO", 14, "#229971"], ["SAI", 55, "#64C4FF"], ["HUL", 27, "#B6BABD"], ["GAS", 10, "#2293D1"], ["BEA", 87, "#B6BABD"], ["OCO", 31, "#B6BABD"],
] as const;
const frames: LapFrame[] = Array.from({ length: 31 }, (_, k) => ({
  lap: k + 1,
  track_status: "GREEN",
  drivers: field.map(([code, number, colour], i) => ({
    code, number, team: "", team_colour: colour, position: i + 1,
    gap_to_leader_s: i === 0 ? 0 : i * 2.3 + (i === 9 ? 0.4 : 0),
    compound: i % 3 === 0 ? "HARD" : "SOFT", tyre_age: (k % 12) + 1, pitted_this_lap: false, lap_time_s: 98 + i * 0.05 + (k % 3) * 0.1,
  })),
})) as unknown as LapFrame[];
const raceFull = {
  players: [{ name: "Vedant", driver_code: "GAS" }, { name: "Maya", driver_code: "LEC" }, { name: "Ekb", driver_code: "NOR" }, { name: "Jordan", driver_code: "VER" }, { name: "Priya", driver_code: "LEC" }, { name: "Sam", driver_code: "HAM" }],
  driver_code: null,
  race: { name: "Singapore Grand Prix", race_key: "singapore-2023", total_laps: 62, calls_needed: ["LEC"], called: [], freeze_index: 1, freeze_count: 4, freeze_lap: 18, segment_start_lap: 1 },
} as unknown as RaceLobby;
const freeze = { LEC: { driver_code: "LEC", lap: 18, blind_title: "", triggers: [{ type: "RIVAL_STOP", info: "Rival stopped nearby" }] } as unknown as BlindFreeze };

const drivers: BlindDriver[] = [
  { code: "GAS", number: 10, name: "Pierre Gasly", team: "Alpine", team_colour: "#2293D1", blind_title: "" },
  { code: "NOR", number: 4, name: "Lando Norris", team: "McLaren", team_colour: "#FF8000", blind_title: "" },
  { code: "LEC", number: 16, name: "Charles Leclerc", team: "Ferrari", team_colour: "#E8002D", blind_title: "" },
  { code: "VER", number: 1, name: "Max Verstappen", team: "Red Bull Racing", team_colour: "#3671C6", blind_title: "" },
  { code: "HAM", number: 44, name: "Lewis Hamilton", team: "Ferrari", team_colour: "#E8002D", blind_title: "" },
  { code: "RUS", number: 63, name: "George Russell", team: "Mercedes", team_colour: "#27F4D2", blind_title: "" },
];
const players = [
  { name: "Vedant", driver_code: "GAS" },
  { name: "Maya", driver_code: "LEC" },
  { name: "Ekb", driver_code: "NOR" },
  { name: "Jordan", driver_code: "VER" },
  { name: "Priya", driver_code: null },
];
const lobby = { players } as unknown as LobbyStateResponse;
const race = { players, driver_code: null, race: { name: "Las Vegas Grand Prix", total_laps: 50 } } as unknown as RaceLobby;

export function PhonePreview() {
  const s = useSearchParams().get("s") ?? "join";
  const [mode, setMode] = useState<DataMode>("simple");
  const noop = () => {};
  if (s === "join") return <RNJoinForm code="DCFH" players={4} choose={false} drivers={null} frames={null} initialName="Vedant" onRemoved={noop} onJoined={noop} />;
  if (s === "pick")
    return (
      <RNJoinForm
        code="DCFH"
        players={4}
        choose
        drivers={drivers}
        frames={null}
        initialName="Vedant"
        onRemoved={noop}
        onJoined={noop}
        metaFor={(c) => `${(c.charCodeAt(0) % 4) + 2} calls`}
        pickers={players}
      />
    );
  if (s === "waiting")
    return <RNWaiting code="DCFH" lobby={lobby} decision={null} me="Vedant" mode={mode} setMode={setMode} teamColour="#2293D1" carCode="GAS" />;
  if (s === "replay" || s === "replayadv")
    return <RNRaceReplay code="PREV" race={raceFull} me="Vedant" car="GAS" frames={frames} lap={31} mode={s === "replayadv" ? "advanced" : mode} setMode={setMode} />;
  if (s === "nocall") return <RNNoCall race={raceFull} me="Vedant" car="GAS" freeze={freeze} loading={false} left={21} teamColour="#2293D1" />;
  return <RNRaceWaiting code="DCFH" race={race} me="Vedant" driver={{ ...drivers[0], freeze_count: 4 }} mode={mode} setMode={setMode} />;
}
