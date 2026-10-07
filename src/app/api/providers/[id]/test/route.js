import { NextResponse } from "next/server";
import { testSingleConnection } from "./testUtils.js";
import { withDashboardWorkspace } from "@/lib/workspaces/requestContext.js";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

// POST /api/providers/[id]/test - Test connection
export async function POST(request, { params }) {
  return withDashboardWorkspace(request, WORKSPACE_ROLES.ADMIN, () => handlePost({ params }));
}

async function handlePost({ params }) {
  try {
    const { id } = await params;
    const result = await testSingleConnection(id);

    if (result.error === "Connection not found") {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
