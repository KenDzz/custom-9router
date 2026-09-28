import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/workspaceAuth.js";
import { getMember } from "@/lib/db/repos/workspacesRepo.js";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession.js";

export const dynamic = "force-dynamic";

// Switches the dashboard's active workspace. Re-verifies membership before
// issuing a new JWT — never trusts a workspaceId the client merely asserts.
export async function POST(request) {
  const { user, session, error } = await requireUser(request);
  if (error) return error;
  const { workspaceId } = await request.json();
  const member = await getMember(workspaceId, user.id);
  if (!member) return NextResponse.json({ error: "not a member of that workspace" }, { status: 403 });

  const cookieStore = await cookies();
  await setDashboardAuthCookie(cookieStore, request, {
    sub: user.id,
    userId: user.id,
    activeWorkspaceId: workspaceId,
    loginMethod: session.loginMethod || "password",
  });
  return NextResponse.json({ success: true, activeWorkspaceId: workspaceId, role: member.role });
}
