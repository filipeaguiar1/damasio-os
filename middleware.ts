import { NextRequest, NextResponse } from "next/server";

const NATIVE_APP_USER_AGENT = /4EverSeasons(?:Android|iOS)\//i;
const MOBILE_BROWSER_USER_AGENT = /Android|iPhone|iPad|iPod|Mobile/i;
const PORTAL_PATH = /^\/(?:mobile|admin|company|employee|customer|master|login)(?:\/|$)/;

type MobilePlatform = "android" | "ios";

type GateMode = "off" | "all";

function isMobileBrowser(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") || "";
  const clientHint = request.headers.get("sec-ch-ua-mobile");
  const nativeApp = NATIVE_APP_USER_AGENT.test(userAgent);
  const mobileDevice = clientHint === "?1" || MOBILE_BROWSER_USER_AGENT.test(userAgent);
  return mobileDevice && !nativeApp;
}

function mobilePlatform(request: NextRequest): MobilePlatform {
  const userAgent = request.headers.get("user-agent") || "";
  return /iPhone|iPad|iPod/i.test(userAgent) ? "ios" : "android";
}

function gateMode(): GateMode {
  // App-only is now the permanent mobile-browser policy. The only emergency
  // escape hatch is an explicit "off". Legacy values such as "android" are
  // intentionally treated as "all" so an old Vercel env cannot reopen iOS.
  return (process.env.MOBILE_WEB_GATE_MODE || "all").toLowerCase() === "off" ? "off" : "all";
}

function markPrivate(response: NextResponse) {
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Preserve the canonical map compatibility rewrite exactly as before.
  if (pathname === "/api/map/canonical-route") {
    const url = request.nextUrl.clone();
    url.pathname = "/api/map/canonical-route-strong";
    return NextResponse.rewrite(url);
  }

  // Browser access on mobile is app-only. Native wrappers append a dedicated
  // UA token and remain allowed to use the same canonical WebView surfaces.
  if (PORTAL_PATH.test(pathname) && isMobileBrowser(request) && gateMode() === "all") {
    const platform = mobilePlatform(request);
    const url = request.nextUrl.clone();
    url.pathname = "/get-the-app";
    url.search = "";
    url.searchParams.set("platform", platform);
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Vary", "User-Agent, Sec-CH-UA-Mobile");
    return markPrivate(response);
  }

  if (PORTAL_PATH.test(pathname)) {
    return markPrivate(NextResponse.next());
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/map/canonical-route",
    "/mobile/:path*",
    "/admin/:path*",
    "/company/:path*",
    "/employee/:path*",
    "/customer/:path*",
    "/master/:path*",
    "/login/:path*",
  ],
};
