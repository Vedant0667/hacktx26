"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BlindDecision, LobbyStateResponse } from "@/lib/client/api";
import { CALL_WINDOW_S } from "@/lib/client/race";
import type { DataMode } from "@/lib/client/mode";
import type { LapFrame } from "@/lib/types";
import { ModeToggle } from "@/components/ui";
import { RNPhoneLocked } from "@/components/rn/phone/Locked";
import { RNPhoneScoring } from "@/components/rn/phone-end/Scoring";
import { RNControlButton, RNMuteButton } from "@/components/rn/host/controls";
import { RNHostReplay } from "@/components/rn/host/replay/RNReplay";
import { RNFreeze } from "@/components/rn/host/freeze/RNFreeze";
import { COPY } from "@/lib/copy";

type Fx = { id: string; decision: BlindDecision; frames: LapFrame[] };
const NAMES = ["Vedant", "Ekb", "Maya", "Jordan", "Priya", "Sam"];

export function GapsPreview({ fixtures }: { fixtures: Fx[] }) {
  return (
    <Suspense fallback={null}>
      <Inner fixtures={fixtures} />
    </Suspense>
  );
}

function Inner({ fixtures }: { fixtures: Fx[] }) {
  const sp = useSearchParams();
  const v = sp.get("v") ?? "locked";
  const [muted, setMuted] = useState(sp.get("muted") === "1");
  const [mode, setMode] = useState<DataMode>(sp.get("s") === "advanced" ? "advanced" : "simple");
  if (v === "locked") {
    const team = sp.get("team");
    return <RNPhoneLocked left={Number(sp.get("left") ?? 4)} teamColour={team === "none" ? null : (team ?? "#2B9BD8")} />;
  }
  if (v === "scoring") return <RNPhoneScoring elapsedMs={Number(sp.get("ms") ?? 7400)} failed={sp.get("failed") === "1"} />;

  const fx = fixtures.find((f) => f.id === sp.get("d")) ?? fixtures.find((f) => f.id.includes("singapore")) ?? fixtures[0];
  if (!fx) return <p>No fixtures.</p>;
  const { decision, frames } = fx;
  const mute = (tone: "dark" | "slab") => <RNMuteButton muted={muted} onToggle={() => setMuted((m) => !m)} tone={tone} />;
  if (v === "replay") {
    return (
      <RNHostReplay
        code="ABCD"
        decision={decision}
        frames={frames}
        lap={decision.lap - 3}
        onAdvance={() => {}}
        mode={mode}
        controls={
          <>
            <ModeToggle mode={mode} onChange={setMode} size="sm" />
            {mute("dark")}
            <RNControlButton onClick={() => {}}>{COPY.race.continue}</RNControlButton>
          </>
        }
      />
    );
  }
  const players = NAMES.map((name) => ({ name }));
  const lobby = { players: players.map((p) => ({ ...p, driver_code: null })), driver_code: null } as unknown as LobbyStateResponse;
  const team = frames.at(-1)?.drivers.find((d) => d.number === decision.player_role.number)?.team_colour ?? "#2B9BD8";
  const quick = sp.get("q") === "1";
  return (
    <RNFreeze
      code="ABCD"
      decision={decision}
      lobby={lobby}
      frames={frames}
      team={team}
      elapsed={(CALL_WINDOW_S - 17) * 1000}
      players={players}
      submitted={new Set(NAMES.filter((_, i) => i % 3 !== 1))}
      onAdvance={() => {}}
      mode={mode}
      setMode={setMode}
      mute={mute("dark")}
      why={quick ? undefined : <span className="rn-lbl">Why now: VSC · Rival</span>}
      label={quick ? undefined : `Call 4 of 4 · Lap ${decision.lap}/${decision.total_laps}`}
    />
  );
}
