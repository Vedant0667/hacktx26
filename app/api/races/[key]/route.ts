import type { NextRequest } from "next/server";
import { getRaceEntry } from "@/lib/data";
import { BLIND_CACHE } from "../../decisions/cache";
import { handle, HttpError } from "../../_lib/http";

// One race's picker entry (same shape as an element of GET /api/races). 404 for an unknown key.
export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/races/[key]">) => {
  const { key } = await ctx.params;
  const race = await getRaceEntry(key);
  if (!race) throw new HttpError(404, "Race not found");
  return Response.json(race, { headers: { "Cache-Control": BLIND_CACHE } });
});
