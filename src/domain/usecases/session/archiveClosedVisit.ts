import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { extractOrderBillInfo } from "@/lib/orders/order-bill-amount";

export type ArchivedVisitCloseSource = "guest_feedback_finalized" | "force_closed";

/**
 * Снимок визита после закрытия сессии: «биография» отдельно от activeSessions.
 * Idempotency: docId = sessionId — повторное закрытие не перезаписывает.
 */
export async function buildArchivedVisitPayload(
  fs: Firestore,
  sessionId: string,
  sessionData: Record<string, unknown>,
  closeSource: ArchivedVisitCloseSource
): Promise<Record<string, unknown>> {
  const venueId = String(sessionData.venueId ?? "").trim();
  const tableId = String(sessionData.tableId ?? "").trim();
  const tableNumber =
    typeof sessionData.tableNumber === "number" && Number.isFinite(sessionData.tableNumber)
      ? sessionData.tableNumber
      : 0;

  let ordersTotalRub = 0;
  if (venueId && tableId) {
    try {
      const ordersSnap = await fs
        .collection("orders")
        .where("venueId", "==", venueId)
        .where("tableId", "==", tableId)
        .where("status", "in", ["pending", "ready", "completed"])
        .get();
      for (const d of ordersSnap.docs) {
        const info = extractOrderBillInfo((d.data() ?? {}) as Record<string, unknown>);
        ordersTotalRub += info.amount;
      }
    } catch {
      ordersTotalRub = 0;
    }
  }
  ordersTotalRub = Math.round(ordersTotalRub);

  const guestReviews: { reviewId: string; stars: number; text?: string }[] = [];
  if (venueId && sessionId) {
    try {
      const revSnap = await fs
        .collection("reviews")
        .where("venueId", "==", venueId)
        .where("sessionId", "==", sessionId)
        .limit(25)
        .get();
      for (const d of revSnap.docs) {
        const r = (d.data() ?? {}) as Record<string, unknown>;
        const stars = typeof r.stars === "number" && Number.isFinite(r.stars) ? r.stars : 0;
        const text = typeof r.text === "string" ? r.text.trim() : undefined;
        guestReviews.push({ reviewId: d.id, stars, ...(text ? { text } : {}) });
      }
    } catch {
      // индекс reviews может быть не создан — архив всё равно сохраняем
    }
  }

  const participantUidsRaw = sessionData.participantUids;
  const participantUids = Array.isArray(participantUidsRaw)
    ? participantUidsRaw.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];

  const masterId = typeof sessionData.masterId === "string" ? sessionData.masterId.trim() : "";
  const assignedStaffId =
    typeof sessionData.assignedStaffId === "string"
      ? sessionData.assignedStaffId.trim()
      : typeof sessionData.waiterId === "string"
        ? sessionData.waiterId.trim()
        : "";

  const sessionStatus = typeof sessionData.status === "string" ? sessionData.status.trim() : "";

  return {
    sessionId,
    venueId,
    tableId,
    tableNumber,
    masterId: masterId || null,
    participantUids,
    assignedStaffId: assignedStaffId || null,
    sessionStatusAtArchive: sessionStatus,
    createdAt: sessionData.createdAt ?? null,
    closedAt: FieldValue.serverTimestamp(),
    archivedAt: FieldValue.serverTimestamp(),
    closeSource,
    ordersTotalRub,
    guestReviews,
    staffRatedGuestAt: sessionData.ratedAt ?? null,
  };
}
