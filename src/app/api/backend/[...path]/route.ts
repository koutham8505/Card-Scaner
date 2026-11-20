import { forwardToBackend } from "@/lib/backend-proxy";

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return forwardToBackend(request, path);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
