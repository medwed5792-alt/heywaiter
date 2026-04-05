import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getEffectiveBotToken } from "@/lib/webhook/bots-store";
import { guestCustomerUidsMatch } from "@/lib/identity/customer-uid";
import type {
  ActiveSessionParticipant,
  ActiveSessionParticipantStatus,
} from "@/lib/types";

export const runtime = "nodejs";

/** Служебная склейка мессенджер→стол (не доменная activeSessions). */
const IDX = "active_sessions";
/** Максимальный возраст записи active_sessions для recover (как в ТЗ: 4 ч). */
const CTX_MAX_MS = 4 * 60 * 60 * 1000;
const INIT_MAX_AGE_SEC = 24 * 60 * 60;

type IndexDoc = { vr_id?: string; table_id?: string; last_seen?: unknown; order_status?: string };

function idxDocId(telegramUserId: string): string {
  const id = telegramUserId.trim();
  return id ? `tg_${id}` : "";
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function verifyInitData(
  initData: string,
  botToken: string
): { ok: true; userId: string } | { ok: false; reason: string } {
  const raw = initData.trim();
  if (!raw) return { ok: false, reason: "empty_init_data" };
  const token = botToken.trim();
  if (!token) return { ok: false, reason: "missing_bot_token" };

  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };
  params.delete("hash");
  const dataCheckString = [...params.keys()]
    .sort()
    .map((k) => `${k}=${params.get(k) ?? ""}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const calculated = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!safeEqualHex(calculated, hash.trim().toLowerCase())) return { ok: false, reason: "bad_hash" };

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return { ok: false, reason: "bad_auth_date" };
  if (Math.floor(Date.now() / 1000) - authDate > INIT_MAX_AGE_SEC) {
    return { ok: false, reason: "init_data_expired" };
  }

  let user: { id?: number };
  try {
    user = JSON.parse(params.get("user") ?? "null") as { id?: number };
  } catch {
    return { ok: false, reason: "bad_user_json" };
  }
  if (user?.id == null || !Number.isFinite(Number(user.id))) return { ok: false, reason: "missing_user_id" };
  return { ok: true, userId: String(user.id) };
}

function lastSeenMs(v: unknown): number {
  if (v != null && typeof v === "object" && "toMillis" in v) {
    const fn = (v as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") {
      try {
        return fn.call(v);
      } catch {
        return 0;
      }
    }
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

function normalizeParticipants(raw: unknown, now: Date): ActiveSessionParticipant[] {
  if (!Array.isArray(raw)) return [];
  const out: ActiveSessionParticipant[] = [];
  for (const item of raw) {
    const d = (item ?? {}) as Record<string, unknown>;
    const uid = typeof d.uid === "string" ? d.uid.trim() : "";
    if (!uid) continue;
    const status = d.status as ActiveSessionParticipantStatus | undefined;
    out.push({
      uid,
      status: status === "paid" || status === "exited" ? status : "active",
      joinedAt: (d.joinedAt as Date) ?? now,
      updatedAt: (d.updatedAt as Date) ?? now,
    });
  }
  return out;
}

async function bumpVisit(customerUid: string, venueId: string): Promise<void> {
  const fs = getAdminFirestore();
  await fs.doc(`users/${customerUid}/visits/${venueId.trim()}`).set(
    { lastVisitAt: FieldValue.serverTimestamp(), totalVisits: FieldValue.increment(1) },
    { merge: true }
  );
}

async function sessionHasTgParticipant(venueId: string, tableId: string, tgUserId: string): Promise<boolean> {
  const fs = getAdminFirestore();
  const uid = `tg:${tgUserId}`;
  const snap = await fs
    .collection("activeSessions")
    .where("venueId", "==", venueId.trim())
    .where("tableId", "==", tableId.trim())
    .where("status", "==", "check_in_success")
    .limit(1)
    .get();
  if (snap.empty) return false;
  const d = (snap.docs[0]!.data() ?? {}) as Record<string, unknown>;
  const masterId = typeof d.masterId === "string" ? d.masterId.trim() : "";
  if (guestCustomerUidsMatch(masterId, uid)) return true;
  for (const p of Array.isArray(d.participants) ? d.participants : []) {
    const u = typeof (p as { uid?: string })?.uid === "string" ? (p as { uid: string }).uid.trim() : "";
    if (u && guestCustomerUidsMatch(u, uid)) return true;
  }
  return false;
}

type ClaimResult =
  | { ok: true; sessionId: string }
  | { ok: false; err: "no_session" | "table_private" | "invalid_input" };

async function claimTableForTelegramUser(
  venueId: string,
  tableId: string,
  telegramUserId: string
): Promise<ClaimResult> {
  const v = venueId.trim();
  const t = tableId.trim();
  const tgRaw = String(telegramUserId ?? "").trim();
  if (!v || !t || !tgRaw) return { ok: false, err: "invalid_input" };

  const currentUid = `tg:${tgRaw}`;
  const fs = getAdminFirestore();
  const now = new Date();

  const snap = await fs
    .collection("activeSessions")
    .where("venueId", "==", v)
    .where("tableId", "==", t)
    .where("status", "==", "check_in_success")
    .limit(1)
    .get();
  if (snap.empty) return { ok: false, err: "no_session" };

  const docSnap = snap.docs[0]!;
  const data = docSnap.data() as Record<string, unknown>;
  const existingMasterId = (data.masterId as string | undefined)?.trim();
  const isPrivate = typeof data.isPrivate === "boolean" ? (data.isPrivate as boolean) : true;
  let participants = normalizeParticipants(data.participants, now);

  const pIdx = participants.findIndex((p) => guestCustomerUidsMatch(p.uid, currentUid));
  const existingP = pIdx >= 0 ? participants[pIdx]! : null;

  if (existingP) {
    const next: ActiveSessionParticipantStatus = existingP.status === "exited" ? "active" : existingP.status;
    if (next !== existingP.status) {
      participants[pIdx] = { ...existingP, status: next, updatedAt: now };
      await fs.collection("activeSessions").doc(docSnap.id).update({ participants, updatedAt: now });
      await bumpVisit(currentUid, v);
    }
    return { ok: true, sessionId: docSnap.id };
  }

  if (
    isPrivate &&
    existingMasterId?.startsWith("anon:") &&
    currentUid.startsWith("tg:") &&
    !guestCustomerUidsMatch(existingMasterId, currentUid)
  ) {
    const merged = participants.map((p) =>
      guestCustomerUidsMatch(p.uid, existingMasterId!)
        ? { ...p, uid: currentUid, status: "active" as ActiveSessionParticipantStatus, updatedAt: now }
        : p
    );
    let nextP = merged;
    if (!nextP.some((p) => guestCustomerUidsMatch(p.uid, currentUid))) {
      nextP = [...merged, { uid: currentUid, status: "active" as const, joinedAt: now, updatedAt: now }];
    }
    await fs.collection("activeSessions").doc(docSnap.id).update({
      masterId: currentUid,
      participants: nextP,
      updatedAt: now,
    });
    await bumpVisit(currentUid, v);
    return { ok: true, sessionId: docSnap.id };
  }

  if (isPrivate && existingMasterId && !guestCustomerUidsMatch(existingMasterId, currentUid)) {
    return { ok: false, err: "table_private" };
  }

  if (!existingMasterId || !isPrivate || guestCustomerUidsMatch(existingMasterId, currentUid)) {
    participants = [...participants, { uid: currentUid, status: "active", joinedAt: now, updatedAt: now }];
    await fs.collection("activeSessions").doc(docSnap.id).update({
      participants,
      ...(existingMasterId ? {} : { masterId: currentUid }),
      updatedAt: now,
    });
    await bumpVisit(currentUid, v);
    return { ok: true, sessionId: docSnap.id };
  }

  return { ok: false, err: "table_private" };
}

async function resolveVerifiedUser(initData: string) {
  const token = await getEffectiveBotToken("telegram", "client");
  if (!token) {
    return { error: NextResponse.json({ error: "guest_bot_token_unconfigured" }, { status: 503 }) };
  }
  const v = verifyInitData(initData, token);
  if (!v.ok) return { error: NextResponse.json({ error: v.reason }, { status: 401 }) };
  return { userId: v.userId };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      initData?: string;
      venueId?: string;
      tableId?: string;
    };
    const action = String(body.action ?? "").trim().toLowerCase();
    const initData = typeof body.initData === "string" ? body.initData.trim() : "";
    if (!initData) {
      return NextResponse.json({ error: "initData required" }, { status: 400 });
    }

    const verified = await resolveVerifiedUser(initData);
    if ("error" in verified) return verified.error;
    const { userId } = verified;

    const fs = getAdminFirestore();
    const docId = idxDocId(userId);
    const ref = fs.collection(IDX).doc(docId);

    if (action === "clear") {
      await ref.delete().catch(() => undefined);
      return NextResponse.json({ ok: true });
    }

    if (action === "claim") {
      const vrId = String(body.venueId ?? "").trim();
      const tableId = String(body.tableId ?? "").trim();
      if (!vrId || !tableId) {
        return NextResponse.json({ error: "venueId and tableId required" }, { status: 400 });
      }
      const claimed = await claimTableForTelegramUser(vrId, tableId, userId);
      if (!claimed.ok) {
        const st = claimed.err === "no_session" ? 404 : claimed.err === "invalid_input" ? 400 : 403;
        return NextResponse.json({ error: claimed.err }, { status: st });
      }
      await ref.set(
        {
          vr_id: vrId,
          table_id: tableId,
          last_seen: FieldValue.serverTimestamp(),
          order_status: "active",
        },
        { merge: true }
      );
      return NextResponse.json({ ok: true, sessionId: claimed.sessionId });
    }

    if (action === "recover") {
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ active: false });

      const data = snap.data() as IndexDoc;
      const vrId = typeof data.vr_id === "string" ? data.vr_id.trim() : "";
      const tableId = typeof data.table_id === "string" ? data.table_id.trim() : "";
      if (!vrId || !tableId) {
        await ref.delete().catch(() => undefined);
        return NextResponse.json({ active: false });
      }
      const seen = lastSeenMs(data.last_seen);
      if (!seen || Date.now() - seen > CTX_MAX_MS) {
        await ref.delete().catch(() => undefined);
        return NextResponse.json({ active: false });
      }
      if (!(await sessionHasTgParticipant(vrId, tableId, userId))) {
        await ref.delete().catch(() => undefined);
        return NextResponse.json({ active: false });
      }
      await ref.update({ last_seen: FieldValue.serverTimestamp() }).catch(() => undefined);
      return NextResponse.json({
        active: true,
        vrId,
        tableId,
        order_status: typeof data.order_status === "string" ? data.order_status : "active",
      });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (e) {
    console.error("[api/guest/session-context]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server_error" },
      { status: 500 }
    );
  }
}
