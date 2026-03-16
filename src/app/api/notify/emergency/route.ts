export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { sosFanOut } from "@/lib/bot-router";

/**
 * POST /api/notify/emergency
 * Тело: { venueId: string; tableNumber: number; staffId?: string }
 * Источник: Mini App официанта — секция «Экстренная помощь».
 * Логика:
 * 1) Проверка, что стол с таким номером существует в venues/{venueId}/tables.
 * 2) Вызов sosFanOut(venueId, tableNumber) → веерная рассылка охране/менеджеру и запись в staffNotifications.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  try {
    const payload = (body || {}) as {
      venueId?: string;
      tableNumber?: number;
      staffId?: string;
    };
    const venueId = (payload.venueId || "").trim();
    const tableNumber = Number(payload.tableNumber);

    if (!venueId) {
      return NextResponse.json(
        { ok: false, error: "Не указан venueId" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(tableNumber) || tableNumber < 1) {
      return NextResponse.json(
        { ok: false, error: "Некорректный номер стола" },
        { status: 400 }
      );
    }

    const firestore = getAdminFirestore();
    const tablesSnap = await firestore
      .collection("venues")
      .doc(venueId)
      .collection("tables")
      .where("number", "==", tableNumber)
      .limit(1)
      .get();

    if (tablesSnap.empty) {
      return NextResponse.json(
        { ok: false, error: "Стол с таким номером не найден" },
        { status: 404 }
      );
    }

    const result = await sosFanOut(venueId, String(tableNumber), "telegram");
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: "Не удалось отправить SOS" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[notify/emergency]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}

