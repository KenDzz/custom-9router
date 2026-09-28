import { NextResponse } from "next/server";
import { requireWorkspaceRole } from "@/lib/auth/workspaceAuth.js";
import { revokeInvite } from "@/lib/db/repos/workspacesRepo.js";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  const { id, inviteId } = await params;
  const { error } = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.ADMIN);
  if (error) return error;
  await revokeInvite(id, inviteId);
  return NextResponse.json({ success: true });
}
