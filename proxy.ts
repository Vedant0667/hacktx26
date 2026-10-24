import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gatePassword, gateToken, safeEqual } from "@/lib/gate";

// Everything sits behind the shared password, including /api and /data (decision files hold the answers).
export function proxy(request: NextRequest) {
  const password = gatePassword();
  if (!password) return NextResponse.next();

  const cookie = request.cookies.get(GATE_COOKIE)?.value ?? "";
  if (cookie && safeEqual(cookie, gateToken(password))) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Locked. Enter the test password at /unlock." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!unlock|api/unlock|_next/static|_next/image|favicon.ico|icon|apple-icon|robots.txt).*)"],
};
