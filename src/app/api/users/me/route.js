import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/workspaceAuth.js";
import { updateUser, toPublicUser } from "@/lib/db/repos/usersRepo.js";
import { getWorkspacesForUser } from "@/lib/db/repos/workspacesRepo.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { user, session, error } = await requireUser(request);
  if (error) return error;
  const workspaces = await getWorkspacesForUser(user.id);
  return NextResponse.json({ user, activeWorkspaceId: session.activeWorkspaceId, workspaces }, { headers: { "Cache-Control": "no-store" } });
}

// Profile fields only — password change goes through the dedicated
// reset-password flow, never through this generic PATCH.
export async function PATCH(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { displayName, email } = await request.json();
  const updated = await updateUser(user.id, {
    ...(displayName !== undefined ? { displayName } : {}),
    ...(email !== undefined ? { email } : {}),
  });
  return NextResponse.json({ user: toPublicUser(updated) });
}
