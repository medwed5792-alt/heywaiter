export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { toIdentityKey } from "@/lib/auth/unifiedSearch";
import { generateSotaId } from "@/lib/sota-id";

/**
 * GET /api/staff/profile?channel=...&platformId=...
 * Личный кабинет: данные global_user по identities.tg (только для владельца по telegramId).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const channelParam =
      searchParams.get("channel")?.trim() || searchParams.get("platform")?.trim() || "tg";
    const platformId =
      searchParams.get("platformId")?.trim() ||
      (toIdentityKey(channelParam) === "tg" ? searchParams.get("telegramId")?.trim() : undefined) ||
      "";

    const key = toIdentityKey(channelParam);
    if (!key) {
      return NextResponse.json({ error: "Неподдерживаемая платформа" }, { status: 400 });
    }
    if (!platformId) {
      return NextResponse.json({ error: "platformId обязателен" }, { status: 400 });
    }

    const firestore = getAdminFirestore();
    const snap = await firestore
      .collection("global_users")
      .where(`identities.${key}`, "==", platformId)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
    }

    const doc = snap.docs[0];
    const data = doc.data();
    const affiliations = Array.isArray(data.affiliations) ? data.affiliations : [];
    const isFreeAgent =
      affiliations.filter((a: { status?: string }) => a.status !== "former").length === 0;
    let sotaId =
      typeof data.sotaId === "string" && data.sotaId.trim() ? data.sotaId.trim() : null;

    // Soft backfill on read: если активный сотрудник ещё без sotaId — создаём на лету.
    if (!sotaId && !isFreeAgent) {
      const newSotaId = generateSotaId("S", "W");
      await doc.ref.set(
        { sotaId: newSotaId, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );

      // Синхронизируем в staff для всех активных affiliation (если такие документы существуют).
      for (const aff of affiliations) {
        const a = aff as { status?: string; venueId?: string };
        if (a.status === "former") continue;
        const venueId = typeof a.venueId === "string" ? a.venueId.trim() : "";
        if (!venueId) continue;
        const staffDocId = `${venueId}_${doc.id}`;
        const staffRef = firestore.collection("staff").doc(staffDocId);
        await staffRef.set(
          { sotaId: newSotaId, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }

      sotaId = newSotaId;
    }

    return NextResponse.json({
      userId: doc.id,
      sotaId,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      phone: data.phone ?? null,
      birthDate: data.birthDate ?? null,
      photoUrl: data.photoUrl ?? null,
      identities: data.identities ?? {},
      affiliations,
      isFreeAgent,
    });
  } catch (err) {
    console.error("[staff/profile GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/staff/profile
 * Обновление полей личного кабинета: firstName, lastName, phone, birthDate, photoUrl + identities.<platformKey>.
 * Body: { channel?, platformId?, telegramId?, firstName?, lastName?, phone?, birthDate?, photoUrl?, identities? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const channelParam =
      typeof body.channel === "string" && body.channel.trim()
        ? body.channel.trim()
        : "tg";

    const key = toIdentityKey(channelParam);
    if (!key) {
      return NextResponse.json({ error: "Неподдерживаемая платформа" }, { status: 400 });
    }

    const platformId =
      (typeof body.platformId === "string" ? body.platformId.trim() : "") ||
      (typeof body.telegramId === "string" && key === "tg" ? body.telegramId.trim() : "") ||
      "";

    if (!platformId) {
      return NextResponse.json({ error: "platformId обязателен" }, { status: 400 });
    }

    const firestore = getAdminFirestore();
    const snap = await firestore
      .collection("global_users")
      .where(`identities.${key}`, "==", platformId)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
    }

    const ref = snap.docs[0].ref;
    const current = snap.docs[0].data();
    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    const nextIdentities = { ...(current.identities as Record<string, string | null> | undefined) };
    let identitiesUpdated = false;

    if (body.firstName !== undefined) {
      updates.firstName =
        typeof body.firstName === "string" ? body.firstName.trim() || null : null;
    }
    if (body.lastName !== undefined) {
      updates.lastName =
        typeof body.lastName === "string" ? body.lastName.trim() || null : null;
    }

    if (body.phone !== undefined) {
      const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";
      updates.phone = phone || null;
      if (phone) nextIdentities.phone = phone;
      else delete nextIdentities.phone;
      identitiesUpdated = true;
    }
    if (body.birthDate !== undefined) {
      updates.birthDate = typeof body.birthDate === "string" ? body.birthDate.trim() || null : null;
    }
    if (body.photoUrl !== undefined) {
      updates.photoUrl = typeof body.photoUrl === "string" ? body.photoUrl.trim() || null : null;
    }

    if (body.identities && typeof body.identities === "object") {
      const inputIdentities = body.identities as Record<string, unknown>;

      for (const [k, v] of Object.entries(inputIdentities)) {
        // Обновляем только известные ключи identities (8 соцсетей + phone/email)
        if (
          k !== "tg" &&
          k !== "wa" &&
          k !== "vk" &&
          k !== "viber" &&
          k !== "wechat" &&
          k !== "inst" &&
          k !== "fb" &&
          k !== "line" &&
          k !== "phone" &&
          k !== "email"
        ) {
          continue;
        }

        if (v === undefined) continue;
        const nextVal = typeof v === "string" ? v.trim() : "";

        if (!nextVal) {
          delete nextIdentities[k];
        } else {
          nextIdentities[k] = nextVal;
        }
        identitiesUpdated = true;
      }
    }

    if (identitiesUpdated) {
      updates.identities = nextIdentities;
    }

    const userFieldKeys = Object.keys(updates).filter((k) => k !== "updatedAt");
    if (userFieldKeys.length === 0) {
      return NextResponse.json({ ok: true, message: "Нечего обновлять" });
    }

    await ref.update(updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[staff/profile PATCH]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
