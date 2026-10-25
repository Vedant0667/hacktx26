"use client";
// Race Night home container: HomeScreen's logic (useHomeBuilder) feeding RNHomeView. Drop-in for HomeScreen:
// app/page.tsx renders `rn ? <RNHomeScreen index={index} /> : <HomeScreen index={index} />`.
import type { DecisionIndexEntry } from "@/lib/types";
import { RNHomeView } from "./RNHomeView";
import { useHomeBuilder } from "./useHomeBuilder";

export function RNHomeScreen({ index }: { index: DecisionIndexEntry[] }) {
  return <RNHomeView {...useHomeBuilder(index)} />;
}
