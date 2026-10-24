import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAudibleLaps, getLobbyMeta, insertAudible } from "@/lib/db";
import { getAudibleTruth } from "@/lib/data";
import { parseCallLocal } from "@/lib/muse";
import { lobbyMetaGuarded } from "../../../_lib/access";
import { handle, hashToken, HttpError, normalizeCode, readBody } from "../../../_lib/http";
import { AUDIBLE_GAP_LAPS, audibleAllowed, clockOf, presentCall, RACE_LAP_S, scoreAudible, segment, visibleLap } from "../../../_lib/race";

const Body = z.object({
  call: z.literal("BOX"),
  car: z.string().trim().min(1).max(8).optional(),
  transcript: z.string().max(1000).optional(),
});

// Round 6, 6.8: "box now" for the player's own car during the replay. The lap is the server clock's visible
// lap, never the client's. One per player per 5 laps (429 with next_lap). Scored when it lands (against cars
// near that car that stopped or stayed out around that lap, from race_audibles) but shown as pending until done.
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/audible">) => {
  const code = normalizeCode((await ctx.params).code);
  const { car, transcript = "" } = await readBody(req, Body);
  const denied = "This device is not signed in as a player in this lobby";
  const { meta, player } = await lobbyMetaGuarded(req, code, undefined, denied);
  if (!player) throw new HttpError(403, denied);
  if (meta.mode !== "race" || !meta.race_key) throw new HttpError(409, "Audibles are for race lobbies");
  // The player's car: getLobbyMeta resolves player_driver_code by name, so read it again for the token's player.
  const mine = await getLobbyMeta(code, player, hashToken(req.headers.get("x-player-token") ?? ""));
  if (!mine || mine.token_player !== player) throw new HttpError(403, denied);
  const driver = mine.player_driver_code;
  if (!driver) throw new HttpError(403, "You have no car in this race");
  if (car && car.toUpperCase() !== driver) throw new HttpError(400, `You can only call for your own car (${driver})`);
  if (mine.phase !== "replay") throw new HttpError(409, "Audibles are open only while the replay runs");

  const clock = clockOf(mine);
  const lap = visibleLap(clock);
  const tooSoon = (next: number) => {
    const { start } = segment(clock);
    const wait = Math.max(1, Math.ceil((next - start) * RACE_LAP_S - clock.phase_elapsed_s));
    return Response.json(
      { error: `One audible per ${AUDIBLE_GAP_LAPS} laps: next on lap ${next}`, next_lap: next },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  };
  const before = audibleAllowed(await getAudibleLaps(code, player), lap);
  if (!before.ok) return tooSoon(before.next_lap);

  const text = transcript.trim();
  const score = scoreAudible(lap, driver, mine.freeze_plan ?? [], await getAudibleTruth(meta.race_key, driver, lap), text);
  const local = parseCallLocal(text);
  const { call, laps } = await insertAudible(
    code,
    {
      kind: "audible", lap, player_name: player, driver_code: driver, call: "BOX",
      reasons: local.reasons.slice(0, 4), factors_named: score.factors_named, transcript: text,
      seconds_to_call: null, status: score.status,
      score_call: score.score_call, score_reasoning: score.score_reasoning, total: score.total,
    },
    AUDIBLE_GAP_LAPS,
  );
  if (!call) return tooSoon(audibleAllowed(laps.filter((l) => l !== lap), lap).next_lap);
  return Response.json(
    { audible: presentCall(call, [], false), next_lap: lap + AUDIBLE_GAP_LAPS },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
});
