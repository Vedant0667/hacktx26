import type { NextRequest } from "next/server";
import { claimMuseDuel, getDuelEntries, getDuelVotes, getMuseDuel, saveMuseDuel, type LobbyMeta } from "@/lib/db";
import { fallbackDuel, museDuel, type DuelResult } from "@/lib/muse";
import { requireLobbyMember } from "../../../_lib/access";
import { handle, HttpError, normalizeCode, requireDecision } from "../../../_lib/http";
import { isRevealed } from "../../../_lib/redact";

// Same as REVEAL_GRACE_S in ../submit: calls auto-sent as the host reveals can still land this long after it.
const REVEAL_GRACE_S = 2;

type DuelState = DuelResult & { pending: boolean };

// The duel for this lobby and decision: picked once (one Muse call at most), cached in muse_duels, never re-picked.
async function duelFor(code: string, meta: LobbyMeta): Promise<DuelState> {
  const pending: DuelState = { source: "fallback", pair: null, prompt: null, pending: true };
  const cached = await getMuseDuel(code, meta.decision_id);
  if (cached?.status === "done") return { ...(cached.duel as DuelResult), pending: false };
  // Wait out the grace window so late calls are in the pick.
  if (meta.phase === "reveal" && meta.phase_elapsed_s < REVEAL_GRACE_S) return pending;
  const entries = await getDuelEntries(code, meta.decision_id);
  if (entries.length < 2) return { ...fallbackDuel(entries), pending: false }; // final: calls are closed; not cached
  const claim = await claimMuseDuel(code, meta.decision_id, entries.length);
  if (!claim) return pending; // another request is picking right now
  let result: DuelResult | null = null;
  if (claim === "new") {
    try {
      result = await museDuel(await requireDecision(meta.decision_id), code, entries);
    } catch (err) {
      console.error("duel: Muse pick failed, using the fallback pick", err);
    }
  }
  result ??= fallbackDuel(entries);
  await saveMuseDuel(code, meta.decision_id, result);
  return { ...result, pending: false };
}

// "Defend your call": the two most opposed calls in the lobby on the current decision, for a 10-second duel.
// Response: { source: "muse" | "fallback", pair: [{name, driver_code, call, summary}, {...}] | null, prompt: string | null,
//             pending: boolean, votes: [number, number], my_vote: 0 | 1 | null }
// pair is null with fewer than 2 calls, or while pending (the pick is being made; poll again in about 1 s).
// Host (x-host-token) or a player of this lobby (x-player-token) only; 403 otherwise, also for an unknown code
// (miss-limited); 409 before the reveal. The calls and spoken reasons are the answer, so they stay inside the lobby.
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/duel">) => {
  const code = normalizeCode((await ctx.params).code);
  const { meta, player } = await requireLobbyMember(req, code);
  if (!isRevealed(meta.phase)) throw new HttpError(409, "The duel opens at the reveal");
  const duel = await duelFor(code, meta);
  const tally = duel.pair ? await getDuelVotes(code, meta.decision_id, player) : { votes: [0, 0], my_vote: null };
  return Response.json({ ...duel, ...tally }, { headers: { "Cache-Control": "no-store" } });
});
