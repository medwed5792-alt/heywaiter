import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/venue/messages
 * Тело: { venueId: string, messages: { checkIn?, booking?, thankYou? } }
 * Обновляет venue.messages (конструктор сценариев ЛПР).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { venueId, messages } = body as {
      venueId?: string;
      messages?: { checkIn?: string; booking?: string; thankYou?: string };
    };

    if (!venueId || !messages) {
      return NextResponse.json(
        { error: "venueId and messages required" },
        { status: 400 }
      );
    }

    const { doc, updateDoc, serverTimestamp } = await import("firebase/firestore");
    const { db } = await import("@/lib/firebase");
    const venueRef = doc(db, "venues", venueId);
    await updateDoc(venueRef, {
      messages: {
        checkIn: messages.checkIn ?? "",
        booking: messages.booking ?? "",
        thankYou: messages.thankYou ?? "",
      },
      updatedAt: serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[venue/messages] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
