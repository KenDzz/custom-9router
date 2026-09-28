import { handleEmbeddings } from "@/sse/handlers/embeddings.js";
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
 * POST /v1/embeddings - OpenAI-compatible embeddings endpoint
 */
export async function POST(request) {
  return withLlmWorkspace(request, () => handlePost(request));
}

async function handlePost(request) {
  return await handleEmbeddings(request);
}
