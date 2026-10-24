import type { NextRequest } from "next/server";
import { getLobbyState } from "@/lib/db";
import { handle, HttpError, normalizeCode } from "../../_lib/http";
import { redactForPhase } from "../../_lib/redact";

// Polled every second by each client: one query.
export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/lobby/[code]">) => {
  const code = normalizeCode((await ctx.params).code);
  const state = await getLobbyState(code);
  if (!state) throw new HttpError(404, "Lobby not found");
  return Response.json(redactForPhase(state), { headers: { "Cache-Control": "no-store" } });
});
