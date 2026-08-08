import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/api/map/canonical-route-strong";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/api/map/canonical-route"],
};
