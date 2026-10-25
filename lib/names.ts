// Nickname rules and the public leaderboard row shape. Pure (no DB, no network) so scripts/test-names.ts can
// run it. The profanity check uses the obscenity package's English dataset; no word list lives in this repo.
import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";
import { normaliseName } from "./normalise-name";

export const NAME_MAX = 24;
const MAX_MARKS_IN_A_ROW = 2;

// Names a player cannot take, after normalisation and ignoring case, spaces and punctuation.
const RESERVED = ["engine", "host", "admin", "outpace", "muse", "race control"];

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

// Letters and digits only, lower case: "Race  Control", "race-control" and "RACECONTROL" all match.
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// "f u c k" and "f.u.c.k": the matcher reads word boundaries, so also test each run of single characters
// joined up. Only runs of 3 or more, so ordinary names with an initial ("Max V") are not squashed.
function spelledOut(name: string): string[] {
  const runs: string[] = [];
  let run = "";
  for (const t of [...name.split(/[^\p{L}\p{N}]+/u), ""]) {
    if ([...t].length === 1) {
      run += t;
      continue;
    }
    if (run.length >= 3) runs.push(run);
    run = "";
  }
  return runs;
}

// NFKC, trimmed, inner whitespace collapsed to one space (lib/normalise-name.ts). The form that is stored and compared.
export { normaliseName };

export type NameCheck = { ok: true; name: string } | { ok: false; reason: "empty" | "length" | "control" | "marks" | "profanity" | "reserved" };

// teamNames: the bare team names the app shows as benchmark rows (e.g. "McLaren"). A name that only contains
// one is fine; an exact match is not.
export function checkName(raw: string, teamNames: Iterable<string> = []): NameCheck {
  const name = normaliseName(raw);
  if (!name) return { ok: false, reason: "empty" };
  if ([...name].length > NAME_MAX) return { ok: false, reason: "length" };
  if (/[\p{Cc}\p{Cf}]/u.test(name)) return { ok: false, reason: "control" };
  if (new RegExp(`\\p{M}{${MAX_MARKS_IN_A_ROW + 1},}`, "u").test(name)) return { ok: false, reason: "marks" };
  const key = fold(name);
  if (!key) return { ok: false, reason: "empty" };
  const reserved = new Set([...RESERVED, ...teamNames].map(fold));
  if (reserved.has(key)) return { ok: false, reason: "reserved" };
  if (matcher.hasMatch(name) || spelledOut(name).some((w) => matcher.hasMatch(w))) return { ok: false, reason: "profanity" };
  return { ok: true, name };
}

// ---- Moment leaderboard rows ----

export interface MomentPlayerRow<C> {
  call: C | null;
  reasons: string[];
  factors_named: string[];
  verdict?: string | null;
  score_call: number | null;
  score_reasoning: number | null;
}

// Rows from other lobbies are public: name, car and total only. Rows from the viewer's own revealed lobby keep
// everything. `own` is true for a row of that lobby; `revealed` is whether the viewer's lobby has revealed.
export function shapeMomentDetail<C>(own: boolean, revealed: boolean, s: MomentPlayerRow<C>): Required<MomentPlayerRow<C>> {
  if (own && revealed) {
    return { call: s.call, reasons: s.reasons, factors_named: s.factors_named, verdict: s.verdict ?? null, score_call: s.score_call, score_reasoning: s.score_reasoning };
  }
  return { call: null, reasons: [], factors_named: [], verdict: null, score_call: null, score_reasoning: null };
}
