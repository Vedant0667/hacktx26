"use client";
// Picks the Race Night home or the classic one by the UI flag (page.tsx is a server component).
import type { DecisionIndexEntry } from "@/lib/types";
import { useRaceNight } from "@/lib/client/uiFlag";
import { HomeScreen } from "../../HomeScreen";
import { RNHomeScreen } from "./RNHomeScreen";

export function HomeSwitch({ index }: { index: DecisionIndexEntry[] }) {
  return useRaceNight() ? <RNHomeScreen index={index} /> : <HomeScreen index={index} />;
}
