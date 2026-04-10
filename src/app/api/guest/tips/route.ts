export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { resolveWaiterStaffIdFromSessionDoc } from "@/lib/active-session-waiter";
import { guestCustomerUidsMatch } from "@/lib/identity/customer-uid";
import { resolveStaffFirestoreIdToGlobalUser } from "@/lib/identity/global-user-staff-bridge";

type Body = {
  venueId?: string;
  customerUid?: string;
  amount?: unknown;
  staffId?: string | null;
  /** Чаевые с привязкой к activeSessions без корзины предзаказа */
  sessionTip?: boolean;
  activeSessionId?: string;
};

function sessionAllowsFeedbackTip(statusRaw: string): boolean {
  const s = statusRaw.trim();
  const u = s.toUpperCase();
  return (
    s === "awaiting_guest_feedback" ||
    u === "AWAITING_FEEDBACK" ||
    s === "completed" ||
    u === "COMPLETED"
  );
}

async function verifySessionTipContext(args: {
  firestore: Firestore;
  sessionId: string;
  venueId: string;
  customerUid: string;
  staffId: string;
}): Promise<boolean> {
  const snap = await args.firestore.collection("activeSessions").doc(args.sessionId).get();
  if (!snap.exists) return false;
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  if (String(data.venueId ?? "").trim() !== args.venueId) return false;
  const st = String(data.status ?? "");
  if (!sessionAllowsFeedbackTip(st)) return false;
  const resolved = resolveWaiterStaffIdFromSessionDoc(data);
  if (!resolved || resolved !== args.staffId) return false;
  const masterId = typeof data.masterId === "string" ? data.masterId.trim() : "";
  if (guestCustomerUidsMatch(masterId, args.customerUid)) return true;
  for (const p of Array.isArray(data.participants) ? data.participants : []) {
    const uid = typeof (p as { uid?: string })?.uid === "string" ? (p as { uid: string }).uid.trim() : "";
    if (uid && guestCustomerUidsMatch(uid, args.customerUid)) return true;
  }
  return false;
}

function parseAmount(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(1, Math.floor(raw));
  if (typeof raw === "string") {
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n)) return Math.max(1, Math.floor(n));
  }
  return 100;
}

/**
 * POST /api/guest/tips
 * Сохраняет транзакцию чаевых в виртуальный кошелек сотрудника (staff_wallets/{unified_id}).
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
    const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    const idToken = m?.[1]?.trim();
    if (!idToken) {
      return NextResponse.json({ error: "Требуется Authorization: Bearer <idToken>" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as Body;
    const venueId = body.venueId?.trim() ?? "";
    const customerUid = body.customerUid?.trim() ?? "";
    const staffIdFromBody = body.staffId?.trim() ?? "";
    const sessionTip = body.sessionTip === true;
    const activeSessionId = body.activeSessionId?.trim() ?? "";
    const amount = parseAmount(body.amount);
    if (!venueId || !customerUid) {
      return NextResponse.json({ error: "venueId и customerUid обязательны" }, { status: 400 });
    }

    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;
    const firestore = getAdminFirestore();

    let candidateStaffId = staffIdFromBody;

    if (sessionTip && activeSessionId) {
      if (!staffIdFromBody) {
        return NextResponse.json({ error: "staffId обязателен для чаевых по сессии" }, { status: 400 });
      }
      const ok = await verifySessionTipContext({
        firestore,
        sessionId: activeSessionId,
        venueId,
        customerUid,
        staffId: staffIdFromBody,
      });
      if (!ok) {
        return NextResponse.json({ error: "Сессия не найдена или чаевые недоступны" }, { status: 403 });
      }
    } else {
      const cartRef = firestore.collection("venues").doc(venueId).collection("preorder_carts").doc(customerUid);
      const cartSnap = await cartRef.get();
      if (!cartSnap.exists) {
        return NextResponse.json({ error: "Корзина не найдена" }, { status: 404 });
      }
      const cart = (cartSnap.data() ?? {}) as Record<string, unknown>;
      if (cart.authUid !== uid) {
        return NextResponse.json({ error: "Нет доступа к этой корзине" }, { status: 403 });
      }

      candidateStaffId =
        staffIdFromBody ||
        (typeof cart.completedByStaffId === "string" ? cart.completedByStaffId.trim() : "") ||
        (typeof cart.receivedByStaffId === "string" ? cart.receivedByStaffId.trim() : "") ||
        (typeof cart.confirmedByStaffId === "string" ? cart.confirmedByStaffId.trim() : "");

      if (!candidateStaffId) {
        return NextResponse.json({ error: "Не удалось определить сотрудника для чаевых" }, { status: 400 });
      }
    }

    const resolvedStaff = await resolveStaffFirestoreIdToGlobalUser(
      firestore,
      candidateStaffId,
      venueId
    );
    if (!resolvedStaff) {
      return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
    }
    const staffUnifiedId = resolvedStaff.globalUserId;
    const staffSotaId = resolvedStaff.sotaId;

    const walletRef = firestore.collection("staff_wallets").doc(staffUnifiedId);
    const txRef = walletRef.collection("transactions").doc();
    await firestore.runTransaction(async (trx) => {
      const walletSnap = await trx.get(walletRef);
      const prevBalance =
        walletSnap.exists && typeof walletSnap.data()?.balance === "number"
          ? Number(walletSnap.data()!.balance)
          : 0;
      const prevTotalTips =
        walletSnap.exists && typeof walletSnap.data()?.totalTips === "number"
          ? Number(walletSnap.data()!.totalTips)
          : 0;
      const prevTxCount =
        walletSnap.exists && typeof walletSnap.data()?.txCount === "number"
          ? Number(walletSnap.data()!.txCount)
          : 0;

      trx.set(
        walletRef,
        {
          staffUnifiedId,
          staffSotaId,
          staffId: candidateStaffId,
          venueId,
          balance: prevBalance + amount,
          totalTips: prevTotalTips + amount,
          txCount: prevTxCount + 1,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: walletSnap.exists ? walletSnap.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      trx.set(txRef, {
        type: "tip",
        amount,
        venueId,
        customerUid,
        staffUnifiedId,
        staffSotaId,
        staffId: candidateStaffId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[guest/tips]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
