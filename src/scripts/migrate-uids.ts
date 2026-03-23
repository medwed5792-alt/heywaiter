/* eslint-disable no-console */
import { config as loadEnv } from "dotenv";
import type { DocumentReference, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";

loadEnv();

type MigrationMode = "dry-run" | "write";

type PlanItem = {
  ref: DocumentReference;
  collection: "activeSessions" | "orders" | "guestEvents";
  before: Record<string, unknown>;
  patch: Record<string, unknown>;
};

type Stats = {
  scanned: number;
  planned: number;
  updated: number;
  skipped: number;
};

function normalizeUid(raw: unknown, sourceHint?: string): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (v.startsWith("telegram_user_id:") || v.startsWith("anonymous_id:")) return v;
  if (v.startsWith("tg:")) return `telegram_user_id:${v.slice(3).trim()}`;
  if (v.startsWith("chat:")) return `telegram_user_id:${v.slice(5).trim()}`;
  if (v.startsWith("telegram:")) return `telegram_user_id:${v.slice(9).trim()}`;
  if (v.startsWith("anon:")) return `anonymous_id:${v.slice(5).trim()}`;
  if (v.startsWith("visitor:")) return `anonymous_id:${v.slice(8).trim()}`;
  if (/^\d+$/.test(v)) return `telegram_user_id:${v}`;

  const hint = (sourceHint || "").toLowerCase();
  if (hint.includes("chat") || hint.includes("telegram") || hint.includes("tg")) {
    return `telegram_user_id:${v}`;
  }
  return `anonymous_id:${v}`;
}

function pickLegacyUidFromDoc(data: Record<string, unknown>): { uid: string; source: string } {
  const guestIdentity = (data.guestIdentity ?? {}) as Record<string, unknown>;
  const guestIdentityExternal = guestIdentity.externalId;
  const candidates: Array<[string, unknown]> = [
    ["customerUid", data.customerUid],
    ["participantUid", data.participantUid],
    ["masterId", data.masterId],
    ["visitorId", data.visitorId],
    ["guestChatId", data.guestChatId],
    ["chatId", data.chatId],
    ["guestIdentity.externalId", guestIdentityExternal],
    ["guestId", data.guestId],
  ];
  for (const [source, value] of candidates) {
    const normalized = normalizeUid(value, source);
    if (normalized) return { uid: normalized, source };
  }
  return { uid: "", source: "" };
}

function parseArgs(): MigrationMode {
  const args = new Set(process.argv.slice(2).map((s) => s.trim()));
  if (args.has("--write")) return "write";
  return "dry-run";
}

function printPlanItem(item: PlanItem): void {
  console.log(
    `[plan][${item.collection}] ${item.ref.path} | from=${String(item.before._uidSource ?? "unknown")} -> ${String(item.patch.customerUid)}`
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function collectActiveSessionsPlan(stats: Stats): Promise<PlanItem[]> {
  const firestore = getAdminFirestore();
  const snap = await firestore.collection("activeSessions").get();
  const plan: PlanItem[] = [];
  for (const docSnap of snap.docs) {
    stats.scanned += 1;
    const data = (docSnap.data() ?? {}) as Record<string, unknown>;
    const { uid, source } = pickLegacyUidFromDoc(data);
    if (!uid) {
      stats.skipped += 1;
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (!String(data.customerUid ?? "").trim()) patch.customerUid = uid;

    // Normalize collective-session IDs to unified contract.
    const masterId = normalizeUid(data.masterId, "masterId");
    if (masterId && masterId !== data.masterId) patch.masterId = masterId;
    if (Array.isArray(data.participants)) {
      const participants = data.participants as Array<Record<string, unknown>>;
      const normalizedParticipants = participants.map((p) => {
        const oldUid = p?.uid;
        const newUid = normalizeUid(oldUid, "participants.uid");
        return newUid && newUid !== oldUid ? { ...p, uid: newUid } : p;
      });
      const changed = normalizedParticipants.some((p, i) => p !== participants[i]);
      if (changed) patch.participants = normalizedParticipants;
    }

    if (Object.keys(patch).length === 0) {
      stats.skipped += 1;
      continue;
    }
    stats.planned += 1;
    plan.push({
      ref: docSnap.ref,
      collection: "activeSessions",
      before: { _uidSource: source, customerUid: data.customerUid, masterId: data.masterId },
      patch,
    });
  }
  return plan;
}

async function collectOrdersPlan(stats: Stats): Promise<PlanItem[]> {
  const firestore = getAdminFirestore();
  const snap = await firestore.collection("orders").get();
  const plan: PlanItem[] = [];
  for (const docSnap of snap.docs) {
    stats.scanned += 1;
    const data = (docSnap.data() ?? {}) as Record<string, unknown>;
    const { uid, source } = pickLegacyUidFromDoc(data);
    if (!uid) {
      stats.skipped += 1;
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (!String(data.customerUid ?? "").trim()) patch.customerUid = uid;
    if (Object.keys(patch).length === 0) {
      stats.skipped += 1;
      continue;
    }
    stats.planned += 1;
    plan.push({
      ref: docSnap.ref,
      collection: "orders",
      before: { _uidSource: source, customerUid: data.customerUid, guestChatId: data.guestChatId },
      patch,
    });
  }
  return plan;
}

function isGuestEventDoc(docSnap: QueryDocumentSnapshot): boolean {
  const p = docSnap.ref.path;
  return p.endsWith("/events/" + docSnap.id) || p.startsWith("guestEvents/");
}

async function collectGuestEventsPlan(stats: Stats): Promise<PlanItem[]> {
  const firestore = getAdminFirestore();
  const plan: PlanItem[] = [];

  // 1) Legacy top-level collection (if used)
  const legacyTop = await firestore.collection("guestEvents").get().catch(() => null);
  if (legacyTop) {
    for (const docSnap of legacyTop.docs) {
      stats.scanned += 1;
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const { uid, source } = pickLegacyUidFromDoc(data);
      if (!uid || String(data.customerUid ?? "").trim()) {
        stats.skipped += 1;
        continue;
      }
      stats.planned += 1;
      plan.push({
        ref: docSnap.ref,
        collection: "guestEvents",
        before: { _uidSource: source, customerUid: data.customerUid, visitorId: data.visitorId },
        patch: { customerUid: uid },
      });
    }
  }

  // 2) Current nested venue events: venues/{venueId}/events/{id}
  const groupSnap = await firestore.collectionGroup("events").get();
  for (const docSnap of groupSnap.docs) {
    if (!isGuestEventDoc(docSnap)) continue;
    stats.scanned += 1;
    const data = (docSnap.data() ?? {}) as Record<string, unknown>;
    // Focus on guest-originated events
    const type = String(data.type ?? "").trim();
    const likelyGuestEvent =
      type === "call_waiter" ||
      type === "request_bill" ||
      type === "sos" ||
      Boolean(data.visitorId || data.customerUid || data.guestId || data.chatId || data.guestChatId);
    if (!likelyGuestEvent) {
      stats.skipped += 1;
      continue;
    }
    const { uid, source } = pickLegacyUidFromDoc(data);
    if (!uid || String(data.customerUid ?? "").trim()) {
      stats.skipped += 1;
      continue;
    }
    stats.planned += 1;
    plan.push({
      ref: docSnap.ref,
      collection: "guestEvents",
      before: { _uidSource: source, customerUid: data.customerUid, visitorId: data.visitorId },
      patch: { customerUid: uid },
    });
  }
  return plan;
}

async function applyPlan(plan: PlanItem[]): Promise<number> {
  const firestore = getAdminFirestore();
  let updated = 0;
  for (const part of chunk(plan, 400)) {
    const batch = firestore.batch();
    for (const item of part) batch.update(item.ref, item.patch);
    await batch.commit();
    updated += part.length;
  }
  return updated;
}

async function run(): Promise<void> {
  const mode = parseArgs();
  const dryRun = mode === "dry-run";
  console.log(`[migrate-uids] mode=${mode}`);

  const activeStats: Stats = { scanned: 0, planned: 0, updated: 0, skipped: 0 };
  const orderStats: Stats = { scanned: 0, planned: 0, updated: 0, skipped: 0 };
  const eventStats: Stats = { scanned: 0, planned: 0, updated: 0, skipped: 0 };

  const activePlan = await collectActiveSessionsPlan(activeStats);
  const orderPlan = await collectOrdersPlan(orderStats);
  const eventPlan = await collectGuestEventsPlan(eventStats);
  const fullPlan = [...activePlan, ...orderPlan, ...eventPlan];

  console.log(`[migrate-uids] planned updates: ${fullPlan.length}`);
  fullPlan.slice(0, 50).forEach(printPlanItem);
  if (fullPlan.length > 50) {
    console.log(`[migrate-uids] ... and ${fullPlan.length - 50} more`);
  }

  if (!dryRun && fullPlan.length > 0) {
    const updated = await applyPlan(fullPlan);
    activeStats.updated = activePlan.length;
    orderStats.updated = orderPlan.length;
    eventStats.updated = eventPlan.length;
    console.log(`[migrate-uids] write complete, updated=${updated}`);
  } else {
    console.log("[migrate-uids] dry run complete, no writes performed");
  }

  console.log("[migrate-uids] summary");
  console.table({
    activeSessions: activeStats,
    orders: orderStats,
    guestEvents: eventStats,
  });
}

run().catch((err) => {
  console.error("[migrate-uids] fatal:", err);
  process.exitCode = 1;
});

