import { handleVideoGet } from "@/sse/handlers/videoGeneration.js";
import { withLlmWorkspace } from "@/lib/workspaces/requestContext.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** GET /v1/videos/{request_id} - poll async video job status (xAI Grok Imagine) */
export async function GET(request, ctx) {
  return withLlmWorkspace(request, () => handleGet(request, ctx));
}

async function handleGet(request, ctx) {
  const { id } = await ctx.params;
  return await handleVideoGet(request, id);
}
