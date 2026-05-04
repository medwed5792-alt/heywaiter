import { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8 } from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { HEYWAITER_STAFF_ADMIN_AUTH_COOKIE } from "@/lib/auth/staff-admin-auth-cookie";
import { isStaffAdminLoginPath } from "@/lib/auth/staff-admin-paths";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken%40system.gserviceaccount.com"
  )
);

function getFirebaseProjectId(): string {
  return (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    ""
  );
}

export async function verifyFirebaseIdTokenEdge(idToken: string): Promise<{ uid: string } | null> {
  const projectId = getFirebaseProjectId();
  if (!projectId || !idToken.trim()) return null;
  try {
    const { payload } = await jwtVerify(idToken.trim(), FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    });
    const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!sub) return null;
    return { uid: sub };
  } catch {
    return null;
  }
}

let accessTokenCache: { token: string; expMs: number } | null = null;

async function getFirestoreAccessTokenEdge(): Promise<string | null> {
  const now = Date.now();
  if (accessTokenCache && accessTokenCache.expMs > now + 30_000) {
    return accessTokenCache.token;
  }
  const email = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!email || !rawKey) return null;
  const privateKeyPem = rawKey.replace(/\\n/g, "\n");
  try {
    const key = await importPKCS8(privateKeyPem, "RS256");
    const iat = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({
      scope: "https://www.googleapis.com/auth/cloud-platform",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(email)
      .setSubject(email)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(key);
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    const ttlMs =
      typeof json.expires_in === "number" ? Math.min(json.expires_in * 1000, 3_500_000) : 3_500_000;
    accessTokenCache = { token: json.access_token, expMs: now + ttlMs };
    return json.access_token;
  } catch {
    return null;
  }
}

function parseFirestoreStringField(
  fields: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const cell = fields?.[key] as { stringValue?: string } | undefined;
  const v = cell?.stringValue;
  return typeof v === "string" ? v : undefined;
}

export async function fetchGlobalUserSystemRoleEdge(uid: string): Promise<string | null> {
  const projectId = getFirebaseProjectId();
  if (!projectId) return null;
  const access = await getFirestoreAccessTokenEdge();
  if (!access) return null;
  const encUid = encodeURIComponent(uid);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/global_users/${encUid}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${access}` },
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const body = (await res.json()) as { fields?: Record<string, unknown> };
    const role = parseFirestoreStringField(body.fields, "systemRole");
    return role?.trim() ?? null;
  } catch {
    return null;
  }
}

export function isStaffOrAdminRole(systemRole: string | null): boolean {
  if (!systemRole) return false;
  const u = systemRole.trim().toUpperCase();
  return u === "STAFF" || u === "ADMIN";
}

function authLoginPathForRequest(pathname: string): "/admin/login" | "/staff/login" {
  return pathname.startsWith("/staff") ? "/staff/login" : "/admin/login";
}

export async function staffAdminMiddlewareResponse(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isStaffAdminLoginPath(pathname)) {
    return NextResponse.next();
  }

  const failClosedHome = () => {
    const u = request.nextUrl.clone();
    u.pathname = "/";
    u.search = "";
    const res = NextResponse.redirect(u);
    res.cookies.delete(HEYWAITER_STAFF_ADMIN_AUTH_COOKIE);
    return res;
  };

  try {
    const loginBase = authLoginPathForRequest(pathname);
    const nextParam = encodeURIComponent(`${pathname}${request.nextUrl.search || ""}`);

    const redirectLogin = () => {
      const u = request.nextUrl.clone();
      u.pathname = loginBase;
      u.search = `?next=${nextParam}`;
      const res = NextResponse.redirect(u);
      res.cookies.delete(HEYWAITER_STAFF_ADMIN_AUTH_COOKIE);
      return res;
    };

    const redirectHome = () => {
      const u = request.nextUrl.clone();
      u.pathname = "/";
      u.search = "";
      const res = NextResponse.redirect(u);
      res.cookies.delete(HEYWAITER_STAFF_ADMIN_AUTH_COOKIE);
      return res;
    };

    const cookie = request.cookies.get(HEYWAITER_STAFF_ADMIN_AUTH_COOKIE)?.value ?? "";
    if (!cookie.trim()) {
      return redirectLogin();
    }

    if (!getFirebaseProjectId()) {
      return redirectHome();
    }

    const verified = await verifyFirebaseIdTokenEdge(cookie);
    if (!verified) {
      return redirectLogin();
    }

    const role = await fetchGlobalUserSystemRoleEdge(verified.uid);
    if (!isStaffOrAdminRole(role)) {
      return redirectHome();
    }

    return NextResponse.next();
  } catch (e) {
    console.error("[middleware staff-admin]", e);
    return failClosedHome();
  }
}
