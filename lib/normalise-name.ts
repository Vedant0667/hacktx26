// The stored form of a nickname: NFKC, trimmed, inner whitespace collapsed to one space. Its own module so the
// phone can apply it before joining without loading lib/names.ts (which builds the profanity matcher).
export function normaliseName(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
