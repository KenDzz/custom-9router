import { NextResponse } from "next/server";
import { requireUser, requireActiveWorkspaceAdmin } from "@/lib/auth/workspaceAuth.js";
import { getWorkspacesForUser, createWorkspace } from "@/lib/db/repos/workspacesRepo.js";
import { MIGRATED_ADMIN_USER_ID, WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

// List workspaces the current user belongs to.
export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const workspaces = await getWorkspacesForUser(user.id);
  return NextResponse.json({ workspaces }, { headers: { "Cache-Control": "no-store" } });
}

// Only an admin in the active workspace may create a new workspace.
export async function POST(request) {
  const { user, error } = await requireActiveWorkspaceAdmin(request);
  if (error) return error;
  const { name } = await request.json();
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const role = user.id === MIGRATED_ADMIN_USER_ID ? WORKSPACE_ROLES.OWNER : WORKSPACE_ROLES.ADMIN;
  const workspace = await createWorkspace(name.trim(), user.id, role);
  return NextResponse.json({ workspace: { ...workspace, role } }, { status: 201 });
}
