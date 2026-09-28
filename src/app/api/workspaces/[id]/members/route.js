import { NextResponse } from "next/server";
import { requireWorkspaceRole } from "@/lib/auth/workspaceAuth.js";
import { getMembers, addMember } from "@/lib/db/repos/workspacesRepo.js";
import { getUserByIdentifier } from "@/lib/db/repos/usersRepo.js";
import { WORKSPACE_ROLES, isWorkspaceRole } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const { error } = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.MEMBER);
  if (error) return error;
  const members = await getMembers(id);
  return NextResponse.json({ members });
}

// Directly adds an existing user (no invite round-trip) — admin+ only, and
// never as owner: ownership is granted via updateMemberRole by an existing owner.
export async function POST(request, { params }) {
  const { id } = await params;
  const { error } = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.ADMIN);
  if (error) return error;
  const { identifier, role = WORKSPACE_ROLES.MEMBER } = await request.json();
  if (!isWorkspaceRole(role) || role === WORKSPACE_ROLES.OWNER) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  const user = await getUserByIdentifier(identifier);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });
  await addMember(id, user.id, role);
  return NextResponse.json({ success: true }, { status: 201 });
}
