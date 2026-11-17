import { NextResponse } from "next/server";
import { requireWorkspaceRole, requireWorkspaceAdmin } from "@/lib/auth/workspaceAuth.js";
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

// Directly adds an existing user. Grant ownership through the role endpoint.
export async function POST(request, { params }) {
  const { id } = await params;
  const { error } = await requireWorkspaceAdmin(request, id);
  if (error) return error;
  const { identifier, role = WORKSPACE_ROLES.MEMBER, dailyTokenLimit } = await request.json();
  if (!isWorkspaceRole(role) || role === WORKSPACE_ROLES.OWNER) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  const limit = dailyTokenLimit;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0 || limit > 1_000_000_000_000)) {
    return NextResponse.json({ error: "Daily token limit must be an integer from 0 to 1,000,000,000,000" }, { status: 400 });
  }
  const user = await getUserByIdentifier(identifier);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });
  await addMember(id, user.id, role, limit === undefined ? undefined : { dailyTokenLimit: limit });
  return NextResponse.json({ success: true }, { status: 201 });
}
