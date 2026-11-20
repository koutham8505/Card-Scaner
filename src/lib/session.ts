import { createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "ec_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function sessionSecret(): string | null {
  const secret = process.env.EVENTCONNECT_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function accessPassword(): string | null {
  const password = process.env.EVENTCONNECT_ACCESS_PASSWORD;
  return password && password.length >= 16 ? password : null;
}

function sessionSigningKey(): string | null {
  const secret = sessionSecret();
  const password = accessPassword();
  return secret && password ? `${secret}:${password}` : null;
}

export function isAccessGateConfigured(): boolean {
  return Boolean(sessionSecret() && accessPassword());
}

export function verifyAccessPassword(candidate: string): boolean {
  const expected = accessPassword();
  if (!expected || candidate.length > 1024) return false;

  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  const candidateHash = createHash("sha256").update(candidate, "utf8").digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

export async function createSessionToken(): Promise<string | null> {
  const signingKey = sessionSigningKey();
  if (!signingKey) return null;

  const payload = encodeBase64Url(
    encoder.encode(JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    })),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = encodeBase64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))),
  );
  return `${payload}.${signature}`;
}

export async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  const signingKey = sessionSigningKey();
  if (!signingKey || !token || token.length > 8192) return false;

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const actual = decodeBase64Url(signature);
  const payloadBytes = decodeBase64Url(payload);
  if (!actual || actual.length !== 32 || !payloadBytes) return false;

  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (!(await crypto.subtle.verify("HMAC", key, new Uint8Array(actual), encoder.encode(payload)))) return false;
  return (
    typeof claims === "object" &&
    claims !== null &&
    "exp" in claims &&
    typeof claims.exp === "number" &&
    claims.exp > Math.floor(Date.now() / 1000)
  );
}

export function sessionTtlSeconds(): number {
  return SESSION_TTL_SECONDS;
}
