import { NextResponse } from "next/server";
import {
  createSessionToken,
  isAccessGateConfigured,
  SESSION_COOKIE,
  sessionTtlSeconds,
  verifyAccessPassword,
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
    !("password" in body) ||
    typeof body.password !== "string"
  ) {
    return NextResponse.json({ detail: "Access password is required." }, { status: 400 });
  }

  if (!isAccessGateConfigured()) {
    return NextResponse.json(
      { detail: "The access gate is not configured on this server." },
      { status: 503 },
    );
  }

  if (!verifyAccessPassword(body.password)) {
    return NextResponse.json({ detail: "The access password is incorrect." }, { status: 401 });
  }

  const token = await createSessionToken();
  if (!token) return NextResponse.json({ detail: "Could not create a secure session." }, { status: 503 });

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: sessionTtlSeconds(),
  });
  return response;
}
