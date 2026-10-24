// Per-driver views (Round 4): every driver-specific screen reads the player's own car. These helpers re-point
// a decision at a car so the existing brief, telemetry and result code follow it unchanged.
import type { BlindDecision, BlindDriver, DriverReveal, RevealDecision, RevealResponse } from "./api";
import type { GroundTruthFile } from "./mode";

// The blind decision as seen from `driver`: its number drives every lookup; its blind_title replaces the default.
export function asDriver(d: BlindDecision, driver: BlindDriver | null | undefined): BlindDecision {
  if (!driver) return d;
  return { ...d, blind_title: driver.blind_title, player_role: { ...d.player_role, number: driver.number, driver: driver.name, team: driver.team } };
}

// The reveal for one car: its team call, engine run and measured outcome replace the default car's.
export function revealFor(r: RevealResponse, code: string | null | undefined): { decision: RevealDecision; gt: GroundTruthFile; car: DriverReveal | null } {
  const car = code ? (r.drivers?.[code] ?? null) : null;
  if (!car) return { decision: r.decision, gt: r.ground_truth, car: null };
  const decision: RevealDecision = {
    ...r.decision,
    player_role: { team: car.team, driver: car.name, number: car.number },
    team: car.team_call,
    engine: car.engine,
    ground_truth: car.ground_truth,
  };
  // Positions-based detail exists only for the decision's default car.
  const same = r.decision.player_role.number === car.number;
  const gt: GroundTruthFile = same ? r.ground_truth : { pit_loss: r.ground_truth.pit_loss, seconds: car.ground_truth_detail };
  return { decision, gt, car };
}

// The player's car code: their own pick in a "choose" lobby, else the lobby's car.
export function driverCodeOf(lobby: { driver_code?: string | null; players: { name: string; driver_code?: string | null }[] } | null, name: string | null): string | null {
  if (!lobby) return null;
  return lobby.players.find((p) => p.name === name)?.driver_code ?? lobby.driver_code ?? null;
}
