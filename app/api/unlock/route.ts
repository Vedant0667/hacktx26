import { NextResponse } from "next/server";
import { hitRateLimit } from "@/lib/db";
import { GATE_COOKIE, GATE_MAX_AGE_S, gateMisconfigured, gatePassword, gateToken, safeEqual, safeNext } from "@/lib/gate";
import { clientIp } from "../_lib/http";

// 50 failed attempts per 10 minutes per IP (IPv6: per /64). The password is checked first, so the right
// password always works, even from a venue network where someone else used up the failures (re-audit R3);
// only wrong passwords are counted, and past the limit they get the "too many tries" answer.
// The passphrase strength is the real defence; this limit and the 600 ms delay slow down guessing.
const UNLOCK_LIMIT = 50;
const UNLOCK_WINDOW_S = 600;

// Relative Location: the browser resolves it against the URL it actually used (a LAN IP in dev:lan,
// the deployment host on Vercel), and safeNext guarantees a same-origin path ("/x", never "//x").
function redirect(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

const back = (error: string, next: string) => redirect(`/unlock?error=${error}&next=${encodeURIComponent(next)}`);

// Form POST from /unlock. A wrong password also waits 600 ms.
export async function POST(request: Request) {
  if (gateMisconfigured()) {
    return NextResponse.json({ error: "Gate misconfigured: SITE_PASSWORD is not set" }, { status: 503 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back("1", "/");
  }
  const given = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));
  const password = gatePassword();

  if (!password) return redirect(next); // local dev only

  if (safeEqual(given, password)) {
    const res = redirect(next);
    res.cookies.set(GATE_COOKIE, gateToken(password), {
      httpOnly: true,
      // Secure everywhere except plain-http local dev (http://localhost): Safari drops Secure cookies there.
      secure: Boolean(process.env.VERCEL_ENV) || new URL(request.url).protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: GATE_MAX_AGE_S,
    });
    return res;
  }

  let failures: number;
  try {
    failures = (await hitRateLimit("unlock_fail", clientIp(request), UNLOCK_WINDOW_S)).count;
  } catch (err) {
    console.error("unlock: rate limit check failed", err);
    failures = UNLOCK_LIMIT + 1; // fail closed for wrong passwords
  }
  await new Promise((r) => setTimeout(r, 600));
  return back(failures > UNLOCK_LIMIT ? "2" : "1", next);
}
