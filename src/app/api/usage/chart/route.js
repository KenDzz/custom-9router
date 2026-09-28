import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";
import { withDashboardWorkspace } from "@/lib/workspaces/requestContext.js";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d"]);

export async function GET(request) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.MEMBER, async () => {
    try {
      const { searchParams } = new URL(request.url);
      const period = searchParams.get("period") || "7d";

      if (!VALID_PERIODS.has(period)) {
        return NextResponse.json({ error: "Invalid period" }, { status: 400 });
      }

      const data = await getChartData(period);
      return NextResponse.json(data);
    } catch (error) {
      console.error("[API] Failed to get chart data:", error);
      return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
    }
  });
}
