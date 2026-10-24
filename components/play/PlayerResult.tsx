"use client";
// Round 7: the phone's end screen in a moment lobby: "Scoring the calls" while the server grades, then the
// shared game summary (components/EndScreen.tsx).
import type { LobbyStateResponse } from "@/lib/client/api";
import { useSummary } from "@/lib/client/results";
import { PhoneSummary, Scoring } from "../EndScreen";

export function PlayerResult({ code, me, lobby, elapsed }: { code: string; me: string; lobby: LobbyStateResponse; elapsed: number }) {
  const { summary, failed } = useSummary(code, lobby.phase === "reveal" || lobby.phase === "done");
  if (!summary) return <Scoring elapsedMs={elapsed} failed={failed} />;
  return <PhoneSummary summary={summary} me={me} />;
}
