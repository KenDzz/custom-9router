import { NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth/workspaceAuth.js";
import { getMember, updateMemberRole, removeMember } from "@/lib/db/repos/workspacesRepo.js";
import { isWorkspaceRole, MIGRATED_ADMIN_USER_ID } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const { id, userId } = await params;
  const { error, user } = await requireWorkspaceAdmin(request, id);
  if (error) return error;
  if (userId === MIGRATED_ADMIN_USER_ID && user.id !== userId) return NextResponse.json({ error: "Cannot modify the built-in admin" }, { status: 403 });
  const { role } = await request.json();
  if (!isWorkspaceRole(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });
  const target = await getMember(id, userId);
  if (!target) return NextResponse.json({ error: "member not found" }, { status: 404 });
  try {
    await updateMemberRole(id, userId, role);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request, { params }) {
  const { id, userId } = await params;
  const { error, user } = await requireWorkspaceAdmin(request, id);
  if (error) return error;
  if (userId === MIGRATED_ADMIN_USER_ID && user.id !== userId) return NextResponse.json({ error: "Cannot remove the built-in admin" }, { status: 403 });
  const target = await getMember(id, userId);
  if (!target) return NextResponse.json({ error: "member not found" }, { status: 404 });
  try {
    await removeMember(id, userId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
