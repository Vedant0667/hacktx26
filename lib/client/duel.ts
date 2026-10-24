"use client";
// Round 5 duel: the shared schedule (relative to the reveal phase start, so host and phones agree without
// extra server state), the poller, and the vote. Before the reveal the route answers 409; it is never called then.
import { useCallback, useEffect, useState } from "react";
import type { LobbyPhase } from "@/lib/types";
import { ApiError, api, type DuelResponse } from "./api";

// Room split first, then player A speaks for 10 s, then player B, then the room votes.
export const DUEL_START_MS = 9000;
export const DUEL_SPEAK_MS = 10000;
export type DuelStage = "before" | "a" | "b" | "vote";

export function duelStage(revealElapsedMs: number): DuelStage {
  const t = revealElapsedMs - DUEL_START_MS;
  if (t < 0) return "before";
  if (t < DUEL_SPEAK_MS) return "a";
  if (t < DUEL_SPEAK_MS * 2) return "b";
  return "vote";
}

// Seconds left in the current speaking turn (0 outside a turn).
export function speakLeft(revealElapsedMs: number): number {
  const t = revealElapsedMs - DUEL_START_MS;
  if (t < 0 || t >= DUEL_SPEAK_MS * 2) return 0;
  return Math.ceil((DUEL_SPEAK_MS - (t % DUEL_SPEAK_MS)) / 1000);
}

// Polls GET /duel about every second while the pick is pending, then every 2 s for the live tally.
// Stops when there is no pair (fewer than two calls: the duel is skipped).
export function useDuel(code: string, phase: LobbyPhase | undefined) {
  const [duel, setDuel] = useState<DuelResponse | null>(null);
  const open = phase === "reveal" || phase === "done";
  const finished = !!duel && !duel.pending && !duel.pair;
  useEffect(() => {
    if (!open || finished) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const load = () =>
      api
        .duel(code)
        .then((d) => {
          if (!alive) return;
          setDuel(d);
          if (d.pending || d.pair) t = setTimeout(load, d.pending ? 1000 : 2000);
        })
        .catch((e) => {
          if (alive) t = setTimeout(load, e instanceof ApiError && e.retryAfter ? e.retryAfter * 1000 : 2000);
        });
    load();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [code, open, finished]);

  const vote = useCallback(
    async (choice: 0 | 1) => {
      const r = await api.duelVote(code, choice);
      setDuel((d) => (d ? { ...d, votes: r.votes, my_vote: r.my_vote } : d));
    },
    [code],
  );
  return { duel, vote };
}
