import { NextResponse } from "next/server";
import { setPassword } from "@/lib/db/repos/usersRepo.js";
import { MIGRATED_ADMIN_USER_ID } from "@/lib/workspaces/constants.js";

// Reset the migrated admin account to the configured/default seed password.
// Local-only (enforced by dashboardGuard). Never returns the default literal.
export async function POST() {
  try {
    await setPassword(MIGRATED_ADMIN_USER_ID, process.env.INITIAL_PASSWORD || "123456");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
