import { ATTEMPT_CAP, REASONING_CAP, REASONING_FLOOR } from "../scoring";
// Reasoning grades (Round 7). Muse Spark (muse-spark-1.3) scores a reason 0–50 against the decision's rubric
// with a one-line verdict; rubricScore (lib/muse/rubric.ts) is the deterministic fallback whenever Muse is off,
// over budget, fails, or twice returns a grade that credits something the player did not say.
// parseCallLocal reads BOX / STAY and the reason phrases from a transcript, with no model call.
import { z } from "zod";
import type { Call, ParsedCall } from "../types";
import { museJson } from "./client";
import { COPY_RULES_PROMPT, GRADE_TASK } from "./prompt";
import { capFor, gradeProblems, isUngradeable, rubricScore, type Grade, type Rubric } from "./rubric";

export * from "./rubric";

const BOX = /\b(box|pit|pitting|come in|stop now)\b/i;
const STAY = /\b(stay out|stay|don'?t pit|no stop|keep going)\b/i;

export function parseCallLocal(transcript: string): ParsedCall {
  const text = transcript.trim();
  // "stay out" contains no BOX keyword, but "don't pit" does; check STAY first.
  let call: Call | null = null;
  if (STAY.test(text)) call = "STAY";
  else if (BOX.test(text)) call = "BOX";
  const reasons = text
    .split(/[.,;]|\bbecause\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)
    .slice(0, 4);
  return { call, reasons, factors_named: [], transcript: text };
}

const SAID_CHARS = 1000;
const GRADE_TOKENS = 1200; // minimal effort still reasons for a few hundred tokens

export interface GradeContext {
  purpose: string; // "grade_call" | "grade_benchmark"
  lobbyCode: string | null;
  situation: string; // e.g. "Lap 7. Safety car. P1 on 7-lap-old mediums."
}

async function askMuse(rubric: Rubric, call: Call | null, said: string, ctx: GradeContext, note: string | null) {
  const ids = rubric.points.map((p) => p.id);
  return museJson({
    purpose: ctx.purpose,
    lobbyCode: ctx.lobbyCode,
    decisionId: rubric.decision_id,
    instructions: `${COPY_RULES_PROMPT}\n\n${GRADE_TASK}${note ? `\n\nYour last answer was rejected: ${note}. Credit only ideas the "said" field states.` : ""}`,
    input: JSON.stringify({
      situation: ctx.situation,
      outcome: { right_call: rubric.correct, swing_s: rubric.swing_s },
      rubric: rubric.points.map((p) => ({ id: p.id, idea: p.idea, here: p.here, max: p.max })),
      call: call ?? "NONE",
      said: said.slice(0, SAID_CHARS),
    }),
    schemaName: "reason_grade",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["reasoning_score", "verdict", "credited_points"],
      properties: {
        reasoning_score: { type: "integer" },
        verdict: { type: "string" },
        credited_points: { type: "array", items: { type: "string", enum: ids } },
      },
    },
    validator: z.object({ reasoning_score: z.number(), verdict: z.string(), credited_points: z.array(z.string()) }),
    maxOutputTokens: GRADE_TOKENS,
  });
}

// One reason, graded. Empty reasons score 0 without a call; at most two Muse calls (one re-ask on a grounding
// problem), then the deterministic rubric score.
// `ask` is replaceable for hermetic tests (scripts/test-scoring.ts).
export type AskMuse = (rubric: Rubric, call: Call | null, said: string, ctx: GradeContext, note: string | null) => Promise<{ reasoning_score: number; verdict: string; credited_points: string[] } | null>;

// A failed call (Meta answered 404 "model not found" for a few seconds on 2026-10-24) is retried with a backoff
// before falling back to the rubric; each retry is its own budget reservation, so over budget stays over budget.
export const GRADE_RETRY_MS = [1500, 4000];

export async function gradeReason(rubric: Rubric, call: Call | null, transcript: string, ctx: GradeContext, ask: AskMuse = askMuse, retryMs: number[] = GRADE_RETRY_MS): Promise<Grade> {
  const said = transcript.trim();
  if (isUngradeable(said) || rubric.points.length === 0) return rubricScore(rubric, said);
  let note: string | null = null;
  let retries = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await ask(rubric, call, said, ctx, note);
    if (!out) {
      if (retries >= retryMs.length) break; // off, over budget or still failing: rubric
      await new Promise((r) => setTimeout(r, retryMs[retries++]));
      attempt--;
      continue;
    }
    const credited = [...new Set(out.credited_points)];
    const verdict = out.verdict.replace(/\s+/g, " ").trim();
    const problems = gradeProblems(rubric, said, { credited, verdict });
    if (problems.length) {
      console.warn(`muse ${ctx.purpose}: rejected grade (${problems.join("; ")})`);
      note = problems.join("; ");
      continue;
    }
    // A real attempt can reach ATTEMPT_CAP; each credited (grounded) idea adds its maximum on top.
    const cap = ATTEMPT_CAP + capFor(rubric, credited);
    const score = Math.max(REASONING_FLOOR, Math.min(Math.round(out.reasoning_score), cap, REASONING_CAP));
    return { reasoning_score: score, verdict, credited, source: "muse" };
  }
  return rubricScore(rubric, said);
}
