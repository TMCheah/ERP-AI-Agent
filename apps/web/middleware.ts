import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "./lib/auth";

const PROTECTED = ["/chat", "/approvals", "/settings"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!PROTECTED.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get("erp_session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/chat/:path*", "/approvals/:path*", "/settings/:path*"] };