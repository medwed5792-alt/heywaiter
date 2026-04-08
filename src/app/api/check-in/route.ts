import { NextRequest, NextResponse } from "next/server";
import type { MessengerIdentity } from "@/lib/types";
import { checkInGuest } from "@/domain/usecases/check-in/checkInGuest";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { normalizeTableId, tableIdVariants } from "@/lib/table-id-normalization";

const ACTIVE_SESSION_STATUS_FILTER = [
  "check_in_success",
  "payment_confirmed",
  "awaiting_guest_feedback",
  "completed",
] as const;

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
      .limit(1)
      .get();
    if (!activeSnap.empty) {
      const d = activeSnap.docs[0]!.data() as Record<string, unknown>;
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
    const { venueId, tableId, tableNumber, guestId, participantUid, guestIdentity: rawGuest, deviceAnchor } = body as {
      venueId?: string;
      tableId?: string;
      tableNumber?: number;
      guestId?: string;
      participantUid?: string;
      guestIdentity?: unknown;
      deviceAnchor?: string;
    };
    const guestIdentity: MessengerIdentity | undefined =
      rawGuest && typeof rawGuest === "object" && "channel" in rawGuest && "externalId" in rawGuest
        ? (rawGuest as MessengerIdentity)
        : undefined;

    if (!venueId || !tableId) {
      return NextResponse.json(
        { error: "venueId and tableId required" },
        { status: 400 }
      );
    }

    const canonicalTableId = await resolveCanonicalTableId(venueId, tableId);

    const result = await checkInGuest({
      venueId,
      tableId: canonicalTableId,
      tableNumber,
      guestId,
      participantUid,
      guestIdentity,
      deviceAnchor: typeof deviceAnchor === "string" ? deviceAnchor : undefined,
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
