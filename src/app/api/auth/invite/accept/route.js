import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPendingInviteByToken, acceptInvite, getWorkspaceById } from "@/lib/db/repos/workspacesRepo.js";
import { getUserByIdentifier, createUser, verifyPassword, toPublicUser } from "@/lib/db/repos/usersRepo.js";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession.js";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

// Safe invitation preview used by the public acceptance page. The raw token is
// the capability; never expose its hash, inviter id, or user record.
export async function GET(request) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const invite = await getPendingInviteByToken(token);
  if (!invite) return NextResponse.json({ error: "invite invalid or expired" }, { status: 404 });

  const [workspace, existingUser] = await Promise.all([
    getWorkspaceById(invite.workspaceId),
    getUserByIdentifier(invite.email),
  ]);
  const session = await getDashboardAuthSession(request.cookies.get("auth_token")?.value);

  return NextResponse.json({
    invite: {
      email: invite.email,
      role: invite.role,
      dailyTokenLimit: invite.dailyTokenLimit,
      expiresAt: invite.expiresAt,
      workspaceName: workspace?.name || "Workspace",
    },
    existingUser: !!existingUser,
    authenticatedAsInvitee: !!existingUser && session?.userId === existingUser.id,
  }, { headers: { "Cache-Control": "no-store" } });
}

// Existing session (username/password already chosen) OR brand-new account
// (username/displayName/password supplied here) join a workspace via invite.
export async function POST(request) {
  const { token, username, displayName, password } = await request.json();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const invite = await getPendingInviteByToken(token);
  if (!invite) return NextResponse.json({ error: "invite invalid or expired" }, { status: 400 });

  let user = await getUserByIdentifier(invite.email);
  if (!user) {
    if (!username || !password) {
      return NextResponse.json({ error: "username and password required for new account" }, { status: 400 });
    }
    if (await getUserByIdentifier(username)) {
      return NextResponse.json({ error: "username already taken" }, { status: 409 });
    }
    user = await createUser({
      username,
      email: invite.email,
      displayName: displayName || username,
      passwordHash: bcrypt.hashSync(password, 10),
    });
  } else {
    const session = await getDashboardAuthSession(request.cookies.get("auth_token")?.value);
    const ownsSession = session?.userId === user.id;
    const passwordMatches = password ? await verifyPassword(user, password) : false;
    if (!ownsSession && !passwordMatches) {
      return NextResponse.json(
        { error: "sign in as the invited user or provide the current password" },
        { status: 401 },
      );
    }
  }

  try {
    await acceptInvite(invite.id, user.id);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const workspace = await getWorkspaceById(invite.workspaceId);
  const cookieStore = await cookies();
  await setDashboardAuthCookie(cookieStore, request, {
    sub: user.id,
    userId: user.id,
    activeWorkspaceId: workspace?.id || invite.workspaceId,
    loginMethod: "invite",
  });

  return NextResponse.json({ user: toPublicUser(user), workspace });
}
