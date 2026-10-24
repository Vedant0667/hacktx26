// Rate limits for lobby creation and lobby reads (DB-backed, table rate_limits). Numbers are per IP unless noted.
import { guardedLobbyRead, hitRateLimit, type LobbyReadGuard } from "@/lib/db";
import { clientIp, HttpError } from "./http";

// A race room of 13 phones behind one NAT makes about 1,430 reads a minute (lobby poll every second plus
// frames about once a lap), before freeze and reveal fetches; this leaves headroom for those.
export const LOBBY_READ_LIMIT = 2400;
export const LOBBY_READ_WINDOW_S = 60;
// Codes that do not exist: legit players mistype a few; guessing 1 of 279,841 codes needs thousands.
export const LOBBY_MISS_LIMIT = 20;
export const LOBBY_MISS_WINDOW_S = 600;

export const LOBBY_CREATE_PER_IP = 10;
export const LOBBY_CREATE_GLOBAL = 30;
const HOUR_S = 3600;

const tooMany = (retryAfterS: number) => new HttpError(429, "Too many requests. Wait a moment and try again.", retryAfterS);

// Counts this request against the read and miss limits and, when asked, returns the lobby state in the same trip.
export async function guardLobbyRead(req: Request, code: string, withState: boolean): Promise<LobbyReadGuard> {
  const g = await guardedLobbyRead(clientIp(req), code, {
    readWindowS: LOBBY_READ_WINDOW_S,
    missWindowS: LOBBY_MISS_WINDOW_S,
    withState,
  });
  if (lobbyReadBlocked(g)) throw tooMany(g.retry_after_s);
  return g;
}

// The miss limit blocks only lookups of codes that do not exist, so a burst of typos on a shared network
// cannot lock that network out of a real lobby (re-audit R3). Existing codes see only the read limit.
export function lobbyReadBlocked(g: Pick<LobbyReadGuard, "found" | "reads" | "misses">): boolean {
  return g.reads > LOBBY_READ_LIMIT || (!g.found && g.misses > LOBBY_MISS_LIMIT);
}

export async function guardLobbyCreate(req: Request): Promise<void> {
  const ip = await hitRateLimit("lobby_create_ip", clientIp(req), HOUR_S);
  if (ip.count > LOBBY_CREATE_PER_IP) throw tooMany(ip.retry_after_s);
  const all = await hitRateLimit("lobby_create_global", "*", HOUR_S);
  if (all.count > LOBBY_CREATE_GLOBAL) throw tooMany(all.retry_after_s);
}
