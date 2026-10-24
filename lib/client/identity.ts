// Per-device memory of who you are in a lobby (survives reloads). Wrapped: storage can throw.
import type { SubmitResponse } from "./api";

const key = (code: string, k: string) => `lobby:${code.toUpperCase()}:${k}`;

function get(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function set(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

export const rememberName = (code: string, name: string) => set(key(code, "name"), name);
export const recallName = (code: string) => get(key(code, "name"));
export const rememberHost = (code: string) => set(key(code, "host"), "1");

export function rememberResult(code: string, decisionId: string, r: SubmitResponse) {
  set(key(code, `result:${decisionId}`), JSON.stringify(r));
  set(`played:${decisionId}`, JSON.stringify({ name: r.submission.player_name, lobby: code, total: r.submission.total }));
}
export function recallResult(code: string, decisionId: string): SubmitResponse | null {
  const raw = get(key(code, `result:${decisionId}`));
  try {
    return raw ? (JSON.parse(raw) as SubmitResponse) : null;
  } catch {
    return null;
  }
}
export function recallPlayed(decisionId: string): { name: string; lobby: string; total: number } | null {
  const raw = get(`played:${decisionId}`);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Stable snapshots (strings) for useSyncExternalStore; null on the server.
export const noopSubscribe = () => () => {};
export const recallPlayedRaw = (decisionId: string) => get(`played:${decisionId}`);
export function parsePlayed(raw: string | null): { name: string; lobby: string; total: number } | null {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
