export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getCurrentSessionState } from "@/domain/usecases/session/masterSplitBill";
import { getWaiterIdFromTablePayload } from "@/lib/standards/table-waiter";
import { resolveTableNumberFromDoc } from "@/lib/venue-display";
import { resolveGuestDisplayName } from "@/lib/identity/guest-display";
import type { ActiveSessionParticipant } from "@/lib/types";

type BillItemInfo = { label: string; amount: number };

function parseNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function extractOrderBillInfo(data: Record<string, unknown>): { amount: number; items: BillItemInfo[] } {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: BillItemInfo[] = [];
  for (const i of rawItems) {
    const x = (i ?? {}) as Record<string, unknown>;
    const label =
      String(x.name ?? x.title ?? x.dishName ?? x.itemName ?? "").trim() || "Позиция";
    const qty = Math.max(parseNumber(x.qty ?? x.quantity), 1);
    const unit = parseNumber(x.price ?? x.unitPrice);
    const row = parseNumber(x.amount ?? x.total);
    const amount = row > 0 ? row : unit > 0 ? unit * qty : 0;
    items.push({ label: qty > 1 ? `${label} x${qty}` : label, amount });
  }

  if (items.length === 0) {
    const single = parseNumber(data.amount) || parseNumber(data.total) || parseNumber(data.sum) || parseNumber(data.price);
    if (single > 0) items.push({ label: `Заказ`, amount: single });
  }

  const amount = items.reduce((acc, i) => acc + i.amount, 0);
  return { amount, items };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const venueId = String(body.venueId ?? "").trim();
    const tableId = String(body.tableId ?? "").trim();
    const uid = String(body.uid ?? body.customerUid ?? "").trim();
    const type = body.type as "full" | "split";

    if (!venueId || !tableId || !uid || (type !== "full" && type !== "split")) {
      return NextResponse.json({ ok: false, error: "venueId, tableId, uid и type required" }, { status: 400 });
    }

    const sessionState = await getCurrentSessionState(venueId, tableId);
    if (!sessionState) {
      return NextResponse.json({ ok: false, error: "Session not found" }, { status: 404 });
    }

    if (type === "full") {
      if (sessionState.masterId !== uid) {
        return NextResponse.json({ ok: false, error: "Only master can request full bill" }, { status: 403 });
      }
    } else {
      const isParticipant = sessionState.participants.some((p: ActiveSessionParticipant) => p.uid === uid);
      if (!isParticipant) {
        return NextResponse.json({ ok: false, error: "Participant not found" }, { status: 403 });
      }
    }

    const firestore = getAdminFirestore();
    const tableSnap = await firestore.collection("venues").doc(venueId).collection("tables").doc(tableId).get();
    const tableData = (tableSnap.data() ?? {}) as Record<string, unknown>;

    const tableNumberResolved = resolveTableNumberFromDoc(tableData);
    const waiterId = getWaiterIdFromTablePayload(tableData);
    const targetUids = waiterId ? [waiterId] : [];

    // Fetch orders and compute bill items.
    const baseOrdersQuery = firestore
      .collection("orders")
      .where("venueId", "==", venueId)
      .where("tableId", "==", tableId)
      .where("status", "in", ["pending", "ready"]);

    let billItems: BillItemInfo[] = [];
    let amount = 0;

    if (type === "split") {
      const ordersSnap = uid
        ? await baseOrdersQuery.where("customerUid", "==", uid).get()
        : await baseOrdersQuery.get();
      for (const d of ordersSnap.docs) {
        const info = extractOrderBillInfo((d.data() ?? {}) as Record<string, unknown>);
        billItems.push(...info.items);
      }
      amount = billItems.reduce((acc, i) => acc + i.amount, 0);
    } else {
      const ordersSnap = await baseOrdersQuery.get();
      for (const d of ordersSnap.docs) {
        const info = extractOrderBillInfo((d.data() ?? {}) as Record<string, unknown>);
        billItems.push(...info.items);
      }
      amount = billItems.reduce((acc, i) => acc + i.amount, 0);
    }

    const roundedAmount = Math.round(amount);

    const displayName = resolveGuestDisplayName({
      uid,
      currentUid: uid,
      currentUserName: null,
    });

    // For "full" requests the original UI treats guestName as masterName.
    const masterName =
      sessionState.masterId && sessionState.masterId.trim()
        ? resolveGuestDisplayName({
            uid: sessionState.masterId,
            currentUid: uid,
            currentUserName: null,
          })
        : displayName;

    const billItemsStrings = billItems.map((i) => `${i.label}${i.amount > 0 ? ` — ${Math.round(i.amount)} руб.` : ""}`);

    const notificationType = type === "split" ? "split_bill_request" : "full_bill_request";
    const title = type === "split" ? "💰 Запрос раздельного счета" : "👑 Закрытие всего стола";

    const requesterUid = uid;
    const guestName = type === "split" ? displayName : masterName;

    const message =
      type === "split"
        ? `Стол №${tableNumberResolved ?? tableId}: ${guestName} хочет оплатить свою часть (${roundedAmount} руб.).`
        : `👑 Мастер стола ${guestName} закрывает весь стол №${tableNumberResolved ?? tableId}. Сумма: ${roundedAmount} руб.`;

    await firestore.collection("staffNotifications").add({
      type: notificationType,
      title,
      message,
      venueId,
      tableId,
      tableNumber: tableNumberResolved ?? null,
      sessionId: sessionState.sessionId,
      requesterUid,
      guestName,
      amount: roundedAmount,
      items: billItemsStrings,
      status: "pending",
      read: false,
      targetUids,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

