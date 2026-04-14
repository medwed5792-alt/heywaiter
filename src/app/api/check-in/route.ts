import { NextRequest, NextResponse } from "next/server";
import type { MessengerIdentity } from "@/lib/types";
import { checkInGuest } from "@/domain/usecases/check-in/checkInGuest";
import { restoreGuestSessionByGlobalUid } from "@/domain/usecases/check-in/restoreGuestSessionByGlobalUid";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { normalizeTableId, tableIdVariants } from "@/lib/table-id-normalization";
import type { CheckInGuestResult } from "@/domain/usecases/check-in/checkInGuest";

const CHECK_IN_USECASE_TIMEOUT_MS = 25_000;
import { pickNewestFreshActiveSessionDoc } from "@/lib/session-freshness";

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
  console.log("[api/check-in] POST inbound", new Date().toISOString());
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch (parseErr) {
      console.error("[api/check-in] invalid JSON body:", parseErr);
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }
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
    } = body as unknown as {
      venueId?: string;
      tableId?: string;
      tableNumber?: number | string;
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

    const participantUidRaw = typeof participantUid === "string" ? participantUid.trim() : "";
    if (
      participantUidRaw &&
      /^(tg|anon|wa|vk|viber|wechat|inst|fb|line):/i.test(participantUidRaw)
    ) {
      return NextResponse.json(
        { error: "use_globalGuestUid_only_channel_prefixed_participantUid_forbidden" },
        { status: 400 }
      );
    }

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

    let canonicalTableId: string;
    try {
      canonicalTableId = await resolveCanonicalTableId(venueId, tableId);
    } catch (canonErr) {
      console.error("[api/check-in] resolveCanonicalTableId failed:", canonErr);
      canonicalTableId = normalizeTableId(tableId);
    }

    const knownGlobalForTable = globalGuestUidForRestore || "";

    let tableNumberParsed: number | undefined;
    if (typeof tableNumber === "number" && Number.isFinite(tableNumber)) {
      tableNumberParsed = tableNumber;
    } else if (typeof tableNumber === "string" && tableNumber.trim()) {
      const n = Number.parseInt(tableNumber.trim(), 10);
      if (Number.isFinite(n)) tableNumberParsed = n;
    }

    let result: CheckInGuestResult;
    try {
      result = await Promise.race([
        checkInGuest({
          venueId,
          tableId: canonicalTableId,
          tableNumber: tableNumberParsed,
          guestId: typeof guestId === "string" ? guestId : guestId != null ? String(guestId) : undefined,
          participantUid: participantUidRaw || undefined,
          guestIdentity,
          deviceAnchor: typeof deviceAnchor === "string" ? deviceAnchor : undefined,
          knownGlobalGuestUid: knownGlobalForTable || undefined,
          locale: typeof rawLocale === "string" ? rawLocale : undefined,
          timezone: typeof rawTimezone === "string" ? rawTimezone : undefined,
        }),
        new Promise<CheckInGuestResult>((_, reject) =>
          setTimeout(() => reject(new Error("check_in_usecase_timeout")), CHECK_IN_USECASE_TIMEOUT_MS)
        ),
      ]);
    } catch (raceErr) {
      console.error("[api/check-in] checkInGuest failed or timed out:", raceErr);
      return NextResponse.json(
        {
          ok: false,
          mode: "scanner",
          venueId: venueId.trim(),
          tableId: canonicalTableId,
          globalGuestUid: null,
          sessionId: null,
          sessionStatus: "check_in_timeout",
          messageGuest: "Сервер не успел завершить посадку. Повторите сканирование QR.",
          onboardingHint: null,
        },
        { status: 503 }
      );
    }

    if (result.status === "check_in_success") {
      return NextResponse.json({
        ok: true,
        mode: "table",
        venueId: venueId.trim(),
        tableId: String(result.tableId ?? "").trim(),
        globalGuestUid: result.globalGuestUid,
        sessionId: result.sessionId,
        sessionStatus: result.status,
        messageGuest: result.messageGuest,
        onboardingHint: result.onboardingHint ?? null,
      });
    }

    if (result.status === "already_seated_elsewhere") {
      return NextResponse.json({
        ok: true,
        mode: "table",
        venueId: String(result.venueId ?? "").trim(),
        tableId: String(result.tableId ?? "").trim(),
        tableNumber: result.tableNumber,
        globalGuestUid: result.globalGuestUid,
        sessionId: result.sessionId,
        sessionStatus: "guest_already_seated_elsewhere",
        messageGuest: result.messageGuest,
        onboardingHint: null,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "scanner",
      venueId: venueId.trim(),
      tableId: String(result.tableId ?? "").trim(),
      globalGuestUid: result.globalGuestUid,
      sessionId: result.sessionId,
      sessionStatus: result.status,
      messageGuest: result.messageGuest,
    });
  } catch (err) {
    console.error("check-in API error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", messageGuest: "Ошибка сервера при посадке. Повторите попытку." },
      { status: 500 }
    );
  }
}
