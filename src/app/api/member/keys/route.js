import { NextResponse } from "next/server";
import { createApiKey, getApiKeys } from "@/lib/db/repos/apiKeysRepo.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { withDashboardWorkspace } from "@/lib/workspaces/requestContext.js";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.MEMBER, async ({ user }) => {
    const keys = await getApiKeys({ userId: user.id });
    return NextResponse.json({ keys }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(request) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.MEMBER, async ({ user }) => {
    const { name } = await request.json();
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName) return NextResponse.json({ error: "Key name is required" }, { status: 400 });
    if (cleanName.length > 80) return NextResponse.json({ error: "Key name is too long" }, { status: 400 });
    const machineId = await getConsistentMachineId();
    const key = await createApiKey(cleanName, machineId, user.id);
    return NextResponse.json({ key }, { status: 201 });
  });
}
