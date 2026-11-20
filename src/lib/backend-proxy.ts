import { getSessionAccessToken, SESSION_COOKIE } from "@/lib/session";

const FORWARDED_HEADERS = ["content-type", "idempotency-key"] as const;

export async function forwardToBackend(request: Request, path: string[]) {
  const cookie = request.headers.get("cookie") ?? "";
  const session = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  const accessToken = await getSessionAccessToken(session);
  if (!accessToken) {
    return Response.json({ detail: "Authentication required." }, { status: 401 });
  }

  const backendUrl = process.env.EVENTCONNECT_API_URL;
  const apiToken = process.env.EVENTCONNECT_API_TOKEN;
  if (!backendUrl || !apiToken || apiToken.length < 32) {
    return Response.json({ detail: "Backend integration is not configured." }, { status: 503 });
  }

  const target = new URL(path.map(encodeURIComponent).join("/"), `${backendUrl.replace(/\/+$/, "")}/`);
  target.search = new URL(request.url).search;
  const headers = new Headers({
    "X-EventConnect-Proxy-Token": apiToken,
    "X-Supabase-Access-Token": accessToken,
  });
  for (const header of FORWARDED_HEADERS) {
    const value = request.headers.get(header);
    if (value) headers.set(header, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}
