import type { NextRequest } from "next/server";
import { z } from "zod";
import { advancePhase, getLobbyState, PHASES } from "@/lib/db";
import { requireHost } from "../../../_lib/access";
import { minPhaseSeconds } from "../../../_lib/phases";
import { handle, HttpError, normalizeCode, readBody, requireDecision } from "../../../_lib/http";
import { redactForPhase } from "../../../_lib/redact";

const Body = z.object({ phase: z.enum(["waiting", "replay", "decision", "reveal", "done"]) });

// Host only: requires x-host-token (returned once by POST /api/lobby). Phases only move forward one step,
// and not before the current phase's minimum time (409 with remaining_s and Retry-After).
// Re-sending the current phase is a no-op (double clicks).
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/phase">) => {
  const code = normalizeCode((await ctx.params).code);
  const { phase } = await readBody(req, Body);
  const { meta } = await requireHost(req, code, "Only the host screen can change the phase");
  if (meta.phase !== phase) {
    const next = PHASES[PHASES.indexOf(meta.phase) + 1];
    if (phase !== next) {
      throw new HttpError(409, `Lobby is in "${meta.phase}"; the next phase is ${next ? `"${next}"` : "none"}`);
    }
    const min = minPhaseSeconds(meta.phase, await requireDecision(meta.decision_id), meta);
    const remaining = Math.ceil((min - meta.phase_elapsed_s) * 10) / 10;
    if (remaining > 0) {
      return Response.json(
        { error: `Too early to leave "${meta.phase}": ${remaining} s left`, remaining_s: remaining },
        { status: 409, headers: { "Retry-After": String(Math.max(1, Math.ceil(remaining))) } },
      );
    }
    if (!(await advancePhase(code, meta.phase, phase))) {
      throw new HttpError(409, "Phase changed concurrently, refetch the lobby");
    }
  }
  return Response.json(redactForPhase((await getLobbyState(code))!));
});
