"use client";
// Polls GET /api/lobby/[code] every second and keeps a server-clock offset so every screen derives
// the same replay lap and countdown from phase_started_at.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type LobbyStateResponse } from "./api";

export type Conn = "ok" | "lost" | "gave_up" | "not_found";

export function useLobby(code: string) {
  const [lobby, setLobby] = useState<LobbyStateResponse | null>(null);
  const [conn, setConn] = useState<Conn>("ok");
  const offset = useRef(0);
  const failures = useRef(0);

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
      setConn("ok");
      apply(s, sentAt);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setConn("not_found");
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
      if (alive) t = setTimeout(loop, 1000);
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
        apply(await api.phase(code, phase), sentAt);
      } catch {
        await refresh();
      }
    },
    [code, apply, refresh],
  );

  return { lobby, conn, serverNow, refresh, setPhase, apply };
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
