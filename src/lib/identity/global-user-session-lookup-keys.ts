import { visitHistoryUidCandidates } from "@/lib/identity/customer-uid";
import type { UnifiedIdentities } from "@/lib/types";

/**
 * Все строки, по которым в activeSessions могут быть masterId / participantUids
 * (id документа global_users + канонические uid каналов + алиасы tg:/telegram_user_id:).
 */
export function collectGlobalUserSessionLookupKeys(
  profileDocId: string,
  data: Record<string, unknown>
): string[] {
  const set = new Set<string>();
  const id = String(profileDocId ?? "").trim();
  if (id) set.add(id);

  const identities = (data.identities ?? {}) as Partial<UnifiedIdentities> & Record<string, unknown>;
  const addPrefixed = (prefix: string, raw: unknown) => {
    const v = String(raw ?? "").trim();
    if (v) set.add(`${prefix}:${v}`);
  };

  if (identities.tg) addPrefixed("tg", identities.tg);
  if (identities.wa) addPrefixed("wa", identities.wa);
  if (identities.vk) addPrefixed("vk", identities.vk);
  if (identities.viber) addPrefixed("viber", identities.viber);
  if (identities.wechat) addPrefixed("wechat", identities.wechat);
  if (identities.inst) addPrefixed("inst", identities.inst);
  if (identities.fb) addPrefixed("fb", identities.fb);
  if (identities.line) addPrefixed("line", identities.line);
  if (identities.phone) {
    const digits = String(identities.phone).replace(/\D/g, "");
    if (digits) set.add(digits);
  }
  if (identities.email) {
    const em = String(identities.email).trim().toLowerCase();
    if (em) set.add(em);
  }
  const anonRaw = identities.anon;
  if (anonRaw != null && String(anonRaw).trim()) addPrefixed("anon", anonRaw);

  const expanded = new Set<string>();
  for (const x of set) {
    for (const c of visitHistoryUidCandidates(x)) {
      if (c.trim()) expanded.add(c.trim());
    }
  }
  return [...expanded];
}

/** Предпочтительный uid для клиента (как в check-in / канальные префиксы). */
export function preferredClientSessionUid(profileDocId: string, data: Record<string, unknown>): string {
  const identities = (data.identities ?? {}) as Partial<UnifiedIdentities> & Record<string, unknown>;
  if (identities.tg?.trim()) return `tg:${identities.tg.trim()}`;
  if (identities.wa?.trim()) return `wa:${identities.wa.trim()}`;
  if (identities.vk?.trim()) return `vk:${identities.vk.trim()}`;
  if (identities.anon != null && String(identities.anon).trim()) return `anon:${String(identities.anon).trim()}`;
  return String(profileDocId ?? "").trim();
}
