import { NextResponse } from "next/server";
import { getMemberDashboard } from "@/lib/db/repos/memberAccessRepo.js";
import { withDashboardWorkspace } from "@/lib/workspaces/requestContext.js";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.MEMBER, async ({ user, session, member }) => {
    const dashboard = await getMemberDashboard(session.activeWorkspaceId, user.id);
    if (!dashboard) return NextResponse.json({ error: "Workspace membership not found" }, { status: 404 });
    return NextResponse.json({ dashboard, member }, { headers: { "Cache-Control": "no-store" } });
  });
}
