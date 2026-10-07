import { NextResponse } from "next/server";
import { pingModelByKind } from "./ping";
import { withDashboardWorkspace } from "@/lib/workspaces/requestContext.js";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

// Run a dashboard-owned probe in process so it keeps its authenticated workspace.
// This is never exposed through a request header or the public /v1 API.
async function executeDashboardProbe(url, init) {
  const probeRequest = new Request(url, init);
  const path = new URL(url).pathname;
  if (path.endsWith("/chat/completions")) {
    const [{ initTranslators }, { handleChat }] = await Promise.all([
      import("open-sse/translator/index.js"),
      import("@/sse/handlers/chat.js"),
    ]);
    initTranslators();
    return handleChat(probeRequest, null, { trustedDashboardProbe: true });
  }
  if (path.endsWith("/embeddings")) {
    const { handleEmbeddings } = await import("@/sse/handlers/embeddings.js");
    return handleEmbeddings(probeRequest, { trustedDashboardProbe: true });
  }
  if (path.endsWith("/images/generations")) {
    const { handleImageGeneration } = await import("@/sse/handlers/imageGeneration.js");
    return handleImageGeneration(probeRequest, { trustedDashboardProbe: true });
  }
  if (path.endsWith("/audio/transcriptions")) {
    const { handleStt } = await import("@/sse/handlers/stt.js");
    return handleStt(probeRequest, { trustedDashboardProbe: true });
  }
  throw new Error("Unsupported model probe endpoint");
}

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.OWNER, () => handlePost(request));
}

async function handlePost(request) {
  try {
    const { model, kind } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });
    const result = await pingModelByKind(model, kind || "llm", undefined, {
      headers: { "Content-Type": "application/json" },
      execute: executeDashboardProbe,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
