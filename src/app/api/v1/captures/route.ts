import { forwardToBackend } from "@/lib/backend-proxy";

export async function POST(request: Request) {
  return forwardToBackend(request, ["api", "v1", "captures"]);
}
