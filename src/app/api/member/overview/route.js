import { NextResponse } from "next/server";
import { getMemberDashboard } from "@/lib/db/repos/memberAccessRepo.js";
import { withDashboardWorkspace } from "@/lib/workspaces/requestContext.js";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";
import { getModelAccessSnapshot } from "@/lib/db/repos/modelAccessRepo.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.MEMBER, async ({ user, session, member }) => {
    const dashboard = await getMemberDashboard(session.activeWorkspaceId, user.id);
    if (!dashboard) return NextResponse.json({ error: "Workspace membership not found" }, { status: 404 });
    const { summary: modelAccess } = await getModelAccessSnapshot(user.id);
    return NextResponse.json({ dashboard, member, modelAccess }, { headers: { "Cache-Control": "no-store" } });
  });
}
