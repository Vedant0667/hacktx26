import type { NextRequest } from "next/server";
import { claimMuseCamps, getLobbyState, getMuseCamps, saveMuseCamps, type LobbyStateResponse } from "@/lib/db";
import { museCamps, parseCallLocal, type CampLabel } from "@/lib/muse";
import type { Submission } from "@/lib/types";
import { requireLobbyMember } from "../../../_lib/access";
import { handle, HttpError, normalizeCode, requireDecision } from "../../../_lib/http";
import { isRevealed } from "../../../_lib/redact";

const QUOTE_MAX = 90;

function clip(text: string): string {
  const t = text.trim();
  if (t.length <= QUOTE_MAX) return t;
  const cut = t.slice(0, QUOTE_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : QUOTE_MAX)}…`;
}

// The part of a player's call that names this factor; falls back to the start of the transcript.
function quoteFor(s: Submission, factor: string): string {
  const reason = s.reasons.find((r) => parseCallLocal(r).factors_named.includes(factor));
  return clip(reason ?? s.transcript);
}

// Muse camp labels for this lobby and decision: one call, cached in muse_camps so polling never re-calls.
// A new call is made only when more calls have landed since the cached one (reveal grace window).
// Concurrent pollers that lose the claim get the cached labels, or null (the factor grouping stands in).
async function campLabels(state: LobbyStateResponse): Promise<CampLabel[] | null> {
  const subs = state.submissions;
  try {
    const cached = await getMuseCamps(state.code, state.decision_id);
    const cachedCamps = (cached?.camps as CampLabel[] | null) ?? null;
    if (cached && cached.status !== "pending" && cached.submitted >= subs.length) return cachedCamps;
    if (!(await claimMuseCamps(state.code, state.decision_id, subs.length))) return cachedCamps;
    const decision = await requireDecision(state.decision_id);
    const camps = await museCamps(
      decision,
      state.code,
      subs.map((s) => ({ name: s.player_name, call: s.call, reasons: s.reasons, transcript: s.transcript })),
    );
    await saveMuseCamps(state.code, state.decision_id, camps);
    return camps;
  } catch (err) {
    console.error("camps: Muse labels failed, using factor grouping", err);
    return null;
  }
}

// Lobby submissions on the current decision grouped by factor id, plus Muse Spark camp labels when available.
// Response: { code, decision_id, phase, submitted, by_call: {BOX, STAY, none},
//             camps: [{factor, count, players, quotes}] (largest first), no_factor: {count, players, quotes},
//             labels: [{label, call: BOX|STAY|MIXED, players, count}] | null, labels_source: "muse" | "factors" }
// Host (x-host-token) or a player of this lobby (x-player-token) only; 403 otherwise, also for an unknown code
// (miss-limited). The calls and spoken reasons are the answer, so they stay inside the lobby.
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/camps">) => {
  const code = normalizeCode((await ctx.params).code);
  const { meta } = await requireLobbyMember(req, code);
  if (meta.mode === "race") throw new HttpError(409, "Not available in race mode");
  if (!isRevealed(meta.phase)) throw new HttpError(409, "Camps open at the reveal");
  const state = await getLobbyState(code);
  if (!state) throw new HttpError(404, "Lobby not found");

  const by_call = { BOX: 0, STAY: 0, none: 0 };
  const groups = new Map<string, { factor: string; count: number; players: string[]; quotes: string[] }>();
  const no_factor = { count: 0, players: [] as string[], quotes: [] as string[] };

  for (const s of state.submissions) {
    by_call[s.call ?? "none"]++;
    if (s.factors_named.length === 0) {
      no_factor.count++;
      no_factor.players.push(s.player_name);
      if (s.transcript.trim()) no_factor.quotes.push(clip(s.transcript));
      continue;
    }
    for (const factor of new Set(s.factors_named)) {
      const g = groups.get(factor) ?? { factor, count: 0, players: [], quotes: [] };
      g.count++;
      g.players.push(s.player_name);
      const q = quoteFor(s, factor);
      if (q) g.quotes.push(q);
      groups.set(factor, g);
    }
  }

  const camps = [...groups.values()].sort((a, b) => b.count - a.count || a.factor.localeCompare(b.factor));
  const labels = await campLabels(state);
  return Response.json(
    {
      code, decision_id: state.decision_id, phase: state.phase, submitted: state.submissions.length, by_call, camps, no_factor,
      labels, labels_source: labels ? "muse" : "factors",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
