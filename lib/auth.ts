import { createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
export { SESSION_COOKIE } from "./session";
const SESSION_TTL = 8 * 60 * 60;
const REMEMBERED_SESSION_TTL = 30 * 24 * 60 * 60;

export type AuthUser = { username: string; passwordHash: string };

export function getAuthConfig() {
  const secret = process.env.AUTH_SECRET;
  let users: AuthUser[] = [];
  if (process.env.AUTH_USERS) {
    try {
      const parsed = JSON.parse(process.env.AUTH_USERS) as unknown;
      if (Array.isArray(parsed)) {
        users = parsed.filter((user): user is AuthUser => Boolean(user && typeof user === "object" && typeof (user as AuthUser).username === "string" && typeof (user as AuthUser).passwordHash === "string"));
      }
    } catch {
      throw new Error("AUTH_USERS precisa ser um JSON válido.");
    }
  }
  if (users.length === 0 && process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD_HASH) {
    users = [{ username: process.env.AUTH_USERNAME, passwordHash: process.env.AUTH_PASSWORD_HASH }];
  }
  if (users.length === 0 || !secret || secret.length < 32) {
    throw new Error("Autenticação não configurada: AUTH_USERS e AUTH_SECRET são obrigatórios.");
  }
  return { users, secret };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex || !/^[a-f0-9]+$/i.test(expectedHex)) return false;
  const actual = await scrypt(password, salt, expectedHex.length / 2) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSession(username: string, remember: boolean): { value: string; maxAge: number } {
  const { secret } = getAuthConfig();
  const maxAge = remember ? REMEMBERED_SESSION_TTL : SESSION_TTL;
  const payload = Buffer.from(JSON.stringify({ username, exp: Math.floor(Date.now() / 1000) + maxAge, nonce: randomBytes(12).toString("hex") })).toString("base64url");
  return { value: `${payload}.${sign(payload, secret)}`, maxAge };
}

export function verifySession(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const { secret, users } = getAuthConfig();
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return false;
    const expected = sign(payload, secret);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return users.some((user) => data.username === user.username) && Number.isInteger(data.exp) && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function sessionCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}