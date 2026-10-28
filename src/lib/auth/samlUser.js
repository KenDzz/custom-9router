import { createHash } from "node:crypto";
import { createUser, getUserByOidc, getUserByUsername, updateUser } from "@/lib/db/repos/usersRepo.js";
import { addMember, getWorkspacesForUser } from "@/lib/db/repos/workspacesRepo.js";
import { DEFAULT_WORKSPACE_ID, WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

// SAML identities use a protocol-qualified issuer so they cannot collide with OIDC.
export async function resolveSamlUser(profile, settings, { email, name }) {
  const subject = String(profile.nameID || "").trim();
  if (!subject) throw new Error("SAML assertion is missing NameID");
  const issuer = "saml:" + String(profile.issuer || settings.samlEntryPoint);
  let user = await getUserByOidc(issuer, subject);
  if (user && !user.isActive) throw new Error("Account is disabled");
  if (!user) {
    // Never attach an external identity to an existing local user just by email.
    const seed = "saml-" + createHash("sha256").update(issuer + "\0" + subject).digest("hex").slice(0, 20);
    let username = seed;
    for (let n = 2; await getUserByUsername(username); n++) username = seed + "-" + n;
    user = await createUser({ username, displayName: name || email || subject, oidcIssuer: issuer, oidcSubject: subject });
  } else {
    user = await updateUser(user.id, { displayName: name || email || user.displayName });
  }
  let memberships = await getWorkspacesForUser(user.id);
  if (!memberships.length) {
    await addMember(DEFAULT_WORKSPACE_ID, user.id, WORKSPACE_ROLES.ADMIN);
    memberships = await getWorkspacesForUser(user.id);
  }
  const active = memberships.find((workspace) => workspace.isDefault) || memberships[0];
  return { user, activeWorkspaceId: active.id };
}
