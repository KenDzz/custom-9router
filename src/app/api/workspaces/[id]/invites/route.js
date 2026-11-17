import { NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth/workspaceAuth.js";
import { getInvitesForWorkspace, createInvite } from "@/lib/db/repos/workspacesRepo.js";
import { WORKSPACE_ROLES, isWorkspaceRole } from "@/lib/workspaces/constants.js";
import { readSplitTokenLimits } from "@/lib/workspaces/tokenQuotas.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const { error } = await requireWorkspaceAdmin(request, id);
  if (error) return error;
  // Raw token only ever exists at creation time — list responses carry no token/hash.
  const invites = (await getInvitesForWorkspace(id)).map(({ tokenHash, ...rest }) => rest);
  return NextResponse.json({ invites });
}

export async function POST(request, { params }) {
  const { id } = await params;
  const { user, error } = await requireWorkspaceAdmin(request, id);
  if (error) return error;
  const body = await request.json();
  const { email, role = WORKSPACE_ROLES.MEMBER, dailyTokenLimit } = body;
  let split;
  try {
    split = readSplitTokenLimits(body);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const quotaOptions = Object.keys(split).length ? split
    : dailyTokenLimit === undefined ? undefined : { dailyTokenLimit };
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  // Owner role can never be invited directly (also enforced by schema CHECK).
  if (!isWorkspaceRole(role) || role === WORKSPACE_ROLES.OWNER) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  if (dailyTokenLimit !== undefined && (!Number.isSafeInteger(dailyTokenLimit) || dailyTokenLimit < 0 || dailyTokenLimit > 1_000_000_000_000)) {
    return NextResponse.json({ error: "Daily token limit must be an integer from 0 to 1,000,000,000,000" }, { status: 400 });
  }
  const invite = await createInvite(id, email, role, user.id, quotaOptions);
  return NextResponse.json({ invite }, { status: 201 });
}
