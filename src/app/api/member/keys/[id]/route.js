import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/db/repos/apiKeysRepo.js";
import { withDashboardWorkspace } from "@/lib/workspaces/requestContext.js";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.MEMBER, async ({ user }) => {
    const { id } = await params;
    const existing = await getApiKeyById(id, { userId: user.id });
    if (!existing) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    const { isActive, name } = await request.json();
    const updates = {};
    if (typeof isActive === "boolean") updates.isActive = isActive;
    if (typeof name === "string" && name.trim()) updates.name = name.trim().slice(0, 80);
    const key = await updateApiKey(id, updates, { userId: user.id });
    return NextResponse.json({ key });
  });
}

export async function DELETE(request, { params }) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.MEMBER, async ({ user }) => {
    const { id } = await params;
    const deleted = await deleteApiKey(id, { userId: user.id });
    if (!deleted) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  });
}
