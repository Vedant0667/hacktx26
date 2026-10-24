import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  advancePhase,
  advanceRacePhase,
  getLobbyDriverCodes,
  getLobbyState,
  PHASES,
  raceFreezeProgress,
  startRace,
  type LobbyMeta,
  type RacePhase,
} from "@/lib/db";
import { getRaceFreezes } from "@/lib/data";
import type { LobbyPhase } from "@/lib/types";
import { requireHost } from "../../../_lib/access";
import { minPhaseSeconds } from "../../../_lib/phases";
import { handle, HttpError, normalizeCode, readBody, requireDecision } from "../../../_lib/http";
import { buildFreezePlan, currentFreeze, minRaceSeconds, nextRacePhase } from "../../../_lib/race";
import { redactForPhase } from "../../../_lib/redact";

const Body = z.object({
  phase: z.enum(["waiting", "replay", "decision", "reveal", "done", "freeze", "reveal_freeze"]),
  // Race lobbies (Round 6): when sent, must match the lobby's freeze_index (guards stale clicks).
  freeze_index: z.number().int().min(0).max(100).optional(),
});

function tooEarly(phase: string, remaining: number): Response {
  return Response.json(
    { error: `Too early to leave "${phase}": ${remaining} s left`, remaining_s: remaining },
    { status: 409, headers: { "Retry-After": String(Math.max(1, Math.ceil(remaining))) } },
  );
}

// Race lobby loop: waiting -> replay -> (freeze -> reveal_freeze -> replay)* -> done, with server minimums.
async function advanceRace(code: string, meta: LobbyMeta, phase: string, freezeIndex: number | undefined): Promise<Response | null> {
  if (freezeIndex !== undefined && freezeIndex !== meta.freeze_index) {
    throw new HttpError(409, `Stale request: the lobby is on freeze ${meta.freeze_index}, not ${freezeIndex}`);
  }
  if (meta.phase === phase) return null;
  const from = meta.phase as RacePhase;
  const plan = meta.freeze_plan ?? [];
  const next = nextRacePhase(from, meta.freeze_index, plan.length);
  if (phase !== next) throw new HttpError(409, `Lobby is in "${from}"; the next phase is ${next ? `"${next}"` : "none"}`);

  if (from === "waiting") {
    const cars = meta.driver_mode === "same" ? (meta.driver_code ? [meta.driver_code] : []) : await getLobbyDriverCodes(code);
    if (!cars.length) throw new HttpError(409, "Nobody has picked a car yet");
    const freezePlan = buildFreezePlan(await getRaceFreezes(meta.race_key!), cars);
    if (!(await startRace(code, freezePlan))) throw new HttpError(409, "Phase changed concurrently, refetch the lobby");
    return null;
  }
  const clock = { phase: from, plan, freeze_index: meta.freeze_index, total_laps: meta.total_laps ?? 0, phase_elapsed_s: meta.phase_elapsed_s };
  const f = currentFreeze(clock);
  const progress = from === "freeze" && f ? await raceFreezeProgress(code, f.lap, f.drivers) : { needed: 0, called: 0 };
  const remaining = Math.ceil((minRaceSeconds(clock, progress) - meta.phase_elapsed_s) * 10) / 10;
  if (remaining > 0) return tooEarly(from, remaining);
  const toIndex = from === "reveal_freeze" ? meta.freeze_index + 1 : meta.freeze_index;
  if (!(await advanceRacePhase(code, from, next, meta.freeze_index, toIndex))) {
    throw new HttpError(409, "Phase changed concurrently, refetch the lobby");
  }
  return null;
}

// Host only: requires x-host-token (returned once by POST /api/lobby). Phases only move forward one step,
// and not before the current phase's minimum time (409 with remaining_s and Retry-After).
// Re-sending the current phase is a no-op (double clicks).
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/phase">) => {
  const code = normalizeCode((await ctx.params).code);
  const { phase, freeze_index } = await readBody(req, Body);
  const { meta } = await requireHost(req, code, "Only the host screen can change the phase");
  if (meta.mode === "race") {
    const early = await advanceRace(code, meta, phase, freeze_index);
    if (early) return early;
    return Response.json(redactForPhase((await getLobbyState(code))!, true));
  }
  if (meta.phase !== phase) {
    const current = meta.phase as LobbyPhase;
    const next = PHASES[PHASES.indexOf(current) + 1];
    if (phase !== next) {
      throw new HttpError(409, `Lobby is in "${current}"; the next phase is ${next ? `"${next}"` : "none"}`);
    }
    const min = minPhaseSeconds(current, await requireDecision(meta.decision_id), meta);
    const remaining = Math.ceil((min - meta.phase_elapsed_s) * 10) / 10;
    if (remaining > 0) return tooEarly(current, remaining);
    if (!(await advancePhase(code, current, next))) {
      throw new HttpError(409, "Phase changed concurrently, refetch the lobby");
    }
  }
  return Response.json(redactForPhase((await getLobbyState(code))!, true));
});
