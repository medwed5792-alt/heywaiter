import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

/** Язык интерфейса гостя (маркетинг / UI). */
export const DEFAULT_GUEST_LOCALE = "RU" as const;
export type GuestLocaleCode = "RU" | "EN" | "BY";

export function normalizeGuestLocale(raw: string | undefined): GuestLocaleCode {
  const u = String(raw ?? "").trim().toUpperCase();
  if (u === "EN" || u === "BY" || u === "RU") return u;
  return DEFAULT_GUEST_LOCALE;
}

/** IANA timezone, например Europe/Moscow; пустая строка — не задано. */
export function normalizeGuestTimezone(raw: string | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s.slice(0, 80);
}

function isStaffLikeRole(systemRole: string): boolean {
  const r = systemRole.trim().toUpperCase();
  return r === "STAFF" || r === "ADMIN";
}

/**
 * После check-in / восстановления сессии: lastSeen, дефолты аналитики, опционально locale/timezone.
 * Не трогает документы персонала (STAFF/ADMIN).
 */
export async function syncGuestGlobalProfileOnVisit(
  fs: Firestore,
  args: {
    globalUid: string;
    venueId: string;
    tableId: string;
    locale?: string;
    timezone?: string;
  }
): Promise<void> {
  const uid = args.globalUid.trim();
  const venueId = args.venueId.trim();
  const tableId = args.tableId.trim();
  if (!uid || !venueId || !tableId) return;

  const ref = fs.collection("global_users").doc(uid);
  await fs.runTransaction(async (trx) => {
    const snap = await trx.get(ref);
    if (!snap.exists) return;
    const d = (snap.data() ?? {}) as Record<string, unknown>;
    const roleRaw = typeof d.systemRole === "string" ? d.systemRole : "";
    if (isStaffLikeRole(roleRaw)) return;

    const patch: Record<string, unknown> = {
      lastSeen: {
        venueId,
        tableId,
        timestamp: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (d.registeredAt == null) {
      patch.registeredAt = FieldValue.serverTimestamp();
    }
    if (d.locale == null || String(d.locale).trim() === "") {
      patch.locale = DEFAULT_GUEST_LOCALE;
    }
    if (d.timezone == null) {
      patch.timezone = "";
    }

    if (args.locale !== undefined && String(args.locale).trim() !== "") {
      patch.locale = normalizeGuestLocale(args.locale);
    }
    if (args.timezone !== undefined) {
      patch.timezone = normalizeGuestTimezone(args.timezone);
    }

    trx.set(ref, patch, { merge: true });
  });
}
