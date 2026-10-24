// Round 5: "defend your call" duel. Muse Spark picks the two most opposed calls in the room and summarises each
// reason in the player's words; fallbackDuel is the deterministic pick used whenever Muse is off, over budget or fails.
import { z } from "zod";
import type { Call, DecisionPoint } from "../types";
import { museJson } from "./client";
import { COPY_RULES_PROMPT, DUEL_TASK } from "./prompt";

export interface DuelEntry {
  name: string;
  driver_code: string | null;
  call: Call | null;
  reasons: string[];
  transcript: string;
}

export interface DuelSide {
  name: string;
  driver_code: string | null;
  call: Call | null;
  summary: string;
}

export interface DuelResult {
  source: "muse" | "fallback";
  pair: [DuelSide, DuelSide] | null;
  prompt: string | null;
}

export const SUMMARY_WORDS = 14;
const SUMMARY_CHARS = 110;
const GIST_WORDS = 6;
const SAID_CHARS = 240;
export const NO_REASON = "No reason given";

// Projector-safe line: letters, digits, spaces and basic punctuation, at most `maxWords` words and `maxChars` characters.
// Drops exclamation marks, question marks, emoji, dashes and markup (copy rules, section 3).
export function cleanLine(raw: string, maxWords: number, maxChars = SUMMARY_CHARS): string {
  const plain = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} .,'’:%/+]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  let out = plain.split(" ").filter(Boolean).slice(0, maxWords).join(" ");
  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars);
    out = cut.lastIndexOf(" ") > maxChars / 2 ? cut.slice(0, cut.lastIndexOf(" ")) : cut;
  }
  return out.replace(/[\s.,:;/+]+$/, "").trim();
}

const STOP = new Set(
  "the a an and or but to of in on at for is are was were be been it its it's that this they them we our you your he she his her i my me so just with as by from than then".split(" "),
);
const words = (s: string) => s.toLowerCase().replace(/tire/g, "tyre").match(/[\p{L}\p{N}]+/gu) ?? [];

// No invented facts: every number in the summary is in what the player said, and at least 60% of its content
// words share a 4-letter stem with a word they said (speech-error fixes like "tires" -> "tyres" still pass).
export function groundedIn(summary: string, said: string): boolean {
  const saidWords = words(said);
  const saidNums = new Set(saidWords.filter((w) => /^\d+$/.test(w)));
  const stems = new Set(saidWords.map((w) => w.slice(0, 4)));
  const sw = words(summary);
  if (sw.some((w) => /\d/.test(w) && !saidNums.has(w))) return false;
  const content = sw.filter((w) => !STOP.has(w));
  if (content.length === 0) return false;
  return content.filter((w) => stems.has(w.slice(0, 4))).length / content.length >= 0.6;
}

const saidBy = (e: DuelEntry) => (e.reasons.length ? e.reasons.join("; ") : e.transcript).slice(0, SAID_CHARS);

// The player's first reason, else the start of what they said, at most 14 words.
export function summaryLocal(e: DuelEntry): string {
  const first = e.reasons.map((r) => cleanLine(r, SUMMARY_WORDS)).find(Boolean);
  return first || cleanLine(e.transcript, SUMMARY_WORDS) || NO_REASON;
}

const side = (e: DuelEntry, summary: string): DuelSide => ({ name: e.name, driver_code: e.driver_code, call: e.call, summary });

const callWords = (c: Call | null) => (c === "BOX" ? "calls BOX" : c === "STAY" ? "calls STAY OUT" : "made no call");

export function fallbackPrompt(a: DuelEntry, b: DuelEntry): string {
  if (a.call && a.call === b.call) {
    return `${a.name} and ${b.name} both call ${a.call === "BOX" ? "BOX" : "STAY OUT"}, for different reasons. 10 seconds each.`;
  }
  return `${a.name} ${callWords(a.call)}. ${b.name} ${callWords(b.call)}. 10 seconds each.`;
}

// Deterministic pick (entries in submission order): the first BOX against the first STAY; if the room made
// one call, the first two calls. Summary: the first reason, clipped. Null pair with fewer than 2 calls.
export function fallbackDuel(entries: DuelEntry[]): DuelResult {
  const box = entries.find((e) => e.call === "BOX");
  const stay = entries.find((e) => e.call === "STAY");
  const [a, b] = box && stay ? [box, stay] : entries;
  if (!a || !b) return { source: "fallback", pair: null, prompt: null };
  return { source: "fallback", pair: [side(a, summaryLocal(a)), side(b, summaryLocal(b))], prompt: fallbackPrompt(a, b) };
}

// One Muse call picking the pair. When the room has both calls, the schema forces one BOX player ("a") and one
// STAY player ("b"). Player names never reach the model; the server builds the room prompt from names and gists.
// Null when Muse is unavailable, over budget or fails, or picks the same player twice.
export async function museDuel(decision: DecisionPoint, lobbyCode: string, entries: DuelEntry[]): Promise<DuelResult | null> {
  if (entries.length < 2) return null;
  const ids = entries.map((_, i) => `p${i + 1}`);
  const idsFor = (c: Call) => ids.filter((_, i) => entries[i].call === c);
  const split = idsFor("BOX").length > 0 && idsFor("STAY").length > 0;
  const aIds = split ? idsFor("BOX") : ids;
  const bIds = split ? idsFor("STAY") : ids;
  const out = await museJson({
    purpose: "duel",
    lobbyCode,
    decisionId: decision.id,
    instructions: `${COPY_RULES_PROMPT}\n\n${DUEL_TASK}${split ? '\n"a" must be a BOX player and "b" a STAY player.' : "\nEveryone made the same call: pick the two most different reasons."}`,
    input: JSON.stringify({
      situation: decision.blind_title ?? `Lap ${decision.lap}, ${decision.trigger}.`,
      players: entries.map((e, i) => ({ id: ids[i], call: e.call ?? "UNCLEAR", said: saidBy(e) })),
    }),
    schemaName: "duel",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["a", "b", "summary_a", "summary_b", "gist_a", "gist_b"],
      properties: {
        a: { type: "string", enum: aIds },
        b: { type: "string", enum: bIds },
        summary_a: { type: "string" },
        summary_b: { type: "string" },
        gist_a: { type: "string" },
        gist_b: { type: "string" },
      },
    },
    validator: z.object({
      a: z.enum(aIds as [string, ...string[]]),
      b: z.enum(bIds as [string, ...string[]]),
      summary_a: z.string(),
      summary_b: z.string(),
      gist_a: z.string(),
      gist_b: z.string(),
    }),
    // Minimal effort still reasons for several hundred tokens (same budget as camps).
    maxOutputTokens: 1200,
    // Live test: 5.9 s for ~970 output tokens, at the 6 s default. The pick runs once per lobby while other
    // pollers get pending, so a longer wait is fine.
    timeoutMs: 12000,
  });
  if (!out || out.a === out.b) return null;
  const a = entries[ids.indexOf(out.a)];
  const b = entries[ids.indexOf(out.b)];
  if (!a || !b) return null;

  // Each model line is kept only if it is grounded in that player's words; otherwise the local summary stands.
  const summary = (e: DuelEntry, raw: string) => {
    const s = cleanLine(raw, SUMMARY_WORDS);
    if (s === NO_REASON) return e.reasons.length || e.transcript.trim() ? summaryLocal(e) : NO_REASON;
    return s && groundedIn(s, saidBy(e)) ? s : summaryLocal(e);
  };
  const gist = (e: DuelEntry, raw: string) => {
    const g = cleanLine(raw, GIST_WORDS, 48);
    return g && g !== NO_REASON && groundedIn(g, saidBy(e)) ? g : null;
  };
  const ga = gist(a, out.gist_a);
  const gb = gist(b, out.gist_b);
  return {
    source: "muse",
    pair: [side(a, summary(a, out.summary_a)), side(b, summary(b, out.summary_b))],
    prompt: ga && gb ? `${a.name} says ${ga}. ${b.name} says ${gb}. 10 seconds each.` : fallbackPrompt(a, b),
  };
}
