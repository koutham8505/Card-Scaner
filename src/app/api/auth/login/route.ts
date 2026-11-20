import { NextResponse } from "next/server";
import {
  createSessionToken,
  isAuthenticationConfigured,
  SESSION_COOKIE,
  sessionTtlSeconds,
} from "@/lib/session";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid request body." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("email" in body) ||
    typeof body.email !== "string" ||
    !("password" in body) ||
    typeof body.password !== "string"
  ) {
    return NextResponse.json({ detail: "Email and password are required." }, { status: 400 });
  }

  if (!isAuthenticationConfigured()) {
    return NextResponse.json(
      { detail: "Authentication is not configured on this server." },
      { status: 503 },
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL!.replace(/\/+$/, "");
  let authResponse: Response;
  try {
    authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: body.email.trim(), password: body.password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json({ detail: "Authentication provider is unavailable." }, { status: 503 });
  }
  if (!authResponse.ok) {
    if (authResponse.status === 400 || authResponse.status === 401) {
      return NextResponse.json({ detail: "Email or password is incorrect." }, { status: 401 });
    }
    return NextResponse.json({ detail: "Authentication provider rejected the login request." }, { status: 503 });
  }

  const authData: unknown = await authResponse.json();
  if (
    typeof authData !== "object" ||
    authData === null ||
    !("access_token" in authData) ||
    typeof authData.access_token !== "string" ||
    !("expires_in" in authData) ||
    typeof authData.expires_in !== "number"
  ) {
    return NextResponse.json({ detail: "Authentication provider returned an invalid session." }, { status: 502 });
  }
  const token = await createSessionToken(authData.access_token, authData.expires_in);
  if (!token) return NextResponse.json({ detail: "Could not create a secure session." }, { status: 503 });

  const backendUrl = process.env.EVENTCONNECT_API_URL;
  const proxyToken = process.env.EVENTCONNECT_API_TOKEN;
  if (!backendUrl || !proxyToken || proxyToken.length < 32) {
    return NextResponse.json({ detail: "Backend authentication is not configured." }, { status: 503 });
  }
  let profileResponse: Response;
  try {
    profileResponse = await fetch(
      `${backendUrl.replace(/\/+$/, "")}/api/v1/auth/session`,
      {
        method: "POST",
        headers: {
          "X-EventConnect-Proxy-Token": proxyToken,
          "X-Supabase-Access-Token": authData.access_token,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return NextResponse.json({ detail: "Application backend is unavailable." }, { status: 503 });
  }
  if (!profileResponse.ok) {
    if (profileResponse.status === 401 || profileResponse.status === 403) {
      return NextResponse.json(
        { detail: "This account is not authorized as active event staff." },
        { status: 403 },
      );
    }
    return NextResponse.json({ detail: "Could not verify the staff profile." }, { status: 503 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.min(authData.expires_in, sessionTtlSeconds()),
  });
  return response;
}
