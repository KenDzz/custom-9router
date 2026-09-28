// Central access policy for the custom member surface. Upstream dashboard
// routes added later remain unavailable to members unless explicitly allowed.
const MEMBER_API_METHODS = {
  "/api/users/me": ["GET"],
  "/api/auth/workspace": ["POST"],
  "/api/workspaces": ["GET"],
};

export function isMemberApiAllowed(pathname, method = "GET") {
  if (pathname === "/api/member" || pathname.startsWith("/api/member/")) return true;
  return MEMBER_API_METHODS[pathname]?.includes(method.toUpperCase()) || false;
}

export function isMemberPageAllowed(pathname) {
  return pathname === "/dashboard/member" || pathname.startsWith("/dashboard/member/");
}
