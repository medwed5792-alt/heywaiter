/**
 * Глобальный поиск заведений по названию и адресу (для кнопки «Поиск» в боте гостя).
 * GET /api/venues/search?q=... — возвращает список venues с контактами.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q")?.trim();
    if (!q || q.length < 2) {
      return NextResponse.json(
        { error: "Query 'q' required (min 2 characters)" },
        { status: 400 }
      );
    }
    const { getAdminFirestore } = await import("@/lib/firebase-admin");
    const firestore = getAdminFirestore();
    const snapshot = await firestore.collection("venues").get();
    const lower = q.toLowerCase();
    const results: Array<{
      id: string;
      name: string;
      address?: string;
      venueType?: string;
      contact?: string;
    }> = [];
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const name = (data.name as string) ?? "";
      const address = (data.address as string) ?? "";
      if (
        name.toLowerCase().includes(lower) ||
        address.toLowerCase().includes(lower)
      ) {
        results.push({
          id: doc.id,
          name,
          address: address || undefined,
          venueType: data.venueType as string | undefined,
          contact: data.contact as string | undefined,
        });
      }
    });
    return NextResponse.json({ venues: results });
  } catch (err) {
    console.error("[venues/search]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
