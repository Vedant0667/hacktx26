import type { NextRequest } from "next/server";
import { getBlindFrames } from "@/lib/data";
import { handle, HttpError } from "../../../_lib/http";
import { BLIND_CACHE } from "../../cache";

// Blind frames: laps 1..L-1 from race_laps plus the call-moment frame for lap L, which shows no lap-L stop
// (security-contract.md Round 4, 4.8). No lap after the call is read.
export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/decisions/[id]/frames">) => {
  const { id } = await ctx.params;
  const frames = await getBlindFrames(id);
  if (!frames) throw new HttpError(404, "Decision not found");
  return Response.json(frames, { headers: { "Cache-Control": BLIND_CACHE } });
});
