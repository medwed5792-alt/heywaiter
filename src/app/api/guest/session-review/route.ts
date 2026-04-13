export const dynamic = "force-dynamic";

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getEffectiveBotToken } from "@/lib/webhook/bots-store";
import { verifyTelegramWebAppInitData } from "@/lib/telegram-webapp-init-data";
import { guestCustomerUidsMatch } from "@/lib/identity/customer-uid";
import { resolveWaiterStaffIdFromSessionDoc } from "@/lib/active-session-waiter";

async function verifyGuestSessionReviewContext(
  firestore: Firestore,
  params: { sessionId: string; venueId: string; tableId: string; customerUid: string }
): Promise<{ ok: true; staffIds: string[] } | { ok: false }> {
  const snap = await firestore.collection("archived_visits").doc(params.sessionId).get();
  if (!snap.exists) return { ok: false };
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  if (data.guestFeedbackPending !== true) return { ok: false };
  if (String(data.venueId ?? "").trim() !== params.venueId) return { ok: false };
  if (String(data.tableId ?? "").trim() !== params.tableId) return { ok: false };

  const masterId = typeof data.masterId === "string" ? data.masterId.trim() : "";
  let participant = false;
  if (guestCustomerUidsMatch(masterId, params.customerUid)) participant = true;
  const participantUids = Array.isArray(data.participantUids)
    ? data.participantUids.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  if (!participant) {
    for (const uid of participantUids) {
      if (guestCustomerUidsMatch(uid, params.customerUid)) {
        participant = true;
        break;
      }
    }
  }
  if (!participant) {
    for (const p of Array.isArray(data.participants) ? data.participants : []) {
      const uid = typeof (p as { uid?: string })?.uid === "string" ? (p as { uid: string }).uid.trim() : "";
      if (uid && guestCustomerUidsMatch(uid, params.customerUid)) {
        participant = true;
        break;
      }
    }
  }
  if (!participant) return { ok: false };

  const w = resolveWaiterStaffIdFromSessionDoc(data);
  return { ok: true, staffIds: w ? [w] : [] };
}

function guestSessionReviewDocId(sessionId: string, customerUid: string): string {
  const h = createHash("sha256").update(`${sessionId}\0${customerUid}`, "utf8").digest("hex").slice(0, 40);
  return `gsr_${h}`;
}

/**
 * POST /api/guest/session-review
 * Отзыв гостя (звёзды) в reviews с привязкой к sessionId — до finalize / архивации.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      initData?: string;
      venueId?: string;
      tableId?: string;
      sessionId?: string;
      customerUid?: string;
      stars?: unknown;
    };
    const initData = typeof body.initData === "string" ? body.initData.trim() : "";
    const venueId = typeof body.venueId === "string" ? body.venueId.trim() : "";
    const tableId = typeof body.tableId === "string" ? body.tableId.trim() : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const customerUid = typeof body.customerUid === "string" ? body.customerUid.trim() : "";
    const starsRaw = body.stars;
    const stars =
      typeof starsRaw === "number" && Number.isFinite(starsRaw)
        ? Math.max(0, Math.min(5, Math.floor(starsRaw)))
        : 0;

    if (!initData) {
      return NextResponse.json({ error: "initData required" }, { status: 400 });
    }
    if (!venueId || !tableId || !sessionId || !customerUid) {
      return NextResponse.json({ error: "venueId, tableId, sessionId, customerUid required" }, { status: 400 });
    }

    const token = await getEffectiveBotToken("telegram", "client");
    if (!token) {
      return NextResponse.json({ error: "guest_bot_token_unconfigured" }, { status: 503 });
    }
    const v = verifyTelegramWebAppInitData(initData, token);
    if (!v.ok) {
      return NextResponse.json({ error: v.reason }, { status: 401 });
    }

    const firestore = getAdminFirestore();
    const ctx = await verifyGuestSessionReviewContext(firestore, {
      sessionId,
      venueId,
      tableId,
      customerUid,
    });
    if (!ctx.ok) {
      return NextResponse.json({ error: "session_review_forbidden" }, { status: 403 });
    }

    const docId = guestSessionReviewDocId(sessionId, customerUid);
    const ref = firestore.collection("reviews").doc(docId);
    const prev = await ref.get();
    const createdAt = prev.exists ? (prev.data() as Record<string, unknown>)?.createdAt : FieldValue.serverTimestamp();

    await ref.set(
      {
        venueId,
        tableId,
        sessionId,
        stars,
        customerUid,
        staffIds: ctx.staffIds,
        source: "guest_mini_app",
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: createdAt ?? FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, reviewId: docId });
  } catch (e) {
    console.error("[api/guest/session-review]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server_error" },
      { status: 500 }
    );
  }
}
