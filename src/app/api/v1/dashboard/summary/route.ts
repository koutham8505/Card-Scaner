import { forwardToBackend } from "@/lib/backend-proxy";

export async function GET(request: Request) {
  return forwardToBackend(request, ["api", "v1", "dashboard", "summary"]);
}
