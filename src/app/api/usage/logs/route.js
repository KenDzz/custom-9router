import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";
import { withDashboardWorkspace } from "@/lib/workspaces/requestContext.js";

export async function GET(request) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.MEMBER, async () => {
    try {
      const logs = await getRecentLogs(200);
      return NextResponse.json(logs);
    } catch (error) {
      console.error("[API ERROR] /api/usage/logs failed:", error);
      console.error("[API ERROR] Stack:", error?.stack);
      return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
    }
  });
}
