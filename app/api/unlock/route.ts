import { NextResponse } from "next/server";
import { hitRateLimit, undoRateLimit } from "@/lib/db";
import { GATE_COOKIE, GATE_MAX_AGE_S, gateMisconfigured, gatePassword, gateToken, safeEqual, safeNext } from "@/lib/gate";
import { clientIp } from "../_lib/http";

// 10 attempts per 10 minutes per IP. Each attempt reserves a slot first (so parallel guesses cannot
// overshoot) and a correct password gives its slot back, so a room of testers on one NAT is not locked out.
const UNLOCK_LIMIT = 10;
const UNLOCK_WINDOW_S = 600;

const back = (base: URL, error: string, next: string) =>
  NextResponse.redirect(new URL(`/unlock?error=${error}&next=${encodeURIComponent(next)}`, base), 303);

// Form POST from /unlock. A wrong password also waits 600 ms.
export async function POST(request: Request) {
  if (gateMisconfigured()) {
    return NextResponse.json({ error: "Gate misconfigured: SITE_PASSWORD is not set" }, { status: 503 });
  }
  const form = await request.formData();
  const given = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));
  const password = gatePassword();
  const base = new URL(request.url);

  if (!password) return NextResponse.redirect(new URL(next, base), 303); // local dev only

  const ip = clientIp(request);
  let attempts: number;
  try {
    attempts = (await hitRateLimit("unlock", ip, UNLOCK_WINDOW_S)).count;
  } catch (err) {
    console.error("unlock: rate limit check failed", err);
    return back(base, "2", next); // fail closed
  }
  if (attempts > UNLOCK_LIMIT) return back(base, "2", next);

  if (!safeEqual(given, password)) {
    await new Promise((r) => setTimeout(r, 600));
    return back(base, "1", next);
  }
  await undoRateLimit("unlock", ip, UNLOCK_WINDOW_S).catch((err) => console.error("unlock: undo failed", err));
  const res = NextResponse.redirect(new URL(next, base), 303);
  res.cookies.set(GATE_COOKIE, gateToken(password), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: GATE_MAX_AGE_S,
  });
  return res;
}
