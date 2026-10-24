"use client";
// Round 7: the host's end screen in a moment lobby, for both reveal and done: "Scoring the calls" while the
// server grades, then the shared game summary (components/EndScreen.tsx).
import type { LobbyStateResponse } from "@/lib/client/api";
import { useSummary } from "@/lib/client/results";
import { HostSummary, Scoring } from "../EndScreen";

export function HostReveal({ code, carCode, lobby, elapsed }: { code: string; carCode: string | null; lobby: LobbyStateResponse; elapsed: number }) {
  const { summary, failed } = useSummary(code, lobby.phase === "reveal" || lobby.phase === "done");
  if (!summary) return <Scoring elapsedMs={elapsed} failed={failed} big />;
  return <HostSummary summary={summary} code={code} carCode={carCode} />;
}
