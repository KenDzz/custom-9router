import { NextResponse } from "next/server";
import { requireWorkspaceRole } from "@/lib/auth/workspaceAuth.js";
import { getMember } from "@/lib/db/repos/workspacesRepo.js";
import {
  getUserByEmail,
  getUserById,
  getUserByUsername,
  normalizeIdentifier,
  toPublicUser,
} from "@/lib/db/repos/usersRepo.js";
import { updateMemberProfile } from "@/lib/db/repos/memberManagementRepo.js";
import { getMemberDashboard } from "@/lib/db/repos/memberAccessRepo.js";
import { isWorkspaceRole, WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

async function loadProfile(workspaceId, userId) {
  const [user, member, dashboard] = await Promise.all([
    getUserById(userId),
    getMember(workspaceId, userId),
    getMemberDashboard(workspaceId, userId),
  ]);
  if (!user || !member) return null;
  return { user: toPublicUser(user), member, dashboard };
}

export async function GET(request, { params }) {
  const { id, userId } = await params;
  const { error } = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.OWNER);
  if (error) return error;
  const profile = await loadProfile(id, userId);
  if (!profile) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  return NextResponse.json(profile, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request, { params }) {
  const { id, userId } = await params;
  const { error, user: actor } = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.OWNER);
  if (error) return error;
  const currentMember = await getMember(id, userId);
  const currentUser = await getUserById(userId);
  if (!currentMember || !currentUser) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const body = await request.json();
  const updates = {};
  if (body.role !== undefined) {
    if (!isWorkspaceRole(body.role)) return NextResponse.json({ error: "Invalid workspace role" }, { status: 400 });
    updates.role = body.role;
  }
  if (body.username !== undefined) {
    const username = normalizeIdentifier(body.username);
    if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
      return NextResponse.json({ error: "Username must be 3-64 characters using letters, numbers, dot, dash or underscore" }, { status: 400 });
    }
    const conflict = await getUserByUsername(username);
    if (conflict && conflict.id !== userId) return NextResponse.json({ error: "Username is already in use" }, { status: 409 });
    updates.username = username;
  }
  if (body.email !== undefined) {
    const email = normalizeIdentifier(body.email);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Email is invalid" }, { status: 400 });
    const conflict = email ? await getUserByEmail(email) : null;
    if (conflict && conflict.id !== userId) return NextResponse.json({ error: "Email is already in use" }, { status: 409 });
    updates.email = email || null;
  }
  if (body.displayName !== undefined) updates.displayName = String(body.displayName).trim().slice(0, 100) || null;

  if (body.dailyTokenLimit !== undefined) {
    const limit = Number(body.dailyTokenLimit);
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1_000_000_000_000) {
      return NextResponse.json({ error: "Daily token limit must be an integer from 0 to 1,000,000,000,000" }, { status: 400 });
    }
    updates.dailyTokenLimit = limit;
  }

  if (body.newPassword) {
    if (typeof body.newPassword !== "string" || body.newPassword.length < 8 || body.newPassword.length > 72) {
      return NextResponse.json({ error: "New password must contain at least 8 characters" }, { status: 400 });
    }
    updates.newPassword = body.newPassword;
  }
  try {
    await updateMemberProfile(id, userId, updates, actor.id);
  } catch (error) {
    return NextResponse.json({ error: error.message.includes("UNIQUE") ? "Username or email is already in use" : error.message }, { status: 400 });
  }

  return NextResponse.json(await loadProfile(id, userId));
}
