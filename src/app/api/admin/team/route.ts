export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Staff, GlobalUser } from "@/lib/types";
import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";

/**
 * GET /api/admin/team
 * Список команды: global_users (staffVenueActive) + venues/{venue}/staff (без корневой staff).
 */
export async function GET() {
  try {
    const staffSnap = await getDocs(
      query(collection(db, "global_users"), where("staffVenueActive", "array-contains", VENUE_ID))
    );

    const staffList: Staff[] = [];

    for (const d of staffSnap.docs) {
      const global = { id: d.id, ...d.data() } as GlobalUser;
      const aff = global.affiliations?.find((a) => a.venueId === VENUE_ID);
      if (!aff || aff.status === "former") continue;

      const staffDocId = `${VENUE_ID}_${d.id}`;
      const vsSnap = await getDoc(doc(db, "venues", VENUE_ID, "staff", staffDocId));
      const vd = vsSnap.exists() ? vsSnap.data() : {};

      if (vd.status === "inactive" || vd.active === false) continue;

      const sotaId =
        (typeof vd.sotaId === "string" && vd.sotaId.trim() && vd.sotaId.trim()) ||
        (typeof global.sotaId === "string" && global.sotaId.trim() && global.sotaId.trim()) ||
        undefined;

      staffList.push({
        id: staffDocId,
        userId: global.id,
        venueId: VENUE_ID,
        ...(sotaId ? { sotaId } : {}),
        role: (vd.role as Staff["role"]) ?? (aff.role as Staff["role"]) ?? "waiter",
        primaryChannel: (global.primaryChannel as Staff["primaryChannel"]) ?? "telegram",
        identity: global.identity ?? { channel: "telegram", externalId: "", locale: "ru" },
        onShift: vd.onShift === true || aff.onShift === true,
        active: true,
        firstName: global.firstName ?? (vd.firstName as string) ?? null,
        lastName: global.lastName ?? (vd.lastName as string) ?? null,
        position: aff.position ?? (vd.position as string) ?? undefined,
        group: vd.group ?? undefined,
        call_category: vd.call_category ?? undefined,
        assignedTableIds: (aff.assignedTableIds as string[]) ?? (vd.assignedTableIds as string[]) ?? [],
        globalScore: global.globalScore,
        guestRating: global.guestRating,
        venueRating: global.venueRating,
        photoUrl: global.photoUrl ?? (vd.photoUrl as string) ?? undefined,
        phone: global.phone ?? (vd.phone as string) ?? undefined,
        tgId: global.tgId ?? (vd.tgId as string) ?? undefined,
        identities: global.identities ?? (vd.tgId ? { tg: vd.tgId as string } : undefined),
        careerHistory: global.careerHistory,
        updatedAt: global.updatedAt ?? vd.updatedAt,
      } as Staff);
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
