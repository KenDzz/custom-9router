import { NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth/workspaceAuth.js";
import { revokeInvite } from "@/lib/db/repos/workspacesRepo.js";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  const { id, inviteId } = await params;
  const { error } = await requireWorkspaceAdmin(request, id);
  if (error) return error;
  await revokeInvite(id, inviteId);
  return NextResponse.json({ success: true });
}
