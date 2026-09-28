import { handleTts } from "@/sse/handlers/tts.js";
import { withLlmWorkspace } from "@/lib/workspaces/requestContext.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/audio/speech - OpenAI-compatible TTS endpoint */
export async function POST(request) {
  return withLlmWorkspace(request, () => handlePost(request));
}

async function handlePost(request) {
  return await handleTts(request);
}
