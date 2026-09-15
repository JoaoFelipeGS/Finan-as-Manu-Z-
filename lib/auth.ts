import { createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
export { SESSION_COOKIE } from "./session";
const SESSION_TTL = 8 * 60 * 60;
const REMEMBERED_SESSION_TTL = 30 * 24 * 60 * 60;

export function getAuthConfig() {
  const username = process.env.AUTH_USERNAME;
  const passwordHash = process.env.AUTH_PASSWORD_HASH;
  const secret = process.env.AUTH_SECRET;
  if (!username || !passwordHash || !secret || secret.length < 32) {
    throw new Error("Autenticação não configurada: AUTH_USERNAME, AUTH_PASSWORD_HASH e AUTH_SECRET são obrigatórios.");
  }
  return { username, passwordHash, secret };
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
    const { secret, username } = getAuthConfig();
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return false;
    const expected = sign(payload, secret);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.username === username && Number.isInteger(data.exp) && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function sessionCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}