import { requireWorkspaceRole } from "@/lib/auth/workspaceAuth.js";
import { getMember } from "@/lib/db/repos/workspacesRepo.js";
import { getTokenSaverSnapshot, saveTokenSaverPolicy } from "@/lib/db/repos/tokenSaverRepo.js";
import { runWithWorkspace } from "./requestContext.js";
import { WORKSPACE_ROLES } from "./constants.js";

export async function handleTokenSaver(request, { params }) {
  const { id, userId } = await params;
  const auth = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.OWNER);
  if (auth.error) return auth.error;
  if (userId && !await getMember(id, userId)) return Response.json({ error: "Member not found" }, { status: 404 });
  return runWithWorkspace({ workspaceId: id, userId: auth.user.id }, async () => {
    try {
      if (request.method === "PATCH") await saveTokenSaverPolicy(await request.json(), userId);
      return Response.json(await getTokenSaverSnapshot(userId), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  });
}
