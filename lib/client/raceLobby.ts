"use client";
// Race mode (security-contract.md Round 6) on the client: the replay clock, token-gated frames polled lap by
// lap, the current freeze (blind), per-freeze and full reveals, the race scoreboard and the audible cooldown.
// Before a freeze's reveal everything here comes from blind routes only.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LapFrame } from "@/lib/types";
import {
  ApiError,
  api,
  data,
  type BlindDecision,
  type BlindFreeze,
  type FreezeResponse,
  type LobbyStateResponse,
  type PitLoss,
  type RaceEntry,
  type RacePhase,
  type RaceState,
} from "./api";

// Round 7: the "calls locked" beat after a freeze (no answers until the flag). Just over the server's 5 s
// minimum in reveal_freeze, then the host resumes the replay.
export const REVEAL_HOLD_MS = 5500;

export type RaceLobby = LobbyStateResponse & { race: RaceState };
export const isRaceLobby = (l: LobbyStateResponse | null | undefined): l is RaceLobby => !!l && l.mode === "race" && !!l.race;
// LobbyStateResponse.phase is typed for moment lobbies; a race lobby carries a RacePhase string.
export const racePhase = (l: LobbyStateResponse): RacePhase => l.phase as unknown as RacePhase;

// The lap the replay shows now, from the server clock (contract 6.3). Phones have no segment end, so the
// caller also caps it at the last frame the server has handed out.
export function clockLap(l: RaceLobby, serverNow: number): number {
  const r = l.race;
  const ph = racePhase(l);
  if (ph === "waiting") return 0;
  if (ph === "done") return r.total_laps;
  if (ph === "freeze" || ph === "reveal_freeze") return r.freeze_lap ?? r.visible_lap;
  const end = r.segment_end_lap ?? r.total_laps;
  const lap = r.segment_start_lap + Math.floor(Math.max(0, serverNow - l.phase_started_at) / (r.lap_s * 1000));
  return Math.min(end, lap);
}

// Host only: true once the server will accept replay -> freeze/done ((end - start + 1) * lap_s after the start).
export function segmentDone(l: RaceLobby, serverNow: number): boolean {
  const r = l.race;
  if (racePhase(l) !== "replay" || r.segment_end_lap == null) return false;
  return serverNow - l.phase_started_at >= (r.segment_end_lap - r.segment_start_lap + 1) * r.lap_s * 1000;
}

// What follows the replay segment: another freeze while any remain, else the flag.
export const nextAfterReplay = (r: RaceState): RacePhase => (r.freeze_count != null && r.freeze_index < r.freeze_count ? "freeze" : "done");

// The car a player drives; null for a watcher who joined a "choose" race after the start.
export const raceCarOf = (l: LobbyStateResponse, name: string | null): string | null =>
  (name ? l.players.find((p) => p.name === name)?.driver_code : null) || l.driver_code || null;

export function raceCars(l: LobbyStateResponse): string[] {
  const counts = new Map<string, number>();
  for (const p of l.players) {
    const c = p.driver_code || l.driver_code;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (!counts.size && l.driver_code) counts.set(l.driver_code, 0);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

// The car whose colour floods a freeze: the host's followed car when it has a call, else the first car called.
export function featuredCar(r: RaceState, followed: string | null): string | null {
  const need = r.calls_needed ?? [];
  if (followed && need.includes(followed)) return followed;
  return need[0] ?? followed;
}

export function numberOf(frames: LapFrame[] | null | undefined, code: string | null): number | null {
  if (!frames || !code) return null;
  for (let i = frames.length - 1; i >= 0; i--) {
    const d = frames[i].drivers.find((x) => x.code === code);
    if (d) return d.number;
  }
  return null;
}

// A freeze re-shaped as the blind decision the moment-mode brief, telemetry and CallPad already read.
// id is per freeze, so CallPad's stored result is per freeze too.
export function freezeDecision(race: RaceState, f: BlindFreeze, number: number, frames: LapFrame[], fromLap: number): BlindDecision {
  const at = frames.find((x) => x.lap === f.lap)?.track_status;
  const trigger = at ?? (f.triggers.some((t) => t.type === "SC") ? "SC" : f.triggers.some((t) => t.type === "VSC") ? "VSC" : "GREEN");
  return {
    id: `race:${race.race_key}:L${f.lap}`,
    race: "",
    blind_title: f.blind_title,
    lap: f.lap,
    trigger,
    player_role: { team: "", driver: f.driver_code, number },
    options: f.options,
    replay_from_lap: fromLap,
    factors: f.factors,
    total_laps: race.total_laps,
    pit_loss: { normal_s: f.pit_loss.normal_s, n_stops: 0, from: f.pit_loss.source },
  };
}

// For telemetry during the replay: the followed car "as of" the current lap. No pit loss is known between
// freezes, so the rejoin and undercut parts stay empty.
export function replayDecision(race: RaceState, number: number, lap: number): BlindDecision {
  return {
    id: `race:${race.race_key}:replay`,
    race: "",
    lap,
    trigger: "GREEN",
    player_role: { team: "", driver: "", number },
    options: ["BOX", "STAY"],
    replay_from_lap: 1,
    factors: [],
    total_laps: race.total_laps,
    pit_loss: undefined as unknown as PitLoss,
  };
}

// ---- Hooks ----

const retryMs = (e: unknown, fallback = 1500) => (e instanceof ApiError && e.retryAfter ? e.retryAfter * 1000 : fallback);

export function useRaceEntry(raceKey: string | null | undefined): RaceEntry | null {
  const [entry, setEntry] = useState<RaceEntry | null>(null);
  useEffect(() => {
    if (!raceKey) return;
    let alive = true;
    data
      .races()
      .then((list) => alive && setEntry(list.find((r) => r.race_key === raceKey) ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [raceKey]);
  return entry;
}

// Frames from GET /race/frames, polled once per lap during the replay. In a freeze the server hands out the
// call-moment frame for the freeze lap; when the replay resumes, the real frame for that lap replaces it.
export function useRaceFrames(code: string, lobby: LobbyStateResponse | null): LapFrame[] {
  const [frames, setFrames] = useState<LapFrame[]>([]);
  const held = useRef(new Map<number, LapFrame>());
  const moment = useRef<number | null>(null);
  const lobbyRef = useRef(lobby);
  useEffect(() => {
    lobbyRef.current = lobby;
  });
  const race = isRaceLobby(lobby) ? lobby : null;
  const key = race ? `${racePhase(race)}:${race.race.freeze_index}` : "";

  useEffect(() => {
    if (!key) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const l = lobbyRef.current;
      if (!alive || !isRaceLobby(l)) return;
      const ph = racePhase(l);
      const r = l.race;
      const max = held.current.size ? Math.max(...held.current.keys()) : 0;
      if (ph === "waiting") return;
      const stopped = ph === "freeze" || ph === "reveal_freeze";
      if (stopped && r.freeze_lap != null && max >= r.freeze_lap && moment.current === r.freeze_lap) return;
      if (ph === "done" && max >= r.total_laps && moment.current == null) return;
      const from = moment.current != null && !stopped ? moment.current : max + 1;
      let wait = Math.round(r.lap_s * 1000);
      try {
        const res = await api.raceFrames(code, from);
        if (!alive) return;
        for (const f of res.frames) held.current.set(f.lap, f);
        if (stopped && r.freeze_lap != null && res.frames.some((f) => f.lap === r.freeze_lap)) moment.current = r.freeze_lap;
        else if (!stopped && moment.current != null && res.frames.some((f) => f.lap === moment.current)) moment.current = null;
        setFrames([...held.current.values()].sort((a, b) => a.lap - b.lap));
      } catch (e) {
        wait = retryMs(e, 1500);
      }
      if (alive) t = setTimeout(tick, wait);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [code, key]);
  return frames;
}

// The current freeze (blind), once per freeze.
export function useRaceFreeze(code: string, lobby: LobbyStateResponse | null): FreezeResponse | null {
  const [freeze, setFreeze] = useState<FreezeResponse | null>(null);
  const race = isRaceLobby(lobby) ? lobby : null;
  const ph = race ? racePhase(race) : null;
  const open = ph === "freeze" || ph === "reveal_freeze";
  const idx = race?.race.freeze_index ?? -1;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const load = () =>
      api
        .raceFreeze(code)
        .then((f) => alive && setFreeze(f))
        .catch((e) => {
          if (alive) t = setTimeout(load, retryMs(e));
        });
    load();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [code, open, idx]);
  return open && freeze?.freeze_index === idx ? freeze : null;
}

// ---- Audible cooldown (per device, per lobby and player; survives a reload) ----

const AUDIBLE_EVENT = "race-audible";
const nextKey = (code: string, name: string) => `lobby:${code.toUpperCase()}:audible:${name}:next`;
function readNext(k: string): number | null {
  try {
    const v = Number(localStorage.getItem(k));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function subscribeNext(cb: () => void) {
  window.addEventListener(AUDIBLE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(AUDIBLE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

// The lap the next audible opens on (from the server's next_lap), or null when one is allowed now.
export function useAudibleCooldown(code: string, name: string): [number | null, (lap: number) => void] {
  const k = nextKey(code, name);
  const next = useSyncExternalStore(subscribeNext, () => readNext(k), () => null);
  const set = useCallback(
    (lap: number) => {
      try {
        localStorage.setItem(k, String(lap));
      } catch {}
      window.dispatchEvent(new Event(AUDIBLE_EVENT));
    },
    [k],
  );
  return [next, set];
}
