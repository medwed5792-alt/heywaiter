export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

/**
 * GET /api/staff/venues?telegramId=...
 * Список заведений сотрудника по identities.tg: активные привязки из global_users (affiliations).
 * Для мульти-заведений: выбор «Где вы сегодня работаете?».
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const telegramId = searchParams.get("telegramId")?.trim();

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId обязателен" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();

    const globalSnap = await firestore
      .collection("global_users")
      .where("identities.tg", "==", telegramId)
      .limit(1)
      .get();

    if (globalSnap.empty) {
      return NextResponse.json({ venues: [] });
    }

    const globalDoc = globalSnap.docs[0];
    const data = globalDoc.data();
    const affiliations = (data.affiliations as { venueId: string; status?: string }[]) ?? [];
    const active = affiliations.filter((a) => a.status !== "former");

    if (active.length === 0) {
      return NextResponse.json({ venues: [] });
    }

    const venueIds = [...new Set(active.map((a) => a.venueId))];
    const venues: { venueId: string; name: string }[] = [];

    for (const vid of venueIds) {
      const venueSnap = await firestore.collection("venues").doc(vid).get();
      const name = venueSnap.exists ? (venueSnap.data()?.name as string) ?? vid : vid;
      venues.push({ venueId: vid, name });
    }

    return NextResponse.json({ venues });
  } catch (err) {
    console.error("[staff/venues]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
