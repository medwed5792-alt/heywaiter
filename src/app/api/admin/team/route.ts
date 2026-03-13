export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Staff, GlobalUser } from "@/lib/types";

const VENUE_ID = "current";

/**
 * GET /api/admin/team
 * Список команды заведения: только те, у кого venueId === currentVenueId.
 * Данные из staff + global_users (если есть userId).
 */
export async function GET() {
  try {
    const staffSnap = await getDocs(
      query(collection(db, "staff"), where("venueId", "==", VENUE_ID))
    );

    const staffList: Staff[] = [];
    const userIds: string[] = [];

    for (const d of staffSnap.docs) {
      const data = d.data();
      const userId = data.userId as string | undefined;
      if (userId) {
        userIds.push(userId);
      }
    }

    // Batch read global_users for linked staff
    const globalUsers = new Map<string, GlobalUser>();
    for (const uid of [...new Set(userIds)]) {
      const ref = doc(db, "global_users", uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        globalUsers.set(uid, { id: snap.id, ...snap.data() } as GlobalUser);
      }
    }

    for (const d of staffSnap.docs) {
      const data = d.data();
      const userId = data.userId as string | undefined;
      const global = userId ? globalUsers.get(userId) : null;
      const aff = global?.affiliations?.find((a) => a.venueId === VENUE_ID);
      const isActive = (data.active !== false) && (aff?.status === "active" ?? true);
      if (!isActive) continue;

      if (global) {
        staffList.push({
          id: d.id,
          userId: global.id,
          venueId: VENUE_ID,
          role: (data.role as Staff["role"]) ?? "waiter",
          primaryChannel: (global.primaryChannel as Staff["primaryChannel"]) ?? "telegram",
          identity: global.identity ?? { channel: "telegram", externalId: "", locale: "ru" },
          onShift: data.onShift ?? aff?.onShift ?? false,
          active: true,
          firstName: global.firstName ?? data.firstName,
          lastName: global.lastName ?? data.lastName,
          position: aff?.position ?? data.position,
          group: data.group ?? undefined,
          call_category: data.call_category ?? undefined,
          assignedTableIds: aff?.assignedTableIds ?? data.assignedTableIds ?? [],
          globalScore: global.globalScore ?? data.globalScore,
          guestRating: global.guestRating ?? data.guestRating,
          venueRating: global.venueRating ?? data.venueRating,
          photoUrl: global.photoUrl ?? data.photoUrl,
          phone: global.phone ?? data.phone,
          tgId: global.tgId ?? data.tgId,
          identities: global.identities ?? (data.tgId ? { tg: data.tgId } : undefined),
          careerHistory: global.careerHistory,
          updatedAt: global.updatedAt ?? data.updatedAt,
        } as Staff);
      } else {
        staffList.push({
          id: d.id,
          venueId: VENUE_ID,
          role: (data.role as Staff["role"]) ?? "waiter",
          primaryChannel: (data.primaryChannel as Staff["primaryChannel"]) ?? "telegram",
          identity: (data.identity as Staff["identity"]) ?? { channel: "telegram", externalId: "", locale: "ru" },
          onShift: data.onShift ?? false,
          active: true,
          firstName: data.firstName,
          lastName: data.lastName,
          position: data.position,
          group: data.group,
          call_category: data.call_category,
          assignedTableIds: data.assignedTableIds ?? [],
          globalScore: data.globalScore,
          guestRating: data.guestRating,
          venueRating: data.venueRating,
          photoUrl: data.photoUrl,
          phone: data.phone,
          tgId: data.tgId,
          identities: data.identities ?? (data.tgId ? { tg: data.tgId } : undefined),
          careerHistory: data.careerHistory,
          updatedAt: data.updatedAt,
        } as Staff);
      }
    }

    return NextResponse.json({ staff: staffList });
  } catch (err) {
    console.error("[admin/team] GET Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
