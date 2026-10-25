"use client";
// Round 7: the host's end screen in a moment lobby, for both reveal and done: "Scoring the calls" while the
// server grades, then the shared game summary (components/EndScreen.tsx).
import type { LobbyStateResponse } from "@/lib/client/api";
import { useSummary } from "@/lib/client/results";
import { useRaceNight } from "@/lib/client/uiFlag";
import { HostSummary, Scoring } from "../EndScreen";
import { RNHostSummary, RNScoring } from "../rn/end/RNHostEnd";

export function HostReveal({ code, carCode, lobby, elapsed }: { code: string; carCode: string | null; lobby: LobbyStateResponse; elapsed: number }) {
  const { summary, failed } = useSummary(code, lobby.phase === "reveal" || lobby.phase === "done");
  const rn = useRaceNight();
  if (!summary) return rn ? <RNScoring elapsedMs={elapsed} failed={failed} big /> : <Scoring elapsedMs={elapsed} failed={failed} big />;
  return rn ? <RNHostSummary summary={summary} code={code} carCode={carCode} /> : <HostSummary summary={summary} code={code} carCode={carCode} />;
}
