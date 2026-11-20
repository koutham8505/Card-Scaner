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

export function isAuthenticationConfigured(): boolean {
  return Boolean(
    sessionSecret() &&
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_ANON_KEY,
  );
}

export async function createSessionToken(accessToken: string, expiresIn: number): Promise<string | null> {
  const secret = sessionSecret();
  if (!secret || expiresIn <= 0) return null;

  const payload = encodeBase64Url(
    encoder.encode(JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + Math.min(expiresIn, SESSION_TTL_SECONDS),
      accessToken,
    })),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
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
  return (await getSessionAccessToken(token)) !== null;
}

export async function getSessionAccessToken(token: string | undefined): Promise<string | null> {
  const secret = sessionSecret();
  if (!secret || !token || token.length > 8192) return null;

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const actual = decodeBase64Url(signature);
  const payloadBytes = decodeBase64Url(payload);
  if (!actual || actual.length !== 32 || !payloadBytes) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (!(await crypto.subtle.verify("HMAC", key, new Uint8Array(actual), encoder.encode(payload)))) return null;
  return (
    typeof claims === "object" &&
    claims !== null &&
    "exp" in claims &&
    typeof claims.exp === "number" &&
    claims.exp > Math.floor(Date.now() / 1000) &&
    "accessToken" in claims &&
    typeof claims.accessToken === "string"
  )
    ? claims.accessToken
    : null;
}

export function sessionTtlSeconds(): number {
  return SESSION_TTL_SECONDS;
}
