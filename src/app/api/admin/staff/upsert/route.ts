export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

const VENUE_ID = "current";

/**
 * POST /api/admin/staff/upsert
 * Создание или обновление сотрудника. Данные синхронизируются с коллекцией global_staff
 * (Биржа труда — видна Супер-Админу в /super).
 * Тело: { staffId?: string, ...staffFields }. Если staffId нет — создаём нового.
 */
export async function POST(request: NextRequest) {
  try {
    const { collection, doc, getDoc, setDoc, updateDoc, serverTimestamp, addDoc } = await import("firebase/firestore");
    const { db } = await import("@/lib/firebase");

    const body = await request.json();
    const staffId = body.staffId as string | undefined;

    const assignedTableIds = Array.isArray(body.assignedTableIds) ? body.assignedTableIds : [];
    const payload: Record<string, unknown> = {
      venueId: VENUE_ID,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
      gender: body.gender ?? null,
      birthDate: body.birthDate ?? null,
      photoUrl: body.photoUrl ?? null,
      phone: body.phone ?? null,
      position: body.position ?? null,
      assignedTableIds,
      guestRating: body.guestRating ?? null,
      venueRating: body.venueRating ?? null,
      updatedAt: serverTimestamp(),
    };

    // Сохраняем только заданные поля; identity/role/onShift и т.д. не трогаем при частичном обновлении
    if (body.primaryChannel != null) payload.primaryChannel = body.primaryChannel;
    if (body.tgId != null) payload.tgId = body.tgId;
    if (body.identity != null) payload.identity = body.identity;
    if (body.role != null) payload.role = body.role;
    if (body.onShift != null) payload.onShift = body.onShift;
    if (body.active != null) payload.active = body.active;
    if (body.globalScore != null) payload.globalScore = body.globalScore;

    let resolvedId: string;

    if (staffId) {
      const staffRef = doc(db, "staff", staffId);
      const snap = await getDoc(staffRef);
      if (!snap.exists()) {
        return NextResponse.json({ error: "Staff not found" }, { status: 404 });
      }
      const existing = snap.data();
      const updateData: Record<string, unknown> = { ...payload };
      delete updateData.venueId;
      await updateDoc(staffRef, updateData);
      resolvedId = staffId;
    } else {
      const newRef = await addDoc(collection(db, "staff"), {
        venueId: VENUE_ID,
        role: body.role ?? "waiter",
        primaryChannel: body.primaryChannel ?? "telegram",
        identity: body.identity ?? { channel: "telegram", externalId: "", locale: "ru" },
        onShift: false,
        active: true,
        firstName: payload.firstName,
        lastName: payload.lastName,
        gender: payload.gender,
        birthDate: payload.birthDate,
        photoUrl: payload.photoUrl,
        phone: payload.phone,
        position: payload.position,
        assignedTableIds,
        guestRating: payload.guestRating,
        venueRating: payload.venueRating,
        tgId: body.tgId ?? null,
        updatedAt: serverTimestamp(),
      });
      resolvedId = newRef.id;
    }

    const staffSnap = await getDoc(doc(db, "staff", resolvedId));
    const staffData = staffSnap.exists() ? { id: staffSnap.id, ...staffSnap.data() } : null;

    // Синхронизация с global_staff (фундамент Биржи труда для Супер-Админа)
    const globalRef = doc(db, "global_staff", resolvedId);
    await setDoc(
      globalRef,
      {
        ...staffData,
        venueId: VENUE_ID,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, staffId: resolvedId });
  } catch (err) {
    console.error("[staff/upsert] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
