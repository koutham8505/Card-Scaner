const FORWARDED_HEADERS = ["content-type", "idempotency-key"] as const;

export async function forwardToBackend(request: Request, path: string[]) {
  const backendUrl = process.env.EVENTCONNECT_API_URL;
  const apiToken = process.env.EVENTCONNECT_API_TOKEN;
  if (!backendUrl || !apiToken || apiToken.length < 32) {
    return Response.json({ detail: "Backend integration is not configured." }, { status: 503 });
  }

  const target = new URL(path.map(encodeURIComponent).join("/"), `${backendUrl.replace(/\/+$/, "")}/`);
  target.search = new URL(request.url).search;
  const headers = new Headers({
    "X-EventConnect-Proxy-Token": apiToken,
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
