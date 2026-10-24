import type { NextRequest } from "next/server";
import { z } from "zod";
import { advancePhase, getLobbyMeta, getLobbyState, PHASES } from "@/lib/db";
import { handle, HttpError, normalizeCode, readBody } from "../../../_lib/http";

const Body = z.object({ phase: z.enum(["waiting", "replay", "decision", "reveal", "done"]) });

// Phases only move forward one step. Re-sending the current phase is a no-op (double clicks).
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/phase">) => {
  const code = normalizeCode((await ctx.params).code);
  const { phase } = await readBody(req, Body);
  const meta = await getLobbyMeta(code);
  if (!meta) throw new HttpError(404, "Lobby not found");
  if (meta.phase !== phase) {
    const next = PHASES[PHASES.indexOf(meta.phase) + 1];
    if (phase !== next) {
      throw new HttpError(409, `Lobby is in "${meta.phase}"; the next phase is ${next ? `"${next}"` : "none"}`);
    }
    if (!(await advancePhase(code, meta.phase, phase))) {
      throw new HttpError(409, "Phase changed concurrently, refetch the lobby");
    }
  }
  return Response.json(await getLobbyState(code));
});
