export const SESSION_COOKIE = "nosso_dinheiro_session";

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function verifySessionEdge(value: string | undefined): Promise<boolean> {
  if (!value || !process.env.AUTH_SECRET) return false;
  try {
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(process.env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signatureBytes = decodeBase64Url(signature);
    const valid = await crypto.subtle.verify("HMAC", key, signatureBytes.buffer as ArrayBuffer, new TextEncoder().encode(payload));
    if (!valid) return false;
    const data = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    const users = process.env.AUTH_USERS ? JSON.parse(process.env.AUTH_USERS) : [{ username: process.env.AUTH_USERNAME }];
    return Array.isArray(users) && users.some((user) => user?.username === data.username) && Number.isInteger(data.exp) && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function encodeSessionPart(value: ArrayBuffer): string {
  return encodeBase64Url(value);
}