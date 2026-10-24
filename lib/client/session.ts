// The security-relevant client flows in one place, so screens call these instead of api.* directly:
// they store and send the host and player tokens (docs/audits/security-contract.md sections 2 and 3)
// and turn API errors into lib/copy.ts strings.
import { COPY } from "@/lib/copy";
import type { Call } from "@/lib/types";
import { ApiError, api, type JoinResponse, type LobbyStateResponse, type SubmitResponse } from "./api";
import {
  recallHostToken,
  recallPlayerToken,
  rememberHost,
  rememberHostToken,
  rememberName,
  rememberPlayerToken,
  rememberResult,
} from "./identity";

// POST /api/lobby, then keep the host token (shown once) so this browser can advance phases after a reload.
export async function createLobby(decisionId: string, hostName: string): Promise<LobbyStateResponse> {
  const lobby = await api.createLobby(decisionId, hostName);
  rememberName(lobby.code, hostName);
  rememberHost(lobby.code);
  rememberHostToken(lobby.code, lobby.host_token);
  return lobby;
}

// POST /api/lobby/[code]/phase with x-host-token. 403 when this browser did not create the lobby.
export const advancePhase = (code: string, phase: string) => api.phase(code, phase, recallHostToken(code));

// POST /api/lobby/[code]/kick with x-host-token: removes `name` from the lobby.
export const kickPlayer = (code: string, name: string) => api.kick(code, name, recallHostToken(code));

// True when this browser holds the host token for `code`.
export const isHost = (code: string) => !!recallHostToken(code);

// POST /api/lobby/[code]/join with consent. Sends the stored token for `name` when there is one (a rejoin);
// stores a new token when the server issues one. `consent` must be the ticked checkbox.
export async function joinLobby(code: string, name: string, consent: boolean): Promise<JoinResponse> {
  if (!consent) throw new ApiError(400, COPY.play.consentMissing);
  const res = await api.join(code, name, true, recallPlayerToken(code, name));
  if (res.player_token) rememberPlayerToken(code, name, res.player_token);
  rememberName(code, name);
  return res;
}

// Offer "Rejoin as <name>" only when this returns true.
export const canRejoin = (code: string, name: string) => !!recallPlayerToken(code, name);

// POST /api/lobby/[code]/submit with x-player-token, then remember the result for reloads.
export async function submitCall(
  code: string,
  decisionId: string,
  body: { player_name: string; transcript: string; seconds_to_call: number; call: Call | null },
): Promise<SubmitResponse> {
  const r = await api.submit(code, body, recallPlayerToken(code, body.player_name));
  rememberResult(code, decisionId, r);
  return r;
}

export const isLobbyFull = (e: unknown) => e instanceof ApiError && e.status === 409 && /full/i.test(e.message);

// One message per failure, for the join form.
export function joinErrorText(e: unknown, code: string, name: string): string {
  if (!(e instanceof ApiError)) return COPY.error.connectionLost;
  if (e.status === 409) return isLobbyFull(e) ? COPY.error.lobbyFull : COPY.error.nameTaken(name);
  if (e.status === 404) return COPY.home.codeNotFound(code);
  if (e.status === 403) return COPY.error.removed;
  if (e.status === 429) return COPY.error.rateLimited(e.retryAfter);
  if (e.status === 400) return COPY.play.consentMissing;
  return COPY.error.connectionLost;
}

export function createErrorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 0) return COPY.error.connectionLost;
  if (e instanceof ApiError && e.status === 429) return COPY.home.createLimited(e.retryAfter);
  return COPY.home.createFailed;
}

export function submitErrorText(e: unknown, name: string): string {
  if (e instanceof ApiError && e.status === 403) return COPY.error.notYou(name);
  if (e instanceof ApiError && e.status === 429) return COPY.error.rateLimited(e.retryAfter);
  return COPY.error.connectionLost;
}
