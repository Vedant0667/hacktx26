import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSubmission, getTotals, insertSubmission, claimSubmission, getRaceCall, insertRaceCall, type DriverSubmission, type LobbyMeta, type RaceCallRow } from "@/lib/db";
import { decisionForDriver, getRaceEntry, getRaceFreezes } from "@/lib/data";
import { parseCallLocal, rubricScore } from "@/lib/muse";
import { CALL_WINDOW_S, percentile, scoreCall } from "@/lib/scoring";
import { momentRubric } from "../../../_lib/grading";
import { lobbyMetaGuarded } from "../../../_lib/access";
import { driverFor, handle, HttpError, normalizeCode, readBody, requireDecision, tokenMatches } from "../../../_lib/http";
import { currentFreeze, freezeDecision, freezeRubric, type RacePhase } from "../../../_lib/race";

const REVEAL_GRACE_S = 2;

const Body = z.object({
  player_name: z.string().trim().min(1).max(24),
  transcript: z.string().max(4000),
  // Ignored: the server times the call from the start of the decision phase.
  seconds_to_call: z.number().min(0).max(3600).optional(),
  // The BOX / STAY OUT button on the phone, when pressed, wins over the parsed transcript.
  call: z.enum(["BOX", "STAY"]).nullable().optional(),
});

const hidden = (c: RaceCallRow): RaceCallRow => ({ ...c, score_call: 0, score_reasoning: 0, total: 0, verdict: null, credited: [], factors_named: [] });

// Round 6: a call on the current freeze of a race lobby, for the player's own car. Round 7: stored with the
// provisional rubric grade and no Muse call; the reveal grading (app/api/_lib/grading.ts) replaces it.
// Scores stay hidden until reveal_freeze.
async function raceSubmit(code: string, player: string, meta: LobbyMeta, transcript: string, buttonCall: "BOX" | "STAY" | null): Promise<Response> {
  const lateRace = meta.phase === "reveal_freeze" && meta.phase_elapsed_s < REVEAL_GRACE_S;
  if (meta.phase !== "freeze" && !lateRace) throw new HttpError(409, "Calls are closed for this moment");
  const f = currentFreeze({ phase: meta.phase as RacePhase, plan: meta.freeze_plan, freeze_index: meta.freeze_index });
  const car = meta.player_driver_code;
  if (!f || !car || !f.drivers.includes(car)) throw new HttpError(409, "No call needed for your car at this lap");
  const raceKey = meta.race_key!;
  const existing = await getRaceCall(code, player, "freeze", f.lap);
  if (existing) return Response.json({ submission: meta.phase === "freeze" ? hidden(existing) : existing, duplicate: true });
  // Look the freeze up before claiming, so a missing row can't leave the player stuck on "being graded".
  const [race, freezes] = await Promise.all([getRaceEntry(raceKey), getRaceFreezes(raceKey)]);
  const freeze = freezes.find((x) => x.lap === f.lap && x.driver_code === car);
  if (!race || !freeze) throw new HttpError(404, "Freeze data not found");
  if (!(await claimSubmission(code, player, `race:${raceKey}:L${f.lap}`))) {
    const stored = await getRaceCall(code, player, "freeze", f.lap);
    if (!stored) throw new HttpError(409, "Your call is already in and being graded");
    return Response.json({ submission: hidden(stored), duplicate: true });
  }
  const decision = freezeDecision(raceKey, race.name, freeze);
  const parsed = parseCallLocal(transcript);
  const finalCall = buttonCall ?? parsed.call;
  const grade = rubricScore(freezeRubric(raceKey, freeze), parsed.transcript);
  const score = scoreCall(decision, finalCall, grade.reasoning_score);
  const seconds_to_call = meta.phase === "freeze" ? Math.min(CALL_WINDOW_S, Math.round(meta.phase_elapsed_s * 10) / 10) : CALL_WINDOW_S;
  const { call: row, duplicate } = await insertRaceCall(code, {
    kind: "freeze", lap: f.lap, player_name: player, driver_code: car, call: finalCall,
    reasons: parsed.reasons, factors_named: grade.credited, transcript: parsed.transcript,
    seconds_to_call, status: "scored", ...score, verdict: grade.verdict, credited: grade.credited,
  });
  return Response.json(
    { submission: meta.phase === "freeze" ? hidden(row) : row, duplicate },
    { status: duplicate ? 200 : 201 },
  );
}

// Before the reveal nothing in the response may hint at the answer: no scores, verdict or credited ideas.
const hideScores = (s: DriverSubmission): DriverSubmission => ({ ...s, score_call: 0, score_reasoning: 0, total: 0, verdict: null, credited: [], factors_named: [] });

// Requires x-player-token (from join) for player_name. Scored against the player's own car (Round 4).
// Response: { submission, percentile, lobby_rank, lobby_players_submitted, duplicate }.
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/submit">) => {
  const code = normalizeCode((await ctx.params).code);
  const { player_name, transcript, call } = await readBody(req, Body);

  // Miss-limited lookup; an unknown code answers 403 like a wrong token, so it does not reveal which codes exist.
  const denied = `This device is not signed in as ${player_name} in this lobby`;
  const { meta } = await lobbyMetaGuarded(req, code, player_name, denied);
  if (!meta.is_player || !tokenMatches(req.headers.get("x-player-token"), meta.player_token_hash)) {
    throw new HttpError(403, denied);
  }
  if (meta.mode === "race") return raceSubmit(code, player_name, meta, transcript, call ?? null);
  // Calls count during the decision, plus a short grace for auto-sends in flight when the host reveals.
  const late = meta.phase === "reveal" && meta.phase_elapsed_s < REVEAL_GRACE_S;
  if (meta.phase !== "decision" && !late) throw new HttpError(409, "Calls are closed for this moment");
  const seconds_to_call = meta.phase === "decision" ? Math.min(CALL_WINDOW_S, Math.round(meta.phase_elapsed_s * 10) / 10) : CALL_WINDOW_S;
  const base = await requireDecision(meta.decision_id);
  const driver = await driverFor(base.id, meta.player_driver_code, meta.driver_code);
  const decision = decisionForDriver(base, driver);

  // First submission wins. A re-submit returns the stored row before any Muse call is made.
  const existing = meta.has_submitted ? await getSubmission(code, player_name, decision.id) : null;
  let submission: DriverSubmission;
  let duplicate: boolean;
  if (existing) {
    submission = existing;
    duplicate = true;
  } else {
    if (!(await claimSubmission(code, player_name, decision.id))) {
      // Another request for this player is already grading; that one returns the result.
      const stored = await getSubmission(code, player_name, decision.id);
      if (!stored) throw new HttpError(409, "Your call is already in and being graded");
      return Response.json({ submission: hideScores(stored), percentile: null, lobby_rank: null, lobby_players_submitted: null, duplicate: true });
    }
    // Round 7: store the call and words with a provisional rubric grade; no Muse call here. Reasoning is graded
    // once at the reveal. The phone's BOX / STAY button wins over the parsed transcript for the call.
    const parsed = parseCallLocal(transcript);
    const finalCall = call ?? parsed.call;
    const grade = rubricScore(momentRubric(decision), parsed.transcript);
    const score = scoreCall(decision, finalCall, grade.reasoning_score);
    ({ submission, duplicate } = await insertSubmission({
      lobby_code: code,
      player_name,
      decision_id: decision.id,
      call: finalCall,
      reasons: parsed.reasons,
      factors_named: grade.credited,
      transcript: parsed.transcript,
      seconds_to_call, // stored for display only; it affects neither points nor rank
      ...score,
      driver_code: driver.code,
      verdict: grade.verdict,
      credited: grade.credited,
    } satisfies DriverSubmission));
  }

  // The score gives away the answer, so it stays hidden until the reveal; the phone reads it from the leaderboard then.
  if (meta.phase === "decision") {
    return Response.json(
      {
        submission: hideScores(submission),
        percentile: null,
        lobby_rank: null,
        lobby_players_submitted: null,
        duplicate,
      },
      { status: duplicate ? 200 : 201 },
    );
  }
  const totals = await getTotals(decision.id, code);
  return Response.json(
    {
      submission,
      percentile: percentile(submission.total, totals.global),
      lobby_rank: 1 + totals.lobby.filter((t) => t > submission.total).length, // shared on equal totals
      lobby_players_submitted: totals.lobby.length,
      duplicate,
    },
    { status: duplicate ? 200 : 201 },
  );
});
