export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { findUserByIdentity, toIdentityKey } from "@/lib/auth/unifiedSearch";
import { getEffectiveBotToken } from "@/lib/webhook/bots-store";
import { verifyTelegramWebAppInitData } from "@/lib/telegram-webapp-init-data";
import { resolveGuestCurrentStatusFromProfile } from "@/domain/usecases/guest/resolveGuestCurrentStatus";
import {
  buildGuestMiniAppCommandPayload,
  loadGuestMiniAppSystemBundle,
  loadGuestMiniAppVisitHistory,
} from "@/domain/usecases/guest/buildGuestMiniAppCommandPayload";

/**
 * POST /api/guest/get-current-status
 * Единственный источник фазы гостя: WORKING | FEEDBACK | WELCOME + globalUserFirestoreId.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      provider?: string;
      providerId?: string;
      credentials?: { initData?: string; [key: string]: unknown };
    };
    const providerRaw = String(body.provider ?? "").trim().toLowerCase();
    let providerId = String(body.providerId ?? "").trim();
    const creds =
      body.credentials && typeof body.credentials === "object"
        ? (body.credentials as { initData?: string })
        : {};

    if (!providerRaw) {
      return NextResponse.json({ ok: false, error: "provider required" }, { status: 400 });
    }

    if (providerRaw === "telegram" || providerRaw === "tg") {
      const initData = typeof creds.initData === "string" ? creds.initData.trim() : "";
      if (!initData) {
        return NextResponse.json(
          { ok: false, error: "credentials.initData required for telegram" },
          { status: 400 }
        );
      }
      const token = await getEffectiveBotToken("telegram", "client");
      if (!token) {
        return NextResponse.json({ ok: false, error: "guest_bot_token_unconfigured" }, { status: 503 });
      }
      const v = verifyTelegramWebAppInitData(initData, token);
      if (!v.ok) {
        return NextResponse.json({ ok: false, error: v.reason }, { status: 401 });
      }
      if (providerId && providerId !== v.userId) {
        return NextResponse.json({ ok: false, error: "providerId_mismatch" }, { status: 400 });
      }
      providerId = v.userId;
    } else {
      if (!providerId) {
        return NextResponse.json({ ok: false, error: "providerId required" }, { status: 400 });
      }
    }

    if (!toIdentityKey(providerRaw)) {
      return NextResponse.json({ ok: false, error: "unsupported_provider" }, { status: 400 });
    }

    const fs = getAdminFirestore();

    const globalUserId = await findUserByIdentity(providerRaw, providerId);
    if (!globalUserId) {
      const bundle = await loadGuestMiniAppSystemBundle(fs);
      return NextResponse.json({
        ok: true,
        recognized: false,
        status: "WELCOME",
        globalUserFirestoreId: null,
        staffProfile: false,
        activeSession: null,
        tableOrders: [],
        venueDoc: null,
        venueMenuShowcase: null,
        assignedStaffDisplayName: null,
        visitHistory: [],
        ...bundle,
      });
    }

    const snap = await fs.collection("global_users").doc(globalUserId).get();
    if (!snap.exists) {
      const bundle = await loadGuestMiniAppSystemBundle(fs);
      return NextResponse.json({
        ok: true,
        recognized: false,
        status: "WELCOME",
        globalUserFirestoreId: null,
        staffProfile: false,
        activeSession: null,
        tableOrders: [],
        venueDoc: null,
        venueMenuShowcase: null,
        assignedStaffDisplayName: null,
        visitHistory: [],
        ...bundle,
      });
    }

    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const role = typeof data.systemRole === "string" ? data.systemRole.trim().toUpperCase() : "";
    if (role === "STAFF" || role === "ADMIN") {
      const bundle = await loadGuestMiniAppSystemBundle(fs);
      const visitHistory = await loadGuestMiniAppVisitHistory(fs, globalUserId);
      return NextResponse.json({
        ok: true,
        recognized: true,
        staffProfile: true,
        status: "WELCOME",
        globalUserFirestoreId: globalUserId,
        activeSession: null,
        tableOrders: [],
        venueDoc: null,
        venueMenuShowcase: null,
        assignedStaffDisplayName: null,
        visitHistory,
        ...bundle,
      });
    }

    const resolved = await resolveGuestCurrentStatusFromProfile({
      profileDocId: globalUserId,
      profileData: data,
    });
    if (!resolved) {
      const bundle = await loadGuestMiniAppSystemBundle(fs);
      return NextResponse.json({
        ok: true,
        recognized: false,
        status: "WELCOME",
        globalUserFirestoreId: null,
        staffProfile: false,
        activeSession: null,
        tableOrders: [],
        venueDoc: null,
        venueMenuShowcase: null,
        assignedStaffDisplayName: null,
        visitHistory: [],
        ...bundle,
      });
    }

    const command = await buildGuestMiniAppCommandPayload(fs, resolved);

    return NextResponse.json({
      ok: true,
      recognized: true,
      staffProfile: false,
      ...resolved,
      ...command,
    });
  } catch (e) {
    console.error("[api/guest/get-current-status]", e);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
