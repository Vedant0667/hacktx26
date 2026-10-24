import { connection } from "next/server";
import { getRaceList } from "@/lib/data";
import { BLIND_CACHE } from "../decisions/cache";
import { handle } from "../_lib/http";

// Race picker (Round 6, 6.1): [{ race_key, name, total_laps, default_driver, drivers: [{ code, number, name,
// team, team_colour, freeze_count }] }]. No freeze laps, answers, team calls or engine calls.
export const GET = handle(async () => {
  await connection();
  return Response.json(await getRaceList(), { headers: { "Cache-Control": BLIND_CACHE } });
});
