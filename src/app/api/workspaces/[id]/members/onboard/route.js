import { NextResponse } from "next/server";
import { requireWorkspaceRole } from "@/lib/auth/workspaceAuth.js";
import { addMember, createInvite } from "@/lib/db/repos/workspacesRepo.js";
import { getUserByIdentifier } from "@/lib/db/repos/usersRepo.js";
import { WORKSPACE_ROLES, isWorkspaceRole } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { id } = await params;
  const { error, user: actor, member: actorMembership } = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.ADMIN);
  if (error) return error;

  const { identifier, role = WORKSPACE_ROLES.MEMBER, dailyTokenLimit } = await request.json();
  const value = typeof identifier === "string" ? identifier.trim() : "";
  if (!value) return NextResponse.json({ error: "Username or email required" }, { status: 400 });
  if (!isWorkspaceRole(role) || role === WORKSPACE_ROLES.OWNER) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  if (dailyTokenLimit !== undefined && actorMembership.role !== WORKSPACE_ROLES.OWNER) {
    return NextResponse.json({ error: "Owner access required to set a daily token limit" }, { status: 403 });
  }
  if (dailyTokenLimit !== undefined && (!Number.isSafeInteger(dailyTokenLimit) || dailyTokenLimit < 0 || dailyTokenLimit > 1_000_000_000_000)) {
    return NextResponse.json({ error: "Daily token limit must be an integer from 0 to 1,000,000,000,000" }, { status: 400 });
  }

  const quotaOptions = dailyTokenLimit === undefined ? undefined : { dailyTokenLimit };
  const existingUser = await getUserByIdentifier(value);
  if (existingUser) {
    await addMember(id, existingUser.id, role, quotaOptions);
    return NextResponse.json({ mode: "added" }, { status: 201 });
  }

  if (!/^\S+@\S+\.\S+$/.test(value)) {
    return NextResponse.json({ error: "No account found. Enter an email address to invite a new member." }, { status: 404 });
  }
  const invite = await createInvite(id, value, role, actor.id, quotaOptions);
  return NextResponse.json({ mode: "invited", invite }, { status: 201 });
}
