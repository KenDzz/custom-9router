import { NextResponse } from "next/server";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession.js";
import { getUserById, setPassword, verifyPassword } from "@/lib/db/repos/usersRepo.js";

export async function POST(request) {
  const session = await getDashboardAuthSession(request.cookies.get("auth_token")?.value);
  const user = session?.userId ? await getUserById(session.userId) : null;
  if (!user?.isActive) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { currentPassword, newPassword } = body || {};
  if (typeof currentPassword !== "string" || !currentPassword
    || !(await verifyPassword(user, currentPassword))) {
    return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8
    || new TextEncoder().encode(newPassword).length > 72) {
    return NextResponse.json({ error: "New password must be at least 8 characters and at most 72 bytes" }, { status: 400 });
  }
  if (newPassword === (process.env.INITIAL_PASSWORD || "123456")
    || await verifyPassword(user, newPassword)) {
    return NextResponse.json({ error: "Choose a new password different from the current and initial password" }, { status: 400 });
  }
  // Only the signed-in user's password is writable; workspace ownership is irrelevant.
  await setPassword(user.id, newPassword);
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
