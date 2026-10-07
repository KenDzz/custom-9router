import { NextResponse } from "next/server";
import { requireWorkspaceRole } from "@/lib/auth/workspaceAuth.js";
import { createMemberGift, listMemberGifts } from "@/lib/db/repos/memberGiftsRepo.js";
import { WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id, userId } = await params;
  const { error } = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.OWNER);
  if (error) return error;
  return NextResponse.json({ gifts: await listMemberGifts(id, userId) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request, { params }) {
  const { id, userId } = await params;
  const { error, user } = await requireWorkspaceRole(request, id, WORKSPACE_ROLES.OWNER);
  if (error) return error;
  try {
    const gift = await createMemberGift(id, userId, await request.json(), user.id);
    return NextResponse.json({ gift }, { status: 201 });
  } catch (cause) {
    return NextResponse.json({ error: cause.message }, { status: 400 });
  }
}
