import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionEdge } from "@/lib/session";

export async function middleware(request: NextRequest) {
  if (await verifySessionEdge(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Autenticação necessária." }, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = { matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|manifest.json|logo\\.jpg|icon-.*\\.png).*)"] };