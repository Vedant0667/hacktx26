// Manual retention purge. Usage:
//   node --env-file=.env.local scripts/purge.mjs          # same as the daily cron: lobbies older than 24 h, rate limits older than a day
//   node --env-file=.env.local scripts/purge.mjs --all    # after judging: every lobby (players, calls, claims, kicks, camp labels cascade) and every rate-limit row
// muse_calls (spend log, no player text) is kept so the Muse budget cap stays correct.
import { neon } from "@neondatabase/serverless";

const all = process.argv.includes("--all");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const [lobbies, limits] = await sql.transaction([
  all
    ? sql.query("delete from lobbies returning code")
    : sql.query("delete from lobbies where created_at < now() - interval '24 hours' returning code"),
  all
    ? sql.query("delete from rate_limits returning bucket")
    : sql.query("delete from rate_limits where window_start < now() - interval '1 day' returning bucket"),
]);
console.log(`purge${all ? " --all" : ""}: deleted ${lobbies.length} lobbies, ${limits.length} rate-limit rows`);
