import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";
import { withDashboardWorkspace } from "@/lib/workspaces/requestContext.js";

export async function GET(request) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.MEMBER, async () => {
    try {
      const stats = await getUsageStats();
      return NextResponse.json(stats);
    } catch (error) {
      console.error("Error fetching usage stats:", error);
      return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
    }
  });
}
