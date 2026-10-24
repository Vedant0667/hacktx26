import type { NextRequest } from "next/server";
import { getRaceFrames } from "@/lib/data";
import { requireRaceMember } from "../../../../_lib/access";
import { handle, HttpError, normalizeCode } from "../../../../_lib/http";
import { clockOf, framesFor, visibleLap } from "../../../../_lib/race";

// Round 6, 6.5: frames for laps from..visible_lap, never past the server clock. At a freeze: laps before it
// plus the call-moment frame (no stop on the freeze lap for any car). Host or player token; 403 otherwise.
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/race/frames">) => {
  const code = normalizeCode((await ctx.params).code);
  const { meta } = await requireRaceMember(req, code);
  const fromRaw = Number(req.nextUrl.searchParams.get("from") ?? "1");
  const from = Number.isInteger(fromRaw) && fromRaw >= 1 ? fromRaw : 1;
  const all = await getRaceFrames(meta.race_key!);
  if (!all) throw new HttpError(404, "Race data not found");
  const clock = clockOf(meta);
  return Response.json(
    { visible_lap: visibleLap(clock), frames: framesFor(all, clock, from) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
