import { verifyPassword } from "@/lib/db/repos/usersRepo.js";

// Read the current hash so existing sessions and other tabs see the same rule.
export async function usesInitialPassword(user) {
  if (!user?.passwordHash) return false;
  return verifyPassword(user, process.env.INITIAL_PASSWORD || "123456");
}

export function isPasswordSession(session) {
  return !!session && session.loginMethod !== "oidc" && session.loginMethod !== "saml" && !session.oidc && !session.saml;
}
