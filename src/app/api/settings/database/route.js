import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { requireDefaultOwner } from "@/lib/auth/workspaceAuth.js";
import { runWithWorkspace } from "@/lib/workspaces/requestContext.js";
import { DEFAULT_WORKSPACE_ID } from "@/lib/workspaces/constants.js";

const PASSWORD_HEADER = "x-9r-password";

export async function GET(request) {
  const { user, error } = await requireDefaultOwner(request);
  if (error) return error;

  try {
    if (!(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER), user.id))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const payload = await runWithWorkspace(
      { workspaceId: DEFAULT_WORKSPACE_ID, userId: user.id },
      () => exportDb({ includeGlobal: true }),
    );
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  const { user, error } = await requireDefaultOwner(request);
  if (error) return error;

  try {
    const { password, ...payload } = await request.json();
    if (!(await verifyDashboardPassword(password, user.id))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    await runWithWorkspace(
      { workspaceId: DEFAULT_WORKSPACE_ID, userId: user.id },
      () => importDb(payload, { includeGlobal: true }),
    );

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: 400 }
    );
  }
}
