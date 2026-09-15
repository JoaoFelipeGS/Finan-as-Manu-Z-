import { NextRequest, NextResponse } from "next/server";
import { checkLoginRateLimit, clearLoginRateLimit } from "@/lib/rate-limit";
import { createSession, getAuthConfig, SESSION_COOKIE, sessionCookieOptions, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const rate = checkLoginRateLimit(ip);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  }

  try {
    const body = await request.json();
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const remember = body.remember === true;
    const config = getAuthConfig();
    const user = config.users.find((candidate) => candidate.username === username);
    const valid = user ? password.length > 0 && await verifyPassword(password, user.passwordHash) : false;
    if (!valid) return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });

    clearLoginRateLimit(ip);
    const session = createSession(username, remember);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(session.maxAge));
    return response;
  } catch (error) {
    console.error("Login error", error);
    return NextResponse.json({ error: "Login indisponível. Verifique a configuração do servidor." }, { status: 503 });
  }
}