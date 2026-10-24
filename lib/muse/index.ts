// Voice-call parsing. Today this is a keyword parser; parseWithMuse replaces it once the Meta Model API key has billing.
import type { Call, ParsedCall } from "../types";

const BOX = /\b(box|pit|pitting|come in|stop now)\b/i;
const STAY = /\b(stay out|stay|don'?t pit|no stop|keep going)\b/i;

const FACTOR_PATTERNS: Record<string, RegExp> = {
  tyre_age: /\b(tyres?|tires?)\b.*\b(old|worn|age|laps?|dead|gone|cooked)\b|\b(old|worn|dead|cooked)\b.*\b(tyres?|tires?)\b/i,
  // Naming the safety car alone isn't the factor; the reason has to be that the stop is cheaper under it.
  cheap_stop_under_sc: /\b(cheap|cheaper|free stop|half price|costs? less|less time|pit loss|time loss)\b/i,
  similar_cars_pitted: /\b(everyone|field|others|rivals|they all|cars? (around|behind|ahead)|verstappen|pitted|boxing)\b/i,
  track_position: /\b(track position|position|overtake|pass|dirty air|lead)\b/i,
};

export function parseCallLocal(transcript: string): ParsedCall {
  const text = transcript.trim();
  // "stay out" contains no BOX keyword, but "don't pit" does; check STAY first.
  let call: Call | null = null;
  if (STAY.test(text)) call = "STAY";
  else if (BOX.test(text)) call = "BOX";
  const factors_named = Object.entries(FACTOR_PATTERNS)
    .filter(([, re]) => re.test(text))
    .map(([f]) => f);
  const reasons = text
    .split(/[.,;]|\bbecause\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  return { call, reasons, factors_named, transcript: text };
}

export async function parseCall(transcript: string): Promise<ParsedCall> {
  // TODO(muse): call muse-spark-1.3 with a JSON schema when MODEL_API_KEY has billing; fall back to parseCallLocal on error.
  return parseCallLocal(transcript);
}
