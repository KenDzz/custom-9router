import { handleFetch } from "@/sse/handlers/fetch.js";
import { withLlmWorkspace } from "@/lib/workspaces/requestContext.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/web/fetch - Web URL fetch/extract endpoint
 */
export async function POST(request) {
  return withLlmWorkspace(request, () => handlePost(request));
}

async function handlePost(request) {
  return await handleFetch(request);
}
