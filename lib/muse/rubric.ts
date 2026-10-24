// Round 7 reasoning rubric (pure, no I/O; unit-tested in scripts/test-scoring.ts).
// Each decision gets a rubric of the ideas that decided its outcome: tyre life and stops still owed, the pit loss
// under SC/VSC against green, what similar cars did, and track position on rejoin. The facts come from the race
// data only (frames, pit loss, comparison cars), never from the engine, so the engine is graded like a player.
// Points per idea depend on which call won. Muse Spark grades a reason against it (lib/muse/grade.ts); rubricScore is the deterministic
// fallback, and groundedIn / verdictGrounded keep Muse from crediting ideas that are not in the player's words.
import { COPY } from "../copy";
import type { Call } from "../types";
import { FALLBACK_SLOPE, REASONING_FLOOR, REASONING_MAX } from "../scoring";

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

// What the pit wall knew at the call, plus the comparison cars, from the race data.
export interface RubricFacts {
  position?: number | null;
  compound?: string | null;
  tyre_age?: number | null;
  laps_left?: number | null;
  stopped_yet?: boolean | null; // false: no stop yet in a dry race, so at least one stop is still owed
  pit_loss_green_s?: number | null;
  field?: { pitted: number; of: number; from: number; to: number } | null; // cars that pitted on those laps
  comparison?: { boxed: number; stayed: number } | null; // comparison cars within 3 places, by call
}

export interface RubricInput {
  decision_id: string;
  factors: string[];
  correct: Call;
  swing_s: number;
  trigger: "SC" | "VSC" | "GREEN";
  facts: RubricFacts;
}

// Pit loss under a neutralisation as a share of the green-flag loss (same factors as lib/client/race.ts).
export const NEUTRAL_LOSS = { SC: 0.5, VSC: 0.75, GREEN: 1 } as const;

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

const owesStop = (f: RubricFacts) => f.stopped_yet === false && (f.laps_left ?? 1) > 0;
const n1 = (x: number) => x.toFixed(1);

// The facts at this decision for each idea, in plain words for the model.
const HERE: Record<FactorId, (i: RubricInput) => string> = {
  tyre_age: ({ facts: f }) => {
    const tyres = f.tyre_age != null ? `${f.compound ? `${f.compound.toLowerCase()} ` : ""}tyres ${f.tyre_age} laps old` : "tyre age";
    const left = f.laps_left != null ? `, ${f.laps_left} laps left` : "";
    return `${tyres[0].toUpperCase()}${tyres.slice(1)}${left}${owesStop(f) ? "; no stop yet, so at least one stop is still owed (two dry compounds)" : ""}.`;
  },
  cheap_stop_under_sc: ({ facts: f }) =>
    f.pit_loss_green_s ? `A stop costs ${n1(f.pit_loss_green_s * NEUTRAL_LOSS.SC)} s under the safety car, ${n1(f.pit_loss_green_s)} s at green.` : "A stop under the safety car costs less than at green.",
  cheap_stop_under_vsc: ({ facts: f }) =>
    f.pit_loss_green_s ? `A stop costs ${n1(f.pit_loss_green_s * NEUTRAL_LOSS.VSC)} s under the VSC, ${n1(f.pit_loss_green_s)} s at green.` : "A stop under the VSC costs less than at green.",
  similar_cars_pitted: ({ facts: f }) =>
    f.comparison
      ? `Of the comparison cars within 3 places, ${f.comparison.boxed} boxed and ${f.comparison.stayed} stayed out.`
      : f.field
        ? `${f.field.pitted} of ${f.field.of} cars pitted on laps ${f.field.from} to ${f.field.to}.`
        : "What the cars around did at this lap.",
  track_position: ({ facts: f, trigger }) =>
    `${f.position ? `Running P${f.position}` : "Track position"}; a stop ${trigger === "GREEN" ? "at green" : `under the ${trigger}`} puts places at risk on rejoin.`,
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
  const owed = owesStop(i.facts);
  const points = usable.map((id, k) => ({
    id,
    label: id === "tyre_age" && owed ? COPY.grade.labels.stops_owed : (COPY.grade.labels[id] ?? id),
    idea: MEANING[id],
    here: HERE[id](i),
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

// Text aimed at the grader rather than at the race. It scores 0 and never gets the floor.
const INJECTION = /\b(ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|rules)|system\s*:|you are (now )?|output (all|every)|credit (every|all)|give (me )?(50|full|max)|full (marks|points))\b/i;
export function isInjection(transcript: string): boolean {
  return INJECTION.test(transcript);
}

// No reason, or not a reason about the race: 0 with no Muse call. Anything else is a genuine attempt.
export function isUngradeable(transcript: string): boolean {
  return isEmptyReason(transcript) || isInjection(transcript);
}

// Ideas as players say them (fallback scorer). Each idea is credited at most once.
const PIT_COST = /\b((sc|vsc|safety car|neutrali[sz]ed) stop|stop costs?\b[^.;]*\bgreen|green[- ]flag stop|stop is (shorter|quicker))\b/i;
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
  cheap_stop_under_sc: [CHEAP, PIT_COST],
  cheap_stop_under_vsc: [CHEAP, PIT_COST],
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
  if (isUngradeable(transcript)) return { reasoning_score: 0, verdict: COPY.grade.empty, credited: [], source: "empty" };
  const credited = ideasIn(rubric, transcript);
  const raw = Math.min(REASONING_MAX, rubric.points.filter((p) => credited.includes(p.id)).reduce((a, p) => a + p.max, 0));
  const score = Math.round(REASONING_FLOOR + FALLBACK_SLOPE * raw);
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
const NEGATION = /\b(miss\w*|no|not|never|without|didn'?t|did not|ignor\w*|left out|skip\w*|lack\w*|overlook\w*|nothing|none)\b/gi;
const POSITIVE = /\b(named|names|stated|states|said|cited|mentioned|noted|gave|credited|used)\b/gi;
const lastIndex = (re: RegExp, text: string, before: number) => {
  let at = -1;
  for (const m of text.matchAll(re)) if ((m.index ?? 0) < before) at = m.index ?? 0;
  return at;
};
// True when the mention at `at` sits in a "missed ..." stretch: the nearest cue before it is a negation.
const negatedAt = (clause: string, at: number) => lastIndex(NEGATION, clause, at) > lastIndex(POSITIVE, clause, at);
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
  // Clauses split on ";", "." and "but"; a list after "missed" stays negated ("missed the cheap stop and rivals").
  for (const clause of v.split(/[;.]|\bbut\b/i)) {
    for (const p of rubric.points) {
      if (groundedIn(p.id, transcript)) continue;
      const m = VERDICT_TERMS[p.id].exec(clause);
      if (m && !negatedAt(clause, m.index)) out.push(`verdict credits ${p.id}`);
    }
  }
  return out;
}

// The score Muse may give: never above the summed maxima of the ideas it credited (after grounding).
export function capFor(rubric: Rubric, credited: string[]): number {
  return Math.min(REASONING_MAX, rubric.points.filter((p) => credited.includes(p.id)).reduce((a, p) => a + p.max, 0));
}
