"use client";
// Polls GET /api/lobby/[code] every second and keeps a server-clock offset so every screen derives
// the same replay lap and countdown from phase_started_at.
import { useCallback, useEffect, useRef, useState } from "react";
import type { LobbyPhase } from "@/lib/types";
import { ApiError, api, revealData, type LobbyStateResponse, type RevealResponse } from "./api";
import { recallHostToken } from "./identity";

const POLL_MS = 1000;
// A 429 without Retry-After waits this long.
const RATE_LIMIT_DEFAULT_S = 5;

export type Conn = "ok" | "lost" | "gave_up" | "not_found";

export function useLobby(code: string) {
  const [lobby, setLobby] = useState<LobbyStateResponse | null>(null);
  const [conn, setConn] = useState<Conn>("ok");
  const [phaseErr, setPhaseErr] = useState<"forbidden" | null>(null);
  const offset = useRef(0);
  const failures = useRef(0);
  const limited = useRef(0);
  // Earliest time the next poll may go out (set from Retry-After on a 429).
  const pauseUntil = useRef(0);

  const apply = useCallback((s: LobbyStateResponse, sentAt: number) => {
    const now = Date.now();
    // Server stamped `now` somewhere in the round trip; take the midpoint.
    if (typeof s.now === "number") offset.current = s.now - (sentAt + now) / 2;
    setLobby(s);
  }, []);

  const refresh = useCallback(async () => {
    const sentAt = Date.now();
    try {
      const s = await api.lobby(code);
      failures.current = 0;
      limited.current = 0;
      setConn("ok");
      apply(s, sentAt);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setConn("not_found");
        return;
      }
      // Rate limited: wait it out. One 429 is not a lost connection; three in a row are worth showing.
      if (e instanceof ApiError && e.status === 429) {
        pauseUntil.current = Date.now() + (e.retryAfter ?? RATE_LIMIT_DEFAULT_S) * 1000;
        limited.current++;
        if (limited.current >= 3) setConn("lost");
        return;
      }
      failures.current++;
      if (failures.current >= 30) setConn("gave_up");
      else if (failures.current >= 3) setConn("lost");
    }
  }, [code, apply]);

  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await refresh();
      if (alive) t = setTimeout(loop, Math.max(POLL_MS, pauseUntil.current - Date.now()));
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [refresh]);

  const serverNow = useCallback(() => Date.now() + offset.current, []);

  const setPhase = useCallback(
    async (phase: string) => {
      const sentAt = Date.now();
      try {
        apply(await api.phase(code, phase, recallHostToken(code)), sentAt);
        setPhaseErr(null);
      } catch (e) {
        // 403: this device does not hold the host token for the lobby.
        if (e instanceof ApiError && e.status === 403) setPhaseErr("forbidden");
        await refresh();
      }
    },
    [code, apply, refresh],
  );

  return { lobby, conn, serverNow, refresh, setPhase, apply, phaseErr };
}

// Fetches GET /api/lobby/[code]/reveal once the lobby reaches reveal or done (it answers 409 before that),
// retrying until it succeeds. Before then every screen renders from the blind decision and frames only.
export function useReveal(code: string, phase: LobbyPhase | undefined): RevealResponse | null {
  const [reveal, setReveal] = useState<RevealResponse | null>(null);
  const open = phase === "reveal" || phase === "done";
  useEffect(() => {
    if (!open || reveal) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const load = () =>
      revealData(code)
        .then((r) => alive && setReveal(r))
        .catch((e) => {
          if (alive) t = setTimeout(load, e instanceof ApiError && e.retryAfter ? e.retryAfter * 1000 : 1500);
        });
    load();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [code, open, reveal]);
  return reveal;
}

// Re-renders at `ms` intervals and returns the estimated server time.
export function useTicker(serverNow: () => number, ms = 100): number {
  const [t, setT] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setT(serverNow()), ms);
    return () => clearInterval(id);
  }, [serverNow, ms]);
  return t;
}
