import { purgeExpired } from "@/lib/db";
import { cronAuthorized } from "@/lib/gate";

// Daily Vercel Cron (vercel.json): deletes lobbies older than 24 hours (players, calls, claims, kicks and camp
// labels cascade) and rate-limit rows (IP addresses) older than a day, so the retention promise holds after
// the event ends. Vercel sends `Authorization: Bearer ${CRON_SECRET}`; anything else is 401, and with
// CRON_SECRET unset the route refuses every request. proxy.ts lets this path past the password gate only
// when the same bearer matches.
export async function GET(request: Request) {
  // Reading request.headers first makes this request-time only (no build prerender), per the route-handler docs.
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const deleted = await purgeExpired();
    return Response.json({ ok: true, deleted }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("cron purge failed", err);
    return Response.json({ error: "Purge failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
