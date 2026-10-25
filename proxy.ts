import { NextResponse, type NextRequest } from "next/server";
import { CRON_PURGE_PATH, cronAuthorized, GATE_COOKIE, gateMisconfigured, gateOpen, gatePassword, verifyGateToken } from "@/lib/gate";

// Exact paths that skip the gate: the unlock page and its form handler, and the public logo and icon files. Checked here as
// whole paths rather than matcher prefixes, so a future /unlock-foo or /iconic.json stays gated.
export const GATE_OPEN_PATHS: ReadonlySet<string> = new Set(["/unlock", "/api/unlock", "/favicon.ico", "/icon.png", "/apple-icon.png", "/brand/wordmark.png", "/brand/mark.png"]);

// Everything sits behind the shared password, including /api and /data.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  if (gateOpen()) return NextResponse.next(); // public: every route does its own auth and rate limiting

  // On Vercel without SITE_PASSWORD: refuse rather than open up (H1). The unlock route refuses too.
  if (gateMisconfigured()) {
    return isApi
      ? NextResponse.json({ error: "Gate misconfigured: SITE_PASSWORD is not set" }, { status: 503 })
      : new NextResponse("Gate misconfigured: SITE_PASSWORD is not set.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
  }

  const password = gatePassword();
  if (!password) return NextResponse.next(); // local dev only
  if (GATE_OPEN_PATHS.has(pathname)) return NextResponse.next();
  // The daily purge cron carries no gate cookie: let exactly that path through, and only with the cron bearer.
  if (pathname === CRON_PURGE_PATH && cronAuthorized(request.headers.get("authorization"))) return NextResponse.next();

  const cookie = request.cookies.get(GATE_COOKIE)?.value ?? "";
  if (cookie && verifyGateToken(cookie, password)) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ error: "Locked. Enter the test password at /unlock." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

// Skip only Next's build assets and the image optimizer; every other exclusion is an exact path above.
export const config = {
  matcher: ["/((?!_next/static/|_next/image$).*)"],
};
