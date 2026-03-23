import { NextRequest, NextResponse } from "next/server";
import type { MessengerIdentity } from "@/lib/types";
import { checkInGuest } from "@/domain/usecases/check-in/checkInGuest";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { venueId, tableId, tableNumber, guestId, participantUid, guestIdentity: rawGuest } = body as {
      venueId?: string;
      tableId?: string;
      tableNumber?: number;
      guestId?: string;
      participantUid?: string;
      guestIdentity?: unknown;
    };
    const guestIdentity: MessengerIdentity | undefined =
      rawGuest && typeof rawGuest === "object" && "channel" in rawGuest && "externalId" in rawGuest
        ? (rawGuest as MessengerIdentity)
        : undefined;

    if (!venueId || !tableId) {
      return NextResponse.json(
        { error: "venueId and tableId required" },
        { status: 400 }
      );
    }

    const result = await checkInGuest({
      venueId,
      tableId,
      tableNumber,
      guestId,
      participantUid,
      guestIdentity,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("check-in API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
