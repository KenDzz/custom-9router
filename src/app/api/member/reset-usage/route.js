import { NextResponse } from "next/server";
import { withDashboardWorkspace } from "@/lib/workspaces/requestContext.js";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";
import { redeemMemberResetGift } from "@/lib/db/repos/memberGiftsRepo.js";
import { getMemberDashboard } from "@/lib/db/repos/memberAccessRepo.js";

export async function POST(request) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.MEMBER, async ({ user, session }) => {
    try {
      await redeemMemberResetGift(session.activeWorkspaceId, user.id);
      return NextResponse.json({ dashboard: await getMemberDashboard(session.activeWorkspaceId, user.id) });
    } catch (cause) {
      return NextResponse.json({ error: cause.message }, { status: 409 });
    }
  });
}
