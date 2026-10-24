import { z } from "zod";
import { parseCall } from "@/lib/muse";
import { handle, readBody } from "../_lib/http";

const Body = z.object({ transcript: z.string().max(4000) });

export const POST = handle(async (req: Request) => {
  const { transcript } = await readBody(req, Body);
  return Response.json(await parseCall(transcript));
});
