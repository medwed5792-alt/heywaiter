export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Affiliation } from "@/lib/types";

const VENUE_ID = "current";

/**
 * POST /api/admin/staff/upsert
 * ЛПР: создание или обновление сотрудника.
 * - Без staffId: создаёт документ в global_users и привязывает к текущему venueId (staff doc id = venueId_userId).
 * - Со staffId: обновляет global_users и связь (affiliation) для текущего заведения.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const staffId = body.staffId as string | undefined;

    const assignedTableIds = Array.isArray(body.assignedTableIds) ? body.assignedTableIds : [];
    const identity = body.identity ?? { channel: "telegram", externalId: body.tgId ?? "", locale: "ru", displayName: [body.firstName, body.lastName].filter(Boolean).join(" ") };

    if (staffId) {
      // Обновление: staff doc id может быть venueId_userId или legacy id
      const staffRef = doc(db, "staff", staffId);
      const staffSnap = await getDoc(staffRef);
      if (!staffSnap.exists()) {
        return NextResponse.json({ error: "Staff not found" }, { status: 404 });
      }
      const staffData = staffSnap.data();
      const userId = staffData.userId as string | undefined || staffId; // legacy: id = userId

      const globalRef = doc(db, "global_users", userId);
      const globalSnap = await getDoc(globalRef);

      const profilePayload: Record<string, unknown> = {
        firstName: body.firstName ?? staffData.firstName ?? null,
        lastName: body.lastName ?? staffData.lastName ?? null,
        gender: body.gender ?? staffData.gender ?? null,
        birthDate: body.birthDate ?? staffData.birthDate ?? null,
        photoUrl: body.photoUrl ?? staffData.photoUrl ?? null,
        phone: body.phone ?? staffData.phone ?? null,
        identity: body.identity ?? staffData.identity ?? identity,
        primaryChannel: body.primaryChannel ?? staffData.primaryChannel ?? "telegram",
        tgId: body.tgId ?? staffData.tgId ?? null,
        guestRating: body.guestRating ?? staffData.guestRating ?? null,
        venueRating: body.venueRating ?? staffData.venueRating ?? null,
        updatedAt: serverTimestamp(),
      };
      if (body.globalScore != null) profilePayload.globalScore = body.globalScore;

      if (globalSnap.exists()) {
        const globalData = globalSnap.data();
        const affiliations: Affiliation[] = Array.isArray(globalData.affiliations) ? [...globalData.affiliations] : [];
        const idx = affiliations.findIndex((a: { venueId: string }) => a.venueId === VENUE_ID);
        const affPayload: Affiliation = {
          venueId: VENUE_ID,
          role: body.position ?? body.role ?? globalData.affiliations?.[idx]?.role ?? "waiter",
          status: (affiliations[idx] as Affiliation)?.status ?? "active",
          position: body.position ?? (affiliations[idx] as Affiliation)?.position,
          onShift: body.onShift ?? (affiliations[idx] as Affiliation)?.onShift ?? false,
          assignedTableIds: assignedTableIds.length ? assignedTableIds : (affiliations[idx] as Affiliation)?.assignedTableIds,
        };
        if (idx >= 0) affiliations[idx] = affPayload;
        else affiliations.push(affPayload);

        await updateDoc(globalRef, {
          ...profilePayload,
          affiliations,
        });
      } else {
        // Legacy staff without global_users: create global_users and set affiliation
        await setDoc(globalRef, {
          ...profilePayload,
          affiliations: [{
            venueId: VENUE_ID,
            role: body.position ?? body.role ?? "waiter",
            status: "active",
            position: body.position ?? null,
            onShift: body.onShift ?? false,
            assignedTableIds: assignedTableIds.length ? assignedTableIds : undefined,
          } as Affiliation],
        });
      }

      const staffUpdate: Record<string, unknown> = {
        position: body.position ?? staffData.position,
        group: body.group ?? staffData.group,
        call_category: body.call_category ?? staffData.call_category,
        onShift: body.onShift ?? staffData.onShift,
        assignedTableIds,
        updatedAt: serverTimestamp(),
      };
      if (body.role != null) staffUpdate.role = body.role;
      if (body.active != null) staffUpdate.active = body.active;
      await updateDoc(staffRef, staffUpdate);

      return NextResponse.json({ ok: true, staffId });
    }

    // Создание: новый сотрудник в global_users + привязка к venueId
    const affiliation: Affiliation = {
      venueId: VENUE_ID,
      role: body.position ?? body.role ?? "waiter",
      status: "active",
      position: body.position ?? undefined,
      onShift: false,
      assignedTableIds: assignedTableIds.length ? assignedTableIds : undefined,
    };

    const newGlobalRef = await addDoc(collection(db, "global_users"), {
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
      gender: body.gender ?? null,
      birthDate: body.birthDate ?? null,
      photoUrl: body.photoUrl ?? null,
      phone: body.phone ?? null,
      identity,
      primaryChannel: body.primaryChannel ?? "telegram",
      tgId: body.tgId ?? null,
      affiliations: [affiliation],
      careerHistory: [],
      updatedAt: serverTimestamp(),
    });
    const newUserId = newGlobalRef.id;

    const linkId = `${VENUE_ID}_${newUserId}`;
    const staffRef = doc(db, "staff", linkId);
    await setDoc(staffRef, {
      venueId: VENUE_ID,
      userId: newUserId,
      role: body.role ?? "waiter",
      primaryChannel: body.primaryChannel ?? "telegram",
      identity,
      onShift: false,
      active: true,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
      position: body.position ?? null,
      group: body.group ?? null,
      call_category: body.call_category ?? null,
      assignedTableIds,
      tgId: body.tgId ?? null,
      updatedAt: serverTimestamp(),
    });

    return NextResponse.json({ ok: true, staffId: linkId });
  } catch (err) {
    console.error("[staff/upsert] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
