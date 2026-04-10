export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { toIdentityKey } from "@/lib/auth/unifiedSearch";
import { resolveVenueId } from "@/lib/standards/venue-default";
import { generateSotaId } from "@/lib/sota-id";
import { isActiveSessionWithinMaxAge } from "@/lib/session-freshness";

function normalizeIncomingSotaId(raw: string | null): string | null {
  const normalized = (raw ?? "").trim().toUpperCase();
  if (!normalized) return null;
  // Поддерживаем текущие семейства: 8-char canonical и префиксные VR/SW/GP/GN.
  if (/^[VGSA][A-Z0-9]{7}$/.test(normalized)) return normalized;
  if (/^(VR|SW|GP|GN)[A-Z0-9]{2,}$/.test(normalized)) return normalized;
  return null;
}

/**
 * Staff-lock только пока гость реально «за столом» (check_in_success) и сессия не старше SESSION_MAX_AGE_MS.
 * payment_confirmed / awaiting_guest_feedback / completed не блокируют персонал.
 */
const STAFF_LOCK_GUEST_SESSION_STATUS = "check_in_success" as const;

/**
 * GET /api/staff/me?venueId=...&telegramId=...
 * Возвращает запись сотрудника для Mini App: userId, staffId, onShift.
 * Универсальный поиск:
 * 1) global_users по identities.<channelKey> (tg/wa/vk/viber/inst/wechat/fb/line)
 * 2) Fallback: если по соц-ID нет — ищем global_users по identities.phone и привязываем текущий соц-ID в identities
 * 3) Доступ к venue по affiliations в global_users; staffId = `${venueId}_${userId}`; onShift из venues/.../staff.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const venueId = resolveVenueId(searchParams.get("venueId"));
    const channelParam = searchParams.get("channel")?.trim() || searchParams.get("platform")?.trim() || "tg";
    const key = toIdentityKey(channelParam);
    if (!key) {
      return NextResponse.json({ error: "Неподдерживаемая платформа" }, { status: 400 });
    }

    const telegramId = searchParams.get("telegramId")?.trim();
    const platformIdParam = searchParams.get("platformId")?.trim();
    const rawSotaIdParam = searchParams.get("sotaId");
    const sotaIdParam = normalizeIncomingSotaId(rawSotaIdParam);
    if (rawSotaIdParam && !sotaIdParam) {
      return NextResponse.json({ error: "Некорректный sotaId" }, { status: 400 });
    }

    const PLATFORM_ID_PARAM_BY_KEY: Record<string, string> = {
      tg: "tgId",
      wa: "waId",
      vk: "vkId",
      viber: "viberId",
      wechat: "wechatId",
      // В унифицированных identities ключ "inst" хранит Instagram ID
      inst: "instagramId",
      fb: "facebookId",
      line: "lineId",
    };

    let platformId =
      platformIdParam ||
      (key === "tg" ? telegramId : undefined) ||
      (PLATFORM_ID_PARAM_BY_KEY[key] ? searchParams.get(PLATFORM_ID_PARAM_BY_KEY[key])?.trim() : undefined);

    const phoneRaw = searchParams.get("phone")?.trim() || "";
    const phoneClean = phoneRaw.replace(/\D/g, "");

    // Миграция: старый клиент мог передавать только telegramId.
    // Якорь SOTA-ID: когда Telegram ещё не отдал initData / platformId, но в localStorage есть последний sotaId.
    if (!platformId && !sotaIdParam) {
      return NextResponse.json(
        { error: "platformId обязателен" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();

    // 1) Global Profile: ищем global_user по конкретному identities.<key> только для текущего канала
    let foundGlobalUserId: string | null = null;

    if (sotaIdParam) {
      const bySotaGlobal = await firestore
        .collection("global_users")
        .where("sotaId", "==", sotaIdParam)
        .limit(1)
        .get();
      if (!bySotaGlobal.empty) {
        foundGlobalUserId = bySotaGlobal.docs[0].id;
        const gd = bySotaGlobal.docs[0].data() ?? {};
        const identities = (gd.identities ?? {}) as Record<string, unknown>;
        const idFromIdent =
          typeof identities[key] === "string"
            ? (identities[key] as string).trim()
            : key === "tg" && typeof identities.tg === "string"
              ? (identities.tg as string).trim()
              : "";
        if (!platformId && idFromIdent) platformId = idFromIdent;
      }
    }

    if (!foundGlobalUserId && platformId) {
      const bySocialSnap = await firestore
        .collection("global_users")
        .where(`identities.${key}`, "==", platformId)
        .limit(1)
        .get();

      if (!bySocialSnap.empty) {
        foundGlobalUserId = bySocialSnap.docs[0].id;
      } else if (phoneClean) {
        // 2) Fallback по телефону: ищем global_users по identities.phone и привязываем текущий соц-ID
        const byPhoneSnap = await firestore
          .collection("global_users")
          .where("identities.phone", "==", phoneClean)
          .limit(1)
          .get();

        if (!byPhoneSnap.empty) {
          foundGlobalUserId = byPhoneSnap.docs[0].id;
          const globalRef = firestore.collection("global_users").doc(foundGlobalUserId);
          const current = byPhoneSnap.docs[0].data() ?? {};
          const currentIdentities = (current.identities ?? {}) as Record<string, unknown>;
          await globalRef.update({
            identities: { ...currentIdentities, [key]: platformId },
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }

    if (!foundGlobalUserId) {
      // Survival Mode: ID соцсети не привязан, phone не помог — фронт должен показать форму привязки.
      return NextResponse.json({ error: "ID_NOT_BOUND" }, { status: 404 });
    }

    const globalUserRef = firestore.collection("global_users").doc(foundGlobalUserId);
    const globalUserSnap = await globalUserRef.get();
    const globalData = globalUserSnap.data() ?? {};
    const systemRoleRaw =
      typeof globalData.systemRole === "string" ? String(globalData.systemRole).trim().toUpperCase() : "";
    const globalSotaId =
      typeof globalData.sotaId === "string" && globalData.sotaId.trim() ? globalData.sotaId.trim() : null;

    const nowMs = Date.now();
    const [masterGuestSnap, participantGuestSnap] = await Promise.all([
      firestore
        .collection("activeSessions")
        .where("masterId", "==", foundGlobalUserId)
        .where("status", "==", STAFF_LOCK_GUEST_SESSION_STATUS)
        .limit(25)
        .get(),
      firestore
        .collection("activeSessions")
        .where("participantUids", "array-contains", foundGlobalUserId)
        .where("status", "==", STAFF_LOCK_GUEST_SESSION_STATUS)
        .limit(25)
        .get(),
    ]);
    const locksMaster = masterGuestSnap.docs.some((d) =>
      isActiveSessionWithinMaxAge(d.data() as Record<string, unknown>, nowMs)
    );
    const locksParticipant = participantGuestSnap.docs.some((d) =>
      isActiveSessionWithinMaxAge(d.data() as Record<string, unknown>, nowMs)
    );
    if (locksMaster || locksParticipant) {
      return NextResponse.json(
        { error: "ACTIVE_GUEST_SESSION_LOCK" },
        { status: 423 }
      );
    }

    if (systemRoleRaw !== "STAFF" && systemRoleRaw !== "ADMIN") {
      await globalUserRef.set(
        { systemRole: "STAFF", updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    // 2) Venue Access: проверяем наличие привязки к venue_andrey_alt в профиле (affiliations)
    const affiliations = Array.isArray(globalData.affiliations) ? globalData.affiliations : [];
    const hasVenueByAffiliation = affiliations.some(
      (a: { venueId?: string; status?: string }) =>
        a?.venueId === venueId && a?.status !== "former"
    );

    if (!hasVenueByAffiliation) {
      return NextResponse.json(
        { error: "Сотрудник не найден для этого заведения" },
        { status: 404 }
      );
    }

    // staffId для UI/столов: канон `${venueId}_${globalUserId}`; совпадает с venues/{v}/staff/{staffDocId}.
    const staffDocId = `${venueId}_${foundGlobalUserId}`;
    const userId = foundGlobalUserId;

    const staffSotaId = globalSotaId;

    let responseSotaId = globalSotaId ?? staffSotaId;

    // Soft backfill SOTA только в global_users.
    if (!globalSotaId) {
      const shouldGenerate = hasVenueByAffiliation;
      const targetSotaId = globalSotaId ?? (shouldGenerate ? generateSotaId("S", "W") : null);

      if (targetSotaId) {
        try {
          await globalUserRef.set(
            { sotaId: targetSotaId, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
          responseSotaId = targetSotaId;
        } catch (e) {
          console.warn("[staff/me] SOTA backfill failed:", e);
        }
      }
    }

    // 4) onShift читается ТОЛЬКО из venues/venue_andrey_alt/staff/[staffDocId]
    const resolvedVenueId = venueId;
    let onShift = false;
    let shiftStartTime: string | null = null;
    let shiftEndTime: string | null = null;

    const venueStaffSnap = await firestore
      .collection("venues")
      .doc(resolvedVenueId)
      .collection("staff")
      .doc(staffDocId)
      .get();

    if (venueStaffSnap.exists) {
      const vd = venueStaffSnap.data() ?? {};
      onShift = vd.onShift === true;
      shiftStartTime = (vd.shiftStartTime as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? null;
      shiftEndTime = (vd.shiftEndTime as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? null;
    }

    return NextResponse.json({
      userId,
      staffId: staffDocId,
      venueId: resolvedVenueId,
      onShift,
      shiftStartTime,
      shiftEndTime,
      sotaId: responseSotaId,
    });
  } catch (err) {
    console.error("[staff/me]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
