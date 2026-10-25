"use client";
// Development-only preview of the Race Night phone views (?s=join|pick|waiting|racewait).
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BlindDriver, LobbyStateResponse } from "@/lib/client/api";
import type { DataMode } from "@/lib/client/mode";
import type { RaceLobby } from "@/lib/client/raceLobby";
import { RNJoinForm } from "@/components/rn/phone/JoinForm";
import { RNRaceWaiting, RNWaiting } from "@/components/rn/phone/Waiting";

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
  return <RNRaceWaiting code="DCFH" race={race} me="Vedant" driver={{ ...drivers[0], freeze_count: 4 }} mode={mode} setMode={setMode} />;
}
