import { NextResponse } from "next/server";
import { requireWorkspaceRole } from "@/lib/auth/workspaceAuth.js";
import { getMember, updateMemberRole, removeMember } from "@/lib/db/repos/workspacesRepo.js";
import { WORKSPACE_ROLES, isWorkspaceRole } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

// Changing to/from owner requires an owner; admin may only touch member<->admin.
export async function PATCH(request, { params }) {
  const { id, userId } = await params;
  const { role } = await request.json();
  if (!isWorkspaceRole(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });
  const target = await getMember(id, userId);
  if (!target) return NextResponse.json({ error: "member not found" }, { status: 404 });
  const minimumRole = role === WORKSPACE_ROLES.OWNER || target.role === WORKSPACE_ROLES.OWNER
    ? WORKSPACE_ROLES.OWNER
    : WORKSPACE_ROLES.ADMIN;
  const { error } = await requireWorkspaceRole(request, id, minimumRole);
  if (error) return error;
  try {
    await updateMemberRole(id, userId, role);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request, { params }) {
  const { id, userId } = await params;
  const target = await getMember(id, userId);
  if (!target) return NextResponse.json({ error: "member not found" }, { status: 404 });
  const minimumRole = target.role === WORKSPACE_ROLES.OWNER
    ? WORKSPACE_ROLES.OWNER
    : WORKSPACE_ROLES.ADMIN;
  const { error } = await requireWorkspaceRole(request, id, minimumRole);
  if (error) return error;
  try {
    await removeMember(id, userId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
