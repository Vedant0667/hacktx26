// Who is calling a lobby route: the host (x-host-token) or a player who joined (x-player-token).
// Every lookup goes through guardLobbyRead first, so probing codes is miss-limited (re-audit R4), and an
// unknown code answers exactly like a wrong token (403), so the status code does not reveal which codes exist.
import { getLobbyMeta, type LobbyMeta } from "@/lib/db";
import { hashToken, HttpError, tokenMatches } from "./http";
import { guardLobbyRead } from "./limits";

export type LobbyRole = "host" | "player" | null;

export interface LobbyAccess {
  meta: LobbyMeta;
  role: LobbyRole;
  player: string | null; // the player name the token belongs to
}

export function tokenHeaders(req: Request): { host: string | null; player: string | null } {
  return { host: req.headers.get("x-host-token"), player: req.headers.get("x-player-token") };
}

export function roleFor(meta: LobbyMeta, req: Request): LobbyRole {
  const t = tokenHeaders(req);
  if (tokenMatches(t.host, meta.host_token_hash)) return "host";
  if (meta.token_player) return "player";
  return null;
}

// Rate-limits the lookup and loads the lobby meta. Throws 403 `denied` for an unknown lobby.
export async function lobbyMetaGuarded(req: Request, code: string, playerName?: string, denied = "Not allowed for this lobby"): Promise<LobbyAccess> {
  const g = await guardLobbyRead(req, code, false);
  if (!g.found) throw new HttpError(403, denied);
  const t = tokenHeaders(req);
  const meta = await getLobbyMeta(code, playerName, t.player ? hashToken(t.player) : null);
  if (!meta) throw new HttpError(403, denied);
  return { meta, role: roleFor(meta, req), player: meta.token_player };
}

// Host or any player of this lobby; 403 otherwise (including an unknown code).
export async function requireLobbyMember(req: Request, code: string, denied = "Only players in this lobby and its host can see this"): Promise<LobbyAccess> {
  const a = await lobbyMetaGuarded(req, code, undefined, denied);
  if (!a.role) throw new HttpError(403, denied);
  return a;
}

// Host only; 403 otherwise (including an unknown code).
export async function requireHost(req: Request, code: string, denied = "Only the host screen can do this"): Promise<LobbyAccess> {
  const a = await lobbyMetaGuarded(req, code, undefined, denied);
  if (a.role !== "host") throw new HttpError(403, denied);
  return a;
}

// Host or player of a race lobby (Round 6); 403 like requireLobbyMember, then 409 for a moment lobby.
export async function requireRaceMember(req: Request, code: string): Promise<LobbyAccess> {
  const a = await requireLobbyMember(req, code);
  if (a.meta.mode !== "race" || !a.meta.race_key) throw new HttpError(409, "Not a race lobby");
  return a;
}
