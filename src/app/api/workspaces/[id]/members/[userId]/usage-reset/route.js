import { NextResponse } from "next/server";
import { requireWorkspaceManager } from "@/lib/auth/workspaceAuth.js";
import { resetMemberQuotaUsage } from "@/lib/db/repos/memberGiftsRepo.js";
import { getMemberTokenStatus } from "@/lib/db/repos/memberAccessRepo.js";

export async function POST(request, { params }) {
  const { id, userId } = await params;
  const { error } = await requireWorkspaceManager(request, id);
  if (error) return error;
  try {
    await resetMemberQuotaUsage(id, userId);
    return NextResponse.json({ tokenStatus: await getMemberTokenStatus(id, userId) });
  } catch (cause) {
    return NextResponse.json({ error: cause.message }, { status: 400 });
  }
}
