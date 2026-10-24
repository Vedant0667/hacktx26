import { NextResponse } from "next/server";
import { GATE_COOKIE, GATE_MAX_AGE_S, gatePassword, gateToken, safeEqual, safeNext } from "@/lib/gate";

// Form POST from /unlock. A wrong password waits 600 ms to slow guessing.
export async function POST(request: Request) {
  const form = await request.formData();
  const given = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));
  const password = gatePassword();
  const base = new URL(request.url);

  if (!password) return NextResponse.redirect(new URL(next, base), 303);
  if (!safeEqual(given, password)) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.redirect(new URL(`/unlock?error=1&next=${encodeURIComponent(next)}`, base), 303);
  }
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
