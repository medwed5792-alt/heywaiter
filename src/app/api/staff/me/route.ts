export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { toIdentityKey } from "@/lib/auth/unifiedSearch";
import { resolveVenueId } from "@/lib/standards/venue-default";
import { generateSotaId } from "@/lib/sota-id";

/**
 * GET /api/staff/me?venueId=...&telegramId=...
 * Возвращает запись сотрудника для Mini App: userId, staffId, onShift.
 * Универсальный поиск:
 * 1) global_users по identities.<channelKey> (tg/wa/vk/viber/inst/wechat/fb/line)
 * 2) Fallback: если по соц-ID нет — ищем global_users по identities.phone и привязываем текущий соц-ID в identities
 * 3) staff на venue по userId
 * Если staff документа нет — не создаём новые записи (чтобы не плодить клонов).
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
    const sotaIdParam = searchParams.get("sotaId")?.trim() || "";

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
      if (!foundGlobalUserId) {
        const bySotaStaff = await firestore
          .collection("staff")
          .where("venueId", "==", venueId)
          .where("sotaId", "==", sotaIdParam)
          .limit(1)
          .get();
        if (!bySotaStaff.empty) {
          const sd = bySotaStaff.docs[0].data() ?? {};
          const uid = typeof sd.userId === "string" ? sd.userId.trim() : "";
          if (uid) {
            foundGlobalUserId = uid;
            const PLATFORM_STAFF_FIELD: Partial<Record<string, string>> = {
              tg: "tgId",
              wa: "waId",
              vk: "vkId",
              viber: "viberId",
              wechat: "wechatId",
              inst: "instagramId",
              fb: "facebookId",
              line: "lineId",
            };
            const sf = PLATFORM_STAFF_FIELD[key];
            const ext =
              sf && typeof sd[sf] === "string"
                ? (sd[sf] as string).trim()
                : typeof sd.tgId === "string"
                  ? sd.tgId.trim()
                  : "";
            if (!platformId && ext) platformId = ext;
          }
        }
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
    const globalSotaId =
      typeof globalData.sotaId === "string" && globalData.sotaId.trim() ? globalData.sotaId.trim() : null;

    // 2) Venue Access: проверяем наличие привязки к venue_andrey_alt в профиле (affiliations)
    const affiliations = Array.isArray(globalData.affiliations) ? globalData.affiliations : [];
    const hasVenueByAffiliation = affiliations.some(
      (a: { venueId?: string; status?: string }) =>
        a?.venueId === venueId && a?.status !== "former"
    );

    // Дополнительно (совместимость): иногда может существовать документ venues/.../staff/{socialId}
    const venueStaffBySocialSnap =
      platformId != null && platformId !== ""
        ? await firestore
            .collection("venues")
            .doc(venueId)
            .collection("staff")
            .doc(platformId)
            .get()
        : null;

    if (!hasVenueByAffiliation && !(venueStaffBySocialSnap?.exists === true)) {
      return NextResponse.json(
        { error: "Сотрудник не найден для этого заведения" },
        { status: 404 }
      );
    }

    // 3) Локальная запись сотрудника (root staff doc для этого venue)
    // Ищем staff в корневой коллекции по venueId + userId (global user id),
    // т.к. именно этот staffId дальше используется для onShift в venues/.../staff/{staffId}.
    let staffSnap = await firestore
      .collection("staff")
      .where("venueId", "==", venueId)
      .where("userId", "==", foundGlobalUserId)
      .limit(1)
      .get();

    // Фолбэк на совместимость по внешнему ID в staff документе (tgId/waId/vkId/...)
    if (staffSnap.empty && platformId) {
      const PLATFORM_STAFF_FIELD: Partial<Record<typeof key, string>> = {
        tg: "tgId",
        wa: "waId",
        vk: "vkId",
        viber: "viberId",
        wechat: "wechatId",
        inst: "instagramId",
        fb: "facebookId",
        line: "lineId",
      };

      const field = PLATFORM_STAFF_FIELD[key];
      if (field) {
        staffSnap = await firestore
          .collection("staff")
          .where("venueId", "==", venueId)
          .where(field, "==", platformId)
          .limit(1)
          .get();
      }

      // Ещё один совместимый вариант: external identities внутри staff
      if (staffSnap.empty) {
        staffSnap = await firestore
          .collection("staff")
          .where("venueId", "==", venueId)
          .where(`identities.${key}`, "==", platformId)
          .limit(1)
          .get();
      }
    }

    if (staffSnap.empty) {
      return NextResponse.json(
        { error: "Сотрудник не найден для этого заведения" },
        { status: 404 }
      );
    }

    const staffDoc = staffSnap.docs[0];
    const staffDocId = staffDoc.id;
    const staffData = staffDoc.data() ?? {};
    const userId = (staffData.userId as string | undefined) ?? foundGlobalUserId;

    const staffSotaId =
      typeof staffData.sotaId === "string" && staffData.sotaId.trim() ? staffData.sotaId.trim() : null;

    let responseSotaId = globalSotaId ?? staffSotaId;

    // Soft backfill: если у активного сотрудника отсутствует SOTA-ID — создаём на лету.
    if (!globalSotaId || !staffSotaId) {
      const shouldGenerate =
        !globalSotaId && !staffSotaId && (hasVenueByAffiliation || venueStaffBySocialSnap?.exists === true);
      const targetSotaId = globalSotaId ?? staffSotaId ?? (shouldGenerate ? generateSotaId("S", "W") : null);

      if (targetSotaId) {
        try {
          if (!globalSotaId) {
            await globalUserRef.set(
              { sotaId: targetSotaId, updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
          }
          if (!staffSotaId) {
            await staffDoc.ref.set(
              { sotaId: targetSotaId, updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
          }
          responseSotaId = targetSotaId;
        } catch (e) {
          // Не ломаем вход при проблемах бэкофила.
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
