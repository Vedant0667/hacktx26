// Round 7 reasoning rubric (pure, no I/O; unit-tested in scripts/test-scoring.ts).
// Each decision gets a rubric of the ideas that decided its outcome: tyre life and stops still owed, the pit loss
// under SC/VSC against green, what similar cars did, and track position on rejoin. Points per idea depend on
// which call won. Muse Spark grades a reason against it (lib/muse/grade.ts); rubricScore is the deterministic
// fallback, and groundedIn / verdictGrounded keep Muse from crediting ideas that are not in the player's words.
import { COPY } from "../copy";
import type { Call } from "../types";
import { REASONING_MAX } from "../scoring";

export type FactorId = "tyre_age" | "cheap_stop_under_sc" | "cheap_stop_under_vsc" | "similar_cars_pitted" | "track_position";
const KNOWN: FactorId[] = ["tyre_age", "cheap_stop_under_sc", "cheap_stop_under_vsc", "similar_cars_pitted", "track_position"];

export interface RubricPoint {
  id: FactorId;
  label: string; // short, for verdicts: "stops owed", "the cheap SC stop"
  idea: string; // what the idea means, for the model
  here: string; // the facts at this decision, from the engine's reasons and inputs
  max: number;
}

export interface Rubric {
  decision_id: string;
  correct: Call;
  swing_s: number;
  trigger: "SC" | "VSC" | "GREEN";
  points: RubricPoint[];
}

export interface RubricInput {
  decision_id: string;
  factors: string[];
  correct: Call;
  swing_s: number;
  trigger: "SC" | "VSC" | "GREEN";
  engine_reasons: string[];
  position?: number | null;
  stops_owed?: number | null;
}

// Points per idea by the winning call, summing to 50 over the ideas a decision has (rescaled when fewer).
const WEIGHTS: Record<Call, Record<"tyre" | "cheap" | "field" | "track", number>> = {
  BOX: { tyre: 15, cheap: 15, field: 12, track: 8 },
  STAY: { tyre: 14, cheap: 10, field: 10, track: 16 },
};
const kindOf = (id: FactorId) =>
  id === "tyre_age" ? "tyre" : id === "similar_cars_pitted" ? "field" : id === "track_position" ? "track" : "cheap";

const MEANING: Record<FactorId, string> = {
  tyre_age:
    "Tyre life: the tyres are old or will not last, or the car still owes a stop under the stint cap, so stopping now costs nothing extra ('we need to pit once more anyway', 'need another stop', 'tyres won't last').",
  cheap_stop_under_sc:
    "Pit loss: a stop costs less time under the safety car than at green ('cheap stop', 'free stop', 'lose less time'). Naming the safety car alone does not count.",
  cheap_stop_under_vsc:
    "Pit loss: a stop costs less time under the virtual safety car than at green ('cheap stop', 'lose less time'). Naming the VSC alone does not count.",
  similar_cars_pitted: "What similar cars did: rivals, the field, cars ahead or behind are pitting or have pitted ('everyone's pitting', 'cover them').",
  track_position: "Track position: places lost or kept, traffic or dirty air on rejoin, how hard it is to pass ('lose the lead', 'traffic').",
};

const DEFAULT_HERE: Record<FactorId, (i: RubricInput) => string> = {
  tyre_age: () => "Tyre age against the laps left.",
  cheap_stop_under_sc: () => "A stop under the safety car costs less than at green.",
  cheap_stop_under_vsc: () => "A stop under the VSC costs less than at green.",
  similar_cars_pitted: () => "What the cars around did at this lap.",
  track_position: (i) => (i.position ? `Running P${i.position}; places at risk on rejoin.` : "Places at risk on rejoin."),
};
const REASON_FOR: Record<FactorId, RegExp> = {
  tyre_age: /\btyres?\b/i,
  cheap_stop_under_sc: /\bstop costs\b/i,
  cheap_stop_under_vsc: /\bstop costs\b/i,
  similar_cars_pitted: /\b(pitted|expected to pit|cars? (ahead|behind))\b/i,
  track_position: /\b(leading|position|P\d+)\b/,
};

export function buildRubric(i: RubricInput): Rubric {
  const ids = [...new Set(i.factors)].filter((f): f is FactorId => KNOWN.includes(f as FactorId));
  // Under green a cheaper stop is not on offer, whatever the factor list says.
  const usable = ids.filter((f) => i.trigger !== "GREEN" || !f.startsWith("cheap_stop"));
  const w = WEIGHTS[i.correct];
  const raw = usable.map((id) => w[kindOf(id)]);
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const maxes = raw.map((r) => Math.floor((r / sum) * REASONING_MAX));
  // Hand the rounding remainder to the heaviest ideas so the maxima sum to exactly 50.
  let rest = REASONING_MAX - maxes.reduce((a, b) => a + b, 0);
  for (const k of raw.map((r, idx) => [r, idx]).sort((a, b) => b[0] - a[0]).map(([, idx]) => idx)) {
    if (rest <= 0) break;
    maxes[k]++;
    rest--;
  }
  const owed = (i.stops_owed ?? 0) > 0 || i.engine_reasons.some((r) => /stops? owed/i.test(r));
  const points = usable.map((id, k) => ({
    id,
    label: id === "tyre_age" && owed ? COPY.grade.labels.stops_owed : (COPY.grade.labels[id] ?? id),
    idea: MEANING[id],
    here: i.engine_reasons.find((r) => REASON_FOR[id].test(r)) ?? DEFAULT_HERE[id](i),
    max: maxes[k],
  }));
  return { decision_id: i.decision_id, correct: i.correct, swing_s: i.swing_s, trigger: i.trigger, points };
}

// ---- What the player said ----

const CALL_WORDS = /\b(box(\s*,?\s*box)*|stay(ing)? out|stay|pit(ting)?|pit now|come in|don'?t pit|no stop|keep going|go|now|ok(ay)?|yes|no|um+|uh+|er+|like|so|and|the|a|an|i|we|it|is|it's|let's|call|my|out)\b/gi;

// Content words left after the call words and filler: "box box" and "stay out" have none.
export function reasonWords(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .replace(CALL_WORDS, " ")
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 2);
}

// Empty or near-empty: nothing left after the call words and filler ("box", "box box", "stay out", "um, box
// now"). Scores 0 with "No reason given." and no Muse call.
export function isEmptyReason(transcript: string): boolean {
  return reasonWords(transcript).length === 0;
}

// Ideas as players say them (fallback scorer). Each idea is credited at most once.
const CHEAP =
  /\b(cheap\w*|free (stop|pit\w*)|stop is free|it'?s free|for free|discount\w*|half[- ]price|bargain|costs? (less|nothing|half)|less time|lose less|losing less|pit ?loss|time loss|sav(e|es|ing|ed) (time|seconds)|only lose|smaller loss)\b/i;
export const IDEAS: Record<FactorId, RegExp[]> = {
  tyre_age: [
    /\b(tyres?|tires?|rubber|softs?|mediums?|hards?|compound)\b[^.;]*\b(old|worn|dead|gone|cooked|done|shot|finished|wear\w*|deg\w*|falling off|graining|laps? old|won'?t last|not (going to )?last|struggl\w*|going off)\b/i,
    /\b(old|worn|dead|cooked|used|tired)\b[^.;]*\b(tyres?|tires?|rubber|softs?|mediums?|hards?)\b/i,
    /\b(won'?t|will not|not going to|can'?t|cannot) (last|make it)\b/i,
    /\b(pit|stop|box)\w*\s+(once more|one more time|again)\b/i,
    /\bonce more\b/i,
    /\b(another|one more|extra|second|third|2nd|3rd|later) (stop|pit ?stop|pit)\b/i,
    /\b(need|have|got|going|gonna) to (pit|stop|box)\b[^.;]*\b(again|anyway|later|eventually|at some point)\b/i,
    /\b(pit|stop|box)\w*\b[^.;]*\banyway\b/i,
    /\b(two|2|three|3)[- ]stop/i,
    /\bstops? (owed|left|to make|remaining|still to)\b/i,
    /\bstint (cap|limit|length)\b/i,
    /\b(fresh|new) (tyres?|tires?|rubber|set)\b/i,
  ],
  cheap_stop_under_sc: [CHEAP],
  cheap_stop_under_vsc: [CHEAP],
  similar_cars_pitted: [
    /\b(every(one|body)|the field|others?|rivals?|they|the pack|(other|rival|nearby) cars|cars? (around|behind|ahead|in front)|competitors?|verstappen|max|norris|lando|leclerc|russell|hamilton|antonelli|piastri|oscar|sainz|alonso)\b[^.;]*\b(pit\w*|box\w*|stop\w*|coming in|came in)\b/i,
    /\b(cover|covering|follow|match|copy)\w* (them|the|him|rivals?|everyone|the field)\b/i,
    /\bundercut\b/i,
    /\bsame as (everyone|the others|rivals|the field)\b/i,
  ],
  track_position: [
    /\btrack position\b/i,
    /\b(lose|losing|lost|keep|keeping|hold|holding|give up|giving up|drop|dropping|gain|gaining)\b[^.;]*\b(the lead|lead|positions?|places?|p\d{1,2})\b/i,
    /\btraffic\b/i,
    /\b(dirty|clean) air\b/i,
    /\b(overtak\w*|pass\w*)\b[^.;]*\b(hard|difficult|tough|impossible)\b/i,
    /\bcan'?t (overtake|pass)\b/i,
    /\b(rejoin|come out|comes out|exit)\w*\b[^.;]*\b(behind|ahead|in front|traffic|p\d+)\b/i,
  ],
};

// Broader terms per idea: a Muse credit survives only if the transcript holds one of these (or the idea itself).
export const GROUND_TERMS: Record<FactorId, RegExp> = {
  tyre_age:
    /\b(tyres?|tires?|rubber|softs?|mediums?|hards?|compound|deg\w*|wear\w*|worn|grip|stint|old|fresh|last|once more|again|another|anyway|stops?|two[- ]stop)\b/i,
  cheap_stop_under_sc: CHEAP,
  cheap_stop_under_vsc: CHEAP,
  similar_cars_pitted:
    /\b(every(one|body)|field|others?|rivals?|pitted|pitting|boxed|boxing|competitors?|pack|cars?|they('re| are| all)?|cover\w*|undercut|verstappen|max|norris|lando|leclerc|russell|hamilton|antonelli|piastri|oscar|sainz|alonso)\b/i,
  track_position: /\b(track position|positions?|places?|lead\w*|traffic|air|overtak\w*|pass\w*|rejoin|front|ahead|behind|p\d{1,2})\b/i,
};

export function groundedIn(id: string, transcript: string): boolean {
  const f = id as FactorId;
  if (!KNOWN.includes(f)) return false;
  return GROUND_TERMS[f].test(transcript) || IDEAS[f].some((re) => re.test(transcript));
}

export function ideasIn(rubric: Rubric, transcript: string): FactorId[] {
  return rubric.points.filter((p) => IDEAS[p.id].some((re) => re.test(transcript))).map((p) => p.id);
}

const listOf = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));

// The fallback verdict: what they named, and the heaviest idea they missed.
export function verdictFor(rubric: Rubric, credited: string[]): string {
  if (!rubric.points.length || !credited.length) return COPY.grade.none;
  const named = rubric.points.filter((p) => credited.includes(p.id));
  const missed = rubric.points.filter((p) => !credited.includes(p.id)).sort((a, b) => b.max - a.max);
  if (!missed.length) return COPY.grade.all;
  return COPY.grade.some(listOf(named.map((p) => p.label)), missed[0].label);
}

export interface Grade {
  reasoning_score: number;
  verdict: string;
  credited: string[]; // rubric ids
  source: "muse" | "rubric" | "empty";
}

// Deterministic fallback: full points for each idea the words state, capped at 50.
export function rubricScore(rubric: Rubric, transcript: string): Grade {
  if (isEmptyReason(transcript)) return { reasoning_score: 0, verdict: COPY.grade.empty, credited: [], source: "empty" };
  const credited = ideasIn(rubric, transcript);
  const score = Math.min(REASONING_MAX, rubric.points.filter((p) => credited.includes(p.id)).reduce((a, p) => a + p.max, 0));
  return { reasoning_score: score, verdict: verdictFor(rubric, credited), credited, source: "rubric" };
}

// ---- Checks on a Muse grade ----

const VERDICT_TERMS: Record<FactorId, RegExp> = {
  tyre_age: /\b(tyres?|tires?|stops? (still )?owed|another stop|stint|stop again|once more)\b/i,
  cheap_stop_under_sc: /\b(cheap\w*|free stop|pit loss|stop costs?|costs? less|lose less)\b/i,
  cheap_stop_under_vsc: /\b(cheap\w*|free stop|pit loss|stop costs?|costs? less|lose less)\b/i,
  similar_cars_pitted: /\b(rivals?|the field|others|everyone|similar cars|nearby cars|cars (around|ahead|behind)|pitted)\b/i,
  track_position: /\b(track position|traffic|rejoin|the lead|positions?|places)\b/i,
};
const NEGATION = /\b(miss\w*|no|not|never|without|didn'?t|did not|ignor\w*|left out|skip\w*|lack\w*|overlook\w*|nothing|none|but)\b/i;
export const VERDICT_WORDS = 18;

// Problems with a Muse grade, or [] when it may stand. A credited idea must be grounded in the transcript; the
// verdict may name an idea the player did not say only to say it was missed, and may hold no number that is
// in neither the transcript nor the rubric.
export function gradeProblems(rubric: Rubric, transcript: string, g: { credited: string[]; verdict: string }): string[] {
  const out: string[] = [];
  const ids = new Set(rubric.points.map((p) => p.id as string));
  for (const c of g.credited) {
    if (!ids.has(c)) out.push(`unknown idea ${c}`);
    else if (!groundedIn(c, transcript)) out.push(`credited ${c} not in the words`);
  }
  const v = g.verdict.trim();
  if (!v) out.push("empty verdict");
  if (v.split(/\s+/).length > VERDICT_WORDS) out.push("verdict too long");
  if (/[!—]|--/.test(v)) out.push("verdict punctuation");
  const known = new Set(`${transcript} ${rubric.points.map((p) => p.here).join(" ")} 50`.match(/\d+(\.\d+)?/g) ?? []);
  for (const n of v.match(/\d+(\.\d+)?/g) ?? []) if (!known.has(n)) out.push(`verdict number ${n}`);
  for (const clause of v.split(/[;,.]|\bbut\b|\band\b/i)) {
    for (const p of rubric.points) {
      if (VERDICT_TERMS[p.id].test(clause) && !groundedIn(p.id, transcript) && !NEGATION.test(clause)) out.push(`verdict credits ${p.id}`);
    }
  }
  return out;
}

// The score Muse may give: never above the summed maxima of the ideas it credited (after grounding).
export function capFor(rubric: Rubric, credited: string[]): number {
  return Math.min(REASONING_MAX, rubric.points.filter((p) => credited.includes(p.id)).reduce((a, p) => a + p.max, 0));
}
