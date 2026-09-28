import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeOidcCode,
  fetchOidcDiscovery,
  getOidcRuntimeConfig,
  getPublicOrigin,
  pickOidcDisplayName,
  pickOidcEmail,
  verifyOidcIdToken,
} from "@/lib/auth/oidc";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import {
  createUser,
  getUserByEmail,
  getUserByOidc,
  getUserByUsername,
  normalizeIdentifier,
  updateUser,
} from "@/lib/db/repos/usersRepo.js";
import { addMember, getWorkspacesForUser } from "@/lib/db/repos/workspacesRepo.js";
import { DEFAULT_WORKSPACE_ID, WORKSPACE_ROLES } from "@/lib/workspaces/constants.js";

function clearOidcCookies(cookieStore) {
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");
}

async function uniqueOidcUsername(email, subject) {
  const seed = normalizeIdentifier(email?.split("@")[0] || `oidc-${subject}`)
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "oidc-user";
  let candidate = seed;
  for (let suffix = 2; await getUserByUsername(candidate); suffix += 1) {
    candidate = `${seed}-${suffix}`;
  }
  return candidate;
}

async function resolveOidcUser({ issuer, payload }) {
  const subject = String(payload.sub || "").trim();
  if (!subject) throw new Error("OIDC token is missing subject");
  const email = normalizeIdentifier(pickOidcEmail(payload));
  const displayName = pickOidcDisplayName(payload);

  let user = await getUserByOidc(issuer, subject);
  if (!user && email) user = await getUserByEmail(email);

  if (user) {
    return updateUser(user.id, {
      ...(email ? { email } : {}),
      ...(displayName ? { displayName } : {}),
      oidcIssuer: issuer,
      oidcSubject: subject,
    });
  }

  user = await createUser({
    username: await uniqueOidcUsername(email, subject),
    email: email || null,
    displayName: displayName || email || "OIDC user",
    oidcIssuer: issuer,
    oidcSubject: subject,
  });
  // Before workspaces, every successful OIDC login could manage providers.
  // Preserve that capability for newly-provisioned identities without granting
  // system-owner privileges over global settings or the Default workspace.
  await addMember(DEFAULT_WORKSPACE_ID, user.id, WORKSPACE_ROLES.ADMIN);
  return user;
}

export async function GET(request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, getPublicOrigin(request)));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=oidc_missing_code", getPublicOrigin(request)));
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get("oidc_state")?.value;
  const storedNonce = cookieStore.get("oidc_nonce")?.value;
  const codeVerifier = cookieStore.get("oidc_code_verifier")?.value;

  if (!storedState || !storedNonce || !codeVerifier || storedState !== state) {
    clearOidcCookies(cookieStore);
    return NextResponse.redirect(new URL("/login?error=oidc_invalid_state", getPublicOrigin(request)));
  }

  try {
    const config = await getOidcRuntimeConfig();
    if (!config) {
      clearOidcCookies(cookieStore);
      return NextResponse.redirect(new URL("/login?error=oidc_not_configured", getPublicOrigin(request)));
    }

    const discovery = await fetchOidcDiscovery(config.issuerUrl);
    const discoveredIssuer = discovery.issuer || config.issuerUrl;
    const redirectUri = `${getPublicOrigin(request)}/api/auth/oidc/callback`;
    const tokenData = await exchangeOidcCode({
      tokenEndpoint: discovery.token_endpoint,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri,
      codeVerifier,
    });

    if (!tokenData.id_token) {
      throw new Error("OIDC provider did not return an id_token");
    }

    const payload = await verifyOidcIdToken({
      idToken: tokenData.id_token,
      issuer: discoveredIssuer,
      audience: config.clientId,
      jwksUri: discovery.jwks_uri,
      nonce: storedNonce,
    });

    const user = await resolveOidcUser({ issuer: discoveredIssuer, payload });
    let memberships = await getWorkspacesForUser(user.id);
    if (memberships.length === 0) {
      await addMember(DEFAULT_WORKSPACE_ID, user.id, WORKSPACE_ROLES.ADMIN);
      memberships = await getWorkspacesForUser(user.id);
    }
    const activeWorkspace = memberships.find((workspace) => workspace.isDefault) || memberships[0];

    clearOidcCookies(cookieStore);
    await setDashboardAuthCookie(cookieStore, request, {
      sub: user.id,
      userId: user.id,
      activeWorkspaceId: activeWorkspace?.id || DEFAULT_WORKSPACE_ID,
      loginMethod: "oidc",
      oidc: true,
      oidcSub: payload.sub || null,
      oidcEmail: pickOidcEmail(payload) || null,
      oidcName: pickOidcDisplayName(payload),
    });

    return NextResponse.redirect(new URL("/dashboard", getPublicOrigin(request)));
  } catch (error) {
    clearOidcCookies(cookieStore);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message || "oidc_callback_failed")}`, getPublicOrigin(request)));
  }
}
