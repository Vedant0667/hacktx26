"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BlindDecision, LobbyStateResponse } from "@/lib/client/api";
import { CALL_WINDOW_S } from "@/lib/client/race";
import type { DataMode } from "@/lib/client/mode";
import type { LapFrame, TrackStatus } from "@/lib/types";
import { RNFreeze, RNLocked } from "@/components/rn/host/freeze/RNFreeze";

const NAMES = ["Vedant", "Ekb", "Maya", "Jordan", "Priya", "Sam", "Alexandria", "Bo", "Christopher", "Dee", "Eli", "Fatima"];
const LONG = ["Maximilian-Alexander", "Bartholomew", "Wilhelmina Rose", "Ekb", "Priya", "Sam"];

type Fx = { id: string; decision: BlindDecision; frames: LapFrame[] };

export function Preview({ fixtures }: { fixtures: Fx[] }) {
  return (
    <Suspense fallback={null}>
      <Inner fixtures={fixtures} />
    </Suspense>
  );
}

function Inner({ fixtures }: { fixtures: Fx[] }) {
  const sp = useSearchParams();
  const fx = fixtures.find((f) => f.id === sp.get("d")) ?? fixtures.find((f) => f.id.includes("singapore")) ?? fixtures[0];
  const view = sp.get("s") ?? "simple";
  const left = Number(sp.get("left") ?? 17);
  const status = sp.get("st") ?? undefined;
  const n = Number(sp.get("n") ?? 6);
  const longNames = sp.get("long") === "1";
  const { decision, frames } = fx;
  const ids = fixtures.map((f) => f.id);
  const [mode, setMode] = useState<DataMode>(view === "advanced" ? "advanced" : "simple");
  const st: TrackStatus | undefined = status === "GREEN" || status === "SC" || status === "VSC" ? (status as TrackStatus) : undefined;
  const fr = st ? frames.map((f) => (f.lap === decision.lap ? { ...f, track_status: st } : f)) : frames;
  const dec = st ? { ...decision, trigger: st } : decision;
  const names = (longNames ? LONG : NAMES).slice(0, n);
  const players = names.map((name) => ({ name }));
  const submitted = new Set(names.filter((_, i) => i % 3 !== 1));
  const lobby = { players: players.map((p) => ({ ...p, driver_code: null })), driver_code: null } as unknown as LobbyStateResponse;
  const team = frames.at(-1)?.drivers.find((d) => d.number === decision.player_role.number)?.team_colour ?? "#2B9BD8";
  if (view === "locked") {
    return (
      <RNLocked
        left={3}
        holdS={8}
        onResume={() => {}}
        team={team}
        label={`Lap ${decision.lap} / ${decision.total_laps} · Call 4 of 4`}
        players={players}
        called={names}
        decision={dec}
        frames={fr.filter((f) => f.lap <= decision.lap)}
      />
    );
  }
  return (
    <>
      <RNFreeze
        code="ABCD"
        decision={dec}
        lobby={lobby}
        frames={fr}
        team={team}
        elapsed={(CALL_WINDOW_S - left) * 1000}
        players={players}
        submitted={submitted}
        onAdvance={() => {}}
        mode={mode}
        setMode={setMode}
        mute={null}
        why={sp.get("q") === "1" ? undefined : <span className="rn-lbl">Why now: VSC · Rival</span>}
        label={sp.get("q") === "1" ? undefined : `Call 4 of 4 · Lap ${decision.lap}/${decision.total_laps}`}
      />
      <span hidden data-ids={ids.join(",")} />
    </>
  );
}
