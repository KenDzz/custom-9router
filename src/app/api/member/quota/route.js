import { withDashboardWorkspace } from "@/lib/workspaces/requestContext.js";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";
import { getMemberProviderQuota } from "@/lib/workspaces/memberProviderQuota.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.MEMBER, async ({ session }) => {
    try {
      const providers = await getMemberProviderQuota(session.activeWorkspaceId);
      return Response.json({ providers }, {
        headers: { "Cache-Control": "no-store", "X-Quota-Workspace": session.activeWorkspaceId },
      });
    } catch {
      return Response.json({ error: "Provider quota is unavailable" }, { status: 503 });
    }
  });
}
