import { NextRequest, NextResponse } from "next/server";
import type { MessengerIdentity } from "@/lib/types";
import { checkInGuest } from "@/domain/usecases/check-in/checkInGuest";
import { restoreGuestSessionByGlobalUid } from "@/domain/usecases/check-in/restoreGuestSessionByGlobalUid";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { normalizeTableId, tableIdVariants } from "@/lib/table-id-normalization";
import { pickNewestFreshActiveSessionDoc } from "@/lib/session-freshness";
import { HEYWAITER_GUEST_COOKIE } from "@/lib/identity/guest-cookie";

const ACTIVE_SESSION_STATUS_FILTER = ["check_in_success", "payment_confirmed"] as const;

async function resolveCanonicalTableId(venueId: string, tableId: string): Promise<string> {
  const fs = getAdminFirestore();
  const v = venueId.trim();
  const variants = tableIdVariants(tableId);
  if (!v || variants.length === 0) return normalizeTableId(tableId);

  try {
    const activeSnap = await fs
      .collection("activeSessions")
      .where("venueId", "==", v)
      .where("tableId", "in", variants.slice(0, 10))
      .where("status", "in", [...ACTIVE_SESSION_STATUS_FILTER])
      .limit(25)
      .get();
    const picked = pickNewestFreshActiveSessionDoc(activeSnap.docs);
    if (picked) {
      const d = picked.data() as Record<string, unknown>;
      const canonical = typeof d.tableId === "string" ? d.tableId.trim() : "";
      if (canonical) return canonical;
    }
  } catch {
    // best-effort canonicalization
  }

  for (const candidate of variants) {
    try {
      const tableSnap = await fs.doc(`venues/${v}/tables/${candidate}`).get();
      if (tableSnap.exists) return candidate;
    } catch {
      // ignore and continue
    }
  }

  return normalizeTableId(tableId);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      venueId: rawVenue,
      tableId: rawTable,
      tableNumber,
      guestId,
      participantUid,
      guestIdentity: rawGuest,
      deviceAnchor,
      globalGuestUid: rawGlobalGuestUid,
      locale: rawLocale,
      timezone: rawTimezone,
    } = body as {
      venueId?: string;
      tableId?: string;
      tableNumber?: number;
      guestId?: string;
      participantUid?: string;
      guestIdentity?: unknown;
      deviceAnchor?: string;
      /** Восстановление без QR: global UID (id global_users), только status check_in_success и возраст сессии по createdAt */
      globalGuestUid?: string;
      locale?: string;
      timezone?: string;
    };
    const guestIdentity: MessengerIdentity | undefined =
      rawGuest && typeof rawGuest === "object" && "channel" in rawGuest && "externalId" in rawGuest
        ? (rawGuest as MessengerIdentity)
        : undefined;

    const venueId = String(rawVenue ?? "").trim();
    const tableId = String(rawTable ?? "").trim();
    const globalGuestUidForRestore = String(rawGlobalGuestUid ?? "").trim();

    if (!venueId || !tableId) {
      if (!globalGuestUidForRestore) {
        return NextResponse.json(
          { error: "venueId and tableId required, or globalGuestUid for session restore" },
          { status: 400 }
        );
      }
      const restored = await restoreGuestSessionByGlobalUid(globalGuestUidForRestore);
      if (!restored.ok) {
        return NextResponse.json({
          ok: true,
          mode: "scanner",
          venueId: null,
          tableId: null,
          globalGuestUid: globalGuestUidForRestore,
          sessionId: null,
          sessionStatus: null,
          messageGuest: "Активная сессия не найдена. Отсканируйте QR стола.",
          onboardingHint: null,
          restoreFailed: true,
        });
      }
      return NextResponse.json({
        ok: true,
        mode: "table",
        venueId: restored.venueId,
        tableId: restored.tableId,
        globalGuestUid: globalGuestUidForRestore,
        sessionId: restored.sessionId,
        sessionStatus: "check_in_success",
        messageGuest: restored.messageGuest,
        onboardingHint: null,
        restored: true,
      });
    }

    const canonicalTableId = await resolveCanonicalTableId(venueId, tableId);

    const cookieGid = request.cookies.get(HEYWAITER_GUEST_COOKIE)?.value?.trim() ?? "";
    const knownGlobalForTable = globalGuestUidForRestore || cookieGid || "";

    const result = await checkInGuest({
      venueId,
      tableId: canonicalTableId,
      tableNumber,
      guestId,
      participantUid,
      guestIdentity,
      deviceAnchor: typeof deviceAnchor === "string" ? deviceAnchor : undefined,
      knownGlobalGuestUid: knownGlobalForTable || undefined,
      locale: typeof rawLocale === "string" ? rawLocale : undefined,
      timezone: typeof rawTimezone === "string" ? rawTimezone : undefined,
    });

    if (result.status === "check_in_success") {
      return NextResponse.json({
        ok: true,
        mode: "table",
        venueId: venueId.trim(),
        tableId: result.tableId,
        globalGuestUid: result.globalGuestUid,
        sessionId: result.sessionId,
        sessionStatus: result.status,
        messageGuest: result.messageGuest,
        onboardingHint: result.onboardingHint ?? null,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "scanner",
      venueId: venueId.trim(),
      tableId: result.tableId,
      globalGuestUid: result.globalGuestUid,
      sessionId: result.sessionId,
      sessionStatus: result.status,
      messageGuest: result.messageGuest,
    });
  } catch (err) {
    console.error("check-in API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
