import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/api/admin/routes-global";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/api/admin/routes"],
};
