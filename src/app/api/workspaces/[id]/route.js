import { NextResponse } from "next/server";
import { requireWorkspaceRole } from "@/lib/auth/workspaceAuth.js";
import { getWorkspaceById, renameWorkspace, deleteWorkspace } from "@/lib/db/repos/workspacesRepo.js";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const { error } = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.MEMBER);
  if (error) return error;
  const workspace = await getWorkspaceById(id);
  if (!workspace) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ workspace });
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const { error } = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.ADMIN);
  if (error) return error;
  const { name } = await request.json();
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  await renameWorkspace(id, name.trim());
  const workspace = await getWorkspaceById(id);
  return NextResponse.json({ workspace });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const { error } = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.OWNER);
  if (error) return error;
  try {
    await deleteWorkspace(id);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
