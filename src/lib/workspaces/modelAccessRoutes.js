import { requireWorkspaceManager } from "@/lib/auth/workspaceAuth.js";
import { getMember } from "@/lib/db/repos/workspacesRepo.js";
import { getModelAccessSnapshot, saveWorkspaceModelAccess, saveMemberModelAccess } from "@/lib/db/repos/modelAccessRepo.js";
import { runWithWorkspace } from "./requestContext.js";
import { getModelAccessCatalog } from "./modelAccessCatalog.js";

export async function handleModelAccess(request, { params }) {
  const { id, userId } = await params;
  const auth = await requireWorkspaceManager(request, id);
  if (auth.error) return auth.error;
  if (userId && !await getMember(id, userId)) return Response.json({ error: "Member not found" }, { status: 404 });
  return runWithWorkspace({ workspaceId: id, userId: auth.user.id }, async () => {
    try {
      if (request.method === "PATCH") {
        const policy = await request.json();
        if (userId) await saveMemberModelAccess(userId, policy);
        else await saveWorkspaceModelAccess(policy);
      }
      const snapshot = await getModelAccessSnapshot(userId);
      return Response.json({ policy: userId ? snapshot.member : snapshot.workspace, workspacePolicy: snapshot.workspace,
        effective: snapshot.summary, ...(request.method === "GET" ? { catalog: await getModelAccessCatalog() } : {}) },
      { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  });
}
