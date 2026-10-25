import { getMuseSpend } from "@/lib/db";
import { cronAuthorized } from "@/lib/gate";
import { museBudgetUsd, museEnabled } from "@/lib/muse/client";
import { handle } from "../../_lib/http";

// Muse Spark spend so far, for the operator only: `Authorization: Bearer ${CRON_SECRET}`, else 401 (and every
// request is refused while CRON_SECRET is unset). No client calls this route.
// Response: { calls, cost_usd, budget_usd, enabled } (enabled: the API key is set).
export const GET = handle(async (request: Request) => {
  // Reading request.headers first makes this request-time only (never prerendered at build time).
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { calls, cost_usd } = await getMuseSpend();
  return Response.json(
    { calls, cost_usd: Math.round(cost_usd * 1e6) / 1e6, budget_usd: museBudgetUsd(), enabled: museEnabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
});
