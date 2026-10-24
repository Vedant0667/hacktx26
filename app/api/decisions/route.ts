import { connection } from "next/server";
import { getIndex } from "@/lib/data";
import { handle } from "../_lib/http";
import { BLIND_CACHE } from "./cache";

// Blind decision index: [{ id, race, lap, title }]. Gated by proxy.ts like the rest of /api.
export const GET = handle(async () => {
  await connection(); // read from the DB per request; skips the build-time prerender attempt
  return Response.json((await getIndex()) ?? [], { headers: { "Cache-Control": BLIND_CACHE } });
});
