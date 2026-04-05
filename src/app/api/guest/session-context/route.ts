import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getEffectiveBotToken } from "@/lib/webhook/bots-store";
import { guestCustomerUidsMatch } from "@/lib/identity/customer-uid";
import {
  GUEST_ACTIVE_SESSIONS_COLLECTION,
  GUEST_CONTEXT_MAX_AGE_MS,
  TELEGRAM_INIT_DATA_MAX_AGE_SEC,
  guestMessengerContextDocId,
  type GuestActiveSessionIndexDoc,
} from "@/lib/guest-active-sessions-index";
import { verifyTelegramWebAppInitData } from "@/lib/telegram-webapp-auth";

export const runtime = "nodejs";

function lastSeenToMillis(lastSeen: unknown): number {
  if (lastSeen == null) return 0;
  if (typeof lastSeen === "object" && lastSeen !== null && "toMillis" in lastSeen) {
    const fn = (lastSeen as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") {
      try {
        return fn.call(lastSeen);
      } catch {
        return 0;
      }
    }
  }
  if (lastSeen instanceof Date) return lastSeen.getTime();
  if (typeof lastSeen === "number" && Number.isFinite(lastSeen)) return lastSeen;
  return 0;
}

async function activeTableSessionHasParticipant(
  venueId: string,
  tableId: string,
  tgUserId: string
): Promise<boolean> {
  const firestore = getAdminFirestore();
  const uid = `tg:${tgUserId}`;
  const snap = await firestore
    .collection("activeSessions")
    .where("venueId", "==", venueId.trim())
    .where("tableId", "==", tableId.trim())
    .where("status", "==", "check_in_success")
    .limit(1)
    .get();
  if (snap.empty) return false;
  const d = (snap.docs[0]!.data() ?? {}) as Record<string, unknown>;
  const masterId = typeof d.masterId === "string" ? d.masterId.trim() : "";
  if (guestCustomerUidsMatch(masterId, uid)) return true;
  const raw = Array.isArray(d.participants) ? d.participants : [];
  for (const p of raw) {
    const x = (p ?? {}) as Record<string, unknown>;
    const u = typeof x.uid === "string" ? x.uid.trim() : "";
    if (u && guestCustomerUidsMatch(u, uid)) return true;
  }
  return false;
}

async function resolveVerifiedTelegramUser(initData: string) {
  const botToken = await getEffectiveBotToken("telegram", "client");
  if (!botToken) {
    return { error: NextResponse.json({ error: "guest_bot_token_unconfigured" }, { status: 503 }) };
  }
  const v = verifyTelegramWebAppInitData(initData, botToken, TELEGRAM_INIT_DATA_MAX_AGE_SEC);
  if (!v.ok) {
    return { error: NextResponse.json({ error: v.reason }, { status: 401 }) };
  }
  return { userId: v.userId };
}

/**
 * recover — вернуть контекст стола по tg id из подписанного initData (без доверия к initDataUnsafe).
 * bind — записать/обновить active_sessions после успешного разбора start_param.
 * clear — снять привязку (уход со стола / закрытие).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      initData?: string;
      venueId?: string;
      tableId?: string;
    };
    const action = String(body.action ?? "").trim().toLowerCase();
    const initData = typeof body.initData === "string" ? body.initData.trim() : "";

    if (!initData) {
      return NextResponse.json({ error: "initData required" }, { status: 400 });
    }

    const verified = await resolveVerifiedTelegramUser(initData);
    if ("error" in verified) return verified.error;
    const { userId } = verified;

    const docId = guestMessengerContextDocId("telegram", userId);
    const ref = getAdminFirestore().collection(GUEST_ACTIVE_SESSIONS_COLLECTION).doc(docId);

    if (action === "clear") {
      await ref.delete().catch(() => undefined);
      return NextResponse.json({ ok: true });
    }

    if (action === "bind") {
      const vrId = String(body.venueId ?? "").trim();
      const tableId = String(body.tableId ?? "").trim();
      if (!vrId || !tableId) {
        return NextResponse.json({ error: "venueId and tableId required" }, { status: 400 });
      }
      const stillThere = await activeTableSessionHasParticipant(vrId, tableId, userId);
      if (!stillThere) {
        return NextResponse.json({ error: "not_in_session" }, { status: 409 });
      }
      await ref.set(
        {
          vr_id: vrId,
          table_id: tableId,
          last_seen: FieldValue.serverTimestamp(),
          order_status: "active",
        },
        { merge: true }
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "recover") {
      const snap = await ref.get();
      if (!snap.exists) {
        return NextResponse.json({ active: false });
      }
      const data = snap.data() as GuestActiveSessionIndexDoc;
      const vrId = typeof data.vr_id === "string" ? data.vr_id.trim() : "";
      const tableId = typeof data.table_id === "string" ? data.table_id.trim() : "";
      if (!vrId || !tableId) {
        await ref.delete().catch(() => undefined);
        return NextResponse.json({ active: false });
      }
      const seenMs = lastSeenToMillis(data.last_seen);
      if (!seenMs || Date.now() - seenMs > GUEST_CONTEXT_MAX_AGE_MS) {
        await ref.delete().catch(() => undefined);
        return NextResponse.json({ active: false });
      }
      const live = await activeTableSessionHasParticipant(vrId, tableId, userId);
      if (!live) {
        await ref.delete().catch(() => undefined);
        return NextResponse.json({ active: false });
      }
      await ref.update({ last_seen: FieldValue.serverTimestamp() }).catch(() => undefined);
      return NextResponse.json({
        active: true,
        vrId,
        tableId,
        order_status: typeof data.order_status === "string" ? data.order_status : "active",
      });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (e) {
    console.error("[api/guest/session-context]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server_error" },
      { status: 500 }
    );
  }
}
