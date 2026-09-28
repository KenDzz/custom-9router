import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";
import { getUserByIdentifier, verifyPassword } from "@/lib/db/repos/usersRepo.js";
import { getWorkspacesForUser } from "@/lib/db/repos/workspacesRepo.js";
import { DEFAULT_WORKSPACE_ID } from "@/lib/workspaces/constants.js";

const RESET_HINT = "Forgot password? Reset to default via 9Router CLI → Settings → Reset Password to Default.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const DEFAULT_PASSWORD = "123456";
// Migrated single-tenant installs only ever have one user, "admin" — accepting
// no identifier keeps old dashboard clients (pre-workspace UI) working as-is.
const DEFAULT_IDENTIFIER = "admin";

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const { identifier, password } = await request.json();
    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    if (settings.authMode === "oidc" && isOidcConfigured(settings)) {
      return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
    }

    const user = await getUserByIdentifier(identifier || DEFAULT_IDENTIFIER);
    const isValid = user?.isActive ? await verifyPassword(user, password) : false;

    if (isValid) {
      recordSuccess(ip);
      const cookieStore = await cookies();
      const memberships = await getWorkspacesForUser(user.id);
      const activeWorkspace = memberships.find((w) => w.isDefault) || memberships[0] || null;
      await setDashboardAuthCookie(cookieStore, request, {
        sub: user.id,
        userId: user.id,
        activeWorkspaceId: activeWorkspace?.id || DEFAULT_WORKSPACE_ID,
        loginMethod: "password",
      });

      // Still on the seed default password on a remote client → force a
      // password change before the dashboard is exposed remotely (local UX unchanged).
      const mustChangePassword =
        !isLocalRequest(request) && await verifyPassword(user, process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD);

      return NextResponse.json({ success: true, mustChangePassword }, { headers: NO_STORE_HEADERS });
    }

    const { remainingBeforeLock } = recordFail(ip);
    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
      );
    }
    return NextResponse.json(
      { error: `Invalid password. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
