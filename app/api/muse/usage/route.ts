import { connection } from "next/server";
import { getMuseSpend } from "@/lib/db";
import { museBudgetUsd, museEnabled } from "@/lib/muse/client";
import { handle } from "../../_lib/http";

// Muse Spark spend so far. Response: { calls, cost_usd, budget_usd, enabled } (enabled: the API key is set).
export const GET = handle(async () => {
  await connection(); // per request: never prerender a spend figure at build time
  const { calls, cost_usd } = await getMuseSpend();
  return Response.json(
    { calls, cost_usd: Math.round(cost_usd * 1e6) / 1e6, budget_usd: museBudgetUsd(), enabled: museEnabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
});
