// Round 9: luck-aware verdicts (security-contract.md Round 9). Pure helpers, no I/O, tested in scripts/test-luck.ts.
//
// The right call is the measured outcome (seconds against comparable cars), except when an event nobody could
// foresee at the call (an SC or VSC deployed later, a red flag, rain starting or stopping) happened before the
// measurement ended. engine/build.py marks those rows with luck_events; scripts/ai-verdicts.mjs asks Muse Spark
// once per row which call was right given only what was knowable at the call, checks the answer with
// verdictProblems, and stores it in ai_verdicts. lib/data.ts merges an accepted verdict with applyVerdict.
// The stakes always come from the measured swing.
import type { Call } from "./types";

export type LuckKind = "SC" | "VSC" | "RED_FLAG" | "RAIN_START" | "RAIN_STOP";
export interface LuckEvent {
  lap: number;
  kind: LuckKind;
}

// The verdict fields every full freeze and full driver answer carries after lib/data.ts has loaded it.
export interface LuckVerdict {
  final_right_call: Call; // the call scored as right: the accepted AI verdict, else the measured answer
  luck: boolean; // an accepted verdict says a luck event changed the measured outcome
  luck_events: LuckEvent[]; // [] when nothing unforeseeable happened before the measurement ended
  explanation: string | null; // the accepted verdict's one line, else null
  verdict_source: "ai" | "measured";
}

// A row of table ai_verdicts as lib/data.ts reads it.
export interface StoredVerdict {
  status: "accepted" | "rejected" | "no_answer";
  measured_correct: Call;
  luck_events: LuckEvent[];
  final_right_call: Call;
  luck_changed_outcome: boolean | null;
  explanation: string | null;
}

const sameEvents = (a: LuckEvent[], b: LuckEvent[]) =>
  a.length === b.length && a.every((e, i) => e.lap === b[i].lap && e.kind === b[i].kind);

// The measured answer unless an accepted verdict exists for the same measured answer and the same luck events
// (a re-seed that changed either makes the stored verdict stale). A verdict never flips the call without luck.
export function applyVerdict(measured: Call, events: LuckEvent[] | null | undefined, v: StoredVerdict | null | undefined): LuckVerdict {
  const luck_events = events ?? [];
  const base: LuckVerdict = { final_right_call: measured, luck: false, luck_events, explanation: null, verdict_source: "measured" };
  if (!luck_events.length || !v || v.status !== "accepted") return base;
  if (v.measured_correct !== measured || !sameEvents(v.luck_events ?? [], luck_events)) return base;
  if (v.final_right_call !== measured && !v.luck_changed_outcome) return base;
  return { final_right_call: v.final_right_call, luck: Boolean(v.luck_changed_outcome), luck_events, explanation: v.explanation, verdict_source: "ai" };
}

// The fields the end-of-game payloads add (never before the end: Round 9).
export function luckView(x: Partial<LuckVerdict> & { correct: Call }): LuckVerdict {
  return {
    final_right_call: x.final_right_call ?? x.correct,
    luck: x.luck ?? false,
    luck_events: x.luck_events ?? [],
    explanation: x.explanation ?? null,
    verdict_source: x.verdict_source ?? "measured",
  };
}

// ---- The Muse request (scripts/ai-verdicts.mjs) ----

export const EXPLANATION_WORDS = 20;
export const VERDICT_PROMPT_VERSION = "v1";

export const VERDICT_TASK = `You judge one Formula 1 pit-stop call after the race. Output JSON only, matching the schema.
Input: "at_the_call" is everything the pit wall knew when the call was due on that lap: position, gaps to the cars
ahead and behind, tyres and their ages, stops made and still owed, laps left, the pit loss under the flag at the
call and under green, and what nearby cars had done. "after_the_call" lists events nobody could foresee (a safety
car, virtual safety car, red flag, or rain starting or stopping) and, for a safety car or VSC, which comparison cars
stopped under it. "measured" is the result in seconds against comparable cars: the call whose group gained time
and the size of that gain (swing_s).
1. "right_call": BOX (stop inside box_window) or STAY, judged only on "at_the_call". Weigh tyre age and stops owed
   against laps left, the pit loss, the gaps, and what nearby cars had done.
2. "luck_changed_outcome": true only if an event in "after_the_call" decided which group came out ahead, for example
   cars that stayed out then got a much cheaper stop under it. If the measured winner would have won anyway, false.
3. right_call may differ from measured.right_call_by_measurement only when luck_changed_outcome is true.
4. "explanation": one plain clause, at most ${EXPLANATION_WORDS} words, that names the event by lap and what it did, such as
   which cars it gave a cheaper stop. Copy every lap, number and car code from the input. Never compute a number.
   No hedging words, no exclamation marks, no em dashes, no second person, never mention AI.`;

export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["right_call", "luck_changed_outcome", "explanation"],
  properties: {
    right_call: { type: "string", enum: ["BOX", "STAY"] },
    luck_changed_outcome: { type: "boolean" },
    explanation: { type: "string" },
  },
} as const;

export interface AiVerdict {
  right_call: Call;
  luck_changed_outcome: boolean;
  explanation: string;
}

// The JSON sent to Muse for one row (engine/build.py luck_facts): call-moment facts, post-call events, result.
export function verdictInput(facts: { call: unknown; after_call: unknown; measured: unknown }): string {
  return JSON.stringify({ at_the_call: facts.call, after_the_call: facts.after_call, measured: facts.measured });
}

const EVENT_TERMS: { re: RegExp; needs: RegExp; what: string }[] = [
  { re: /\bred[- ]flag/i, needs: /RED_FLAG/, what: "red flag" },
  { re: /\bvsc\b|\bvirtual safety car\b/i, needs: /"VSC"/, what: "VSC" },
  { re: /(?<!virtual )\bsafety car\b|\bSC\b/, needs: /"SC"/, what: "safety car" },
  { re: /\brain\w*|\bwet\b|\bshowers?\b|\bdrizzle\b|\bdr(y|ied) (up|out)\b/i, needs: /RAIN_(START|STOP)/, what: "rain" },
];
const COMPOUNDS = /\b(soft|medium|hard|intermediate|inter|wet)s?\b/gi;

// Problems with an answer, or [] when it may stand. Rejected: a different call from the measured one without
// luck; an explanation that is empty, too long, uses dashes or exclamation marks, or cites a number, car, event
// or compound that is not in the input.
export function verdictProblems(out: AiVerdict, input: string, measured: Call): string[] {
  const p: string[] = [];
  if (out.right_call !== measured && !out.luck_changed_outcome) p.push("right_call disagrees with the measured result but luck_changed_outcome is false");
  const e = out.explanation.trim();
  const words = e.split(/\s+/).filter(Boolean);
  if (!words.length) p.push("explanation empty");
  if (words.length > EXPLANATION_WORDS) p.push(`explanation over ${EXPLANATION_WORDS} words`);
  if (/[!—–]|--/.test(e)) p.push("explanation punctuation");
  const numbers = new Set(input.match(/\d+(\.\d+)?/g) ?? []);
  for (const n of e.match(/\d+(\.\d+)?/g) ?? []) if (!numbers.has(n)) p.push(`number ${n} not in the input`);
  const codes = new Set(input.match(/"[A-Z]{3}"/g)?.map((c) => c.slice(1, -1)) ?? []);
  for (const c of e.match(/\b[A-Z]{3}\b/g) ?? []) if (c !== "VSC" && !codes.has(c)) p.push(`car ${c} not in the input`);
  for (const t of EVENT_TERMS) if (t.re.test(e) && !t.needs.test(input)) p.push(`${t.what} not in the input`);
  const low = input.toLowerCase();
  for (const m of e.matchAll(COMPOUNDS)) {
    const c = m[1].toLowerCase();
    if (c !== "wet" && !low.includes(c)) p.push(`compound ${c} not in the input`);
  }
  return p;
}
