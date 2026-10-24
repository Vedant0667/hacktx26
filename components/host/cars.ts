// Which car the host screen follows (Round 4): the lobby's car in a "same" lobby; in "choose", the car most
// players picked (ties go to the decision's default driver).
import type { BlindDriver, DriversResponse, LeaderboardResponse, LeaderboardRow, LobbyStateResponse } from "@/lib/client/api";

export function lobbyCarCode(lobby: LobbyStateResponse, drivers: DriversResponse | null): string | null {
  if (lobby.driver_mode !== "choose") return lobby.driver_code ?? drivers?.default_driver ?? null;
  const counts = new Map<string, number>();
  for (const p of lobby.players) if (p.driver_code) counts.set(p.driver_code, (counts.get(p.driver_code) ?? 0) + 1);
  const def = drivers?.default_driver ?? null;
  let best = def;
  let n = def ? (counts.get(def) ?? 0) : -1;
  for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
  return best;
}

export const carOf = (lobby: LobbyStateResponse, name: string): string | null =>
  lobby.players.find((p) => p.name === name)?.driver_code ?? lobby.driver_code ?? null;

// Distinct cars that players drive, most-played first.
export function carsInPlay(lobby: LobbyStateResponse): string[] {
  const counts = new Map<string, number>();
  for (const p of lobby.players) {
    const c = p.driver_code ?? lobby.driver_code;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export const driverBy = (drivers: DriversResponse | null, code: string | null): BlindDriver | null =>
  (code && drivers?.drivers.find((d) => d.code === code)) || null;

type Row = LeaderboardRow & { driver_code?: string | null };
// The team and engine benchmark rows for one car: per-car benchmarks when present, else the legacy pair.
export function benchmarksFor(lb: LeaderboardResponse | null, code: string | null): { team: Row | null; engine: Row | null } {
  if (!lb) return { team: null, engine: null };
  const list = (lb as LeaderboardResponse & { benchmarks?: Row[] }).benchmarks ?? [];
  const team = list.find((r) => r.kind === "team" && r.driver_code === code) ?? lb.team;
  const engine = list.find((r) => r.kind === "engine" && r.driver_code === code) ?? lb.engine;
  return { team: team ?? null, engine: engine ?? null };
}
