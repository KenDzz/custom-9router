import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/workspaceAuth.js";
import { getWorkspacesForUser, createWorkspace } from "@/lib/db/repos/workspacesRepo.js";

export const dynamic = "force-dynamic";

// List workspaces the current user belongs to.
export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const workspaces = await getWorkspacesForUser(user.id);
  return NextResponse.json({ workspaces }, { headers: { "Cache-Control": "no-store" } });
}

// Any authenticated user may create a workspace; creator becomes its owner.
export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { name } = await request.json();
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const workspace = await createWorkspace(name.trim(), user.id);
  return NextResponse.json({ workspace }, { status: 201 });
}
