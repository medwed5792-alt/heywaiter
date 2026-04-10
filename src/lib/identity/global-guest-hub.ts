import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";

type GuestIdentityKey = "tg" | "wa" | "vk" | "anon" | "phone" | "email";

export type GuestIdentityInput = {
  key: GuestIdentityKey;
  value: string;
};

function normalizeIdentityValue(key: GuestIdentityKey, raw: string): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (key === "phone") return v.replace(/\D/g, "");
  return v;
}

export function guestIdentityFromCustomerUid(uidRaw: string): GuestIdentityInput | null {
  const uid = String(uidRaw ?? "").trim();
  if (!uid) return null;
  const i = uid.indexOf(":");
  if (i <= 0) return null;
  const p = uid.slice(0, i).trim().toLowerCase();
  const v = uid.slice(i + 1).trim();
  if (!v) return null;
  if (p === "tg") return { key: "tg", value: v };
  if (p === "wa") return { key: "wa", value: v };
  if (p === "vk") return { key: "vk", value: v };
  if (p === "anon") return { key: "anon", value: v };
  return null;
}

export async function findGuestByExternalIdentity(
  key: GuestIdentityKey,
  valueRaw: string
): Promise<string | null> {
  const value = normalizeIdentityValue(key, valueRaw);
  if (!value) return null;
  const fs = getAdminFirestore();
  const q = await fs.collection("global_users").where(`identities.${key}`, "==", value).limit(1).get();
  if (q.empty) return null;
  return q.docs[0]!.id;
}

const IDENTITY_LOOKUP_ORDER: GuestIdentityKey[] = ["tg", "wa", "vk", "phone", "email", "anon"];

async function mergeIdentitiesIntoExistingGuest(
  globalUid: string,
  identities: GuestIdentityInput[]
): Promise<void> {
  const normalized = identities
    .map((x) => ({ key: x.key, value: normalizeIdentityValue(x.key, x.value) }))
    .filter((x) => x.value);
  if (normalized.length === 0) return;
  const fs = getAdminFirestore();
  const ref = fs.collection("global_users").doc(globalUid);
  await fs.runTransaction(async (trx) => {
    const snap = await trx.get(ref);
    if (!snap.exists) return;
    const prevIdentities = (snap.data()?.identities ?? {}) as Record<string, unknown>;
    const systemRoleRaw =
      typeof snap.data()?.systemRole === "string" ? String(snap.data()!.systemRole).trim().toUpperCase() : "";
    const systemRole = systemRoleRaw === "STAFF" || systemRoleRaw === "ADMIN" ? systemRoleRaw : "GUEST";
    const nextIdentities: Record<string, string> = {};
    for (const x of normalized) nextIdentities[x.key] = x.value;
    trx.set(
      ref,
      {
        identities: { ...prevIdentities, ...nextIdentities },
        systemRole,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

/**
 * Identity Hub: параллельный lookup по всем ключам, без ожидания «первого по очереди».
 * 1) Известный globalUid — если документ есть, сразу используем и дописываем новые ключи.
 * 2) Иначе ищем существующий профиль по любому ключу (приоритет tg → wa → vk → phone → email → anon).
 * 3) Иначе создаём как resolveOrCreateGlobalGuestUid.
 */
export async function resolveGlobalGuestUidForCheckIn(args: {
  knownGlobalUid?: string;
  identityInputs: GuestIdentityInput[];
}): Promise<string> {
  const known = String(args.knownGlobalUid ?? "").trim();
  const normalized = args.identityInputs
    .map((x) => ({ key: x.key, value: normalizeIdentityValue(x.key, x.value) }))
    .filter((x) => x.value);
  const fs = getAdminFirestore();

  if (known) {
    const snap = await fs.collection("global_users").doc(known).get();
    if (snap.exists) {
      await mergeIdentitiesIntoExistingGuest(known, normalized);
      return known;
    }
  }

  if (normalized.length === 0) {
    return "";
  }

  const hits = await Promise.all(
    normalized.map(async (idt) => ({
      key: idt.key,
      value: idt.value,
      uid: await findGuestByExternalIdentity(idt.key, idt.value),
    }))
  );

  for (const key of IDENTITY_LOOKUP_ORDER) {
    const row = hits.find((h) => h.key === key && h.uid);
    if (row?.uid) {
      await mergeIdentitiesIntoExistingGuest(row.uid, normalized);
      return row.uid;
    }
  }

  return resolveOrCreateGlobalGuestUid(normalized);
}

export async function resolveOrCreateGlobalGuestUid(identities: GuestIdentityInput[]): Promise<string> {
  const normalized = identities
    .map((x) => ({ key: x.key, value: normalizeIdentityValue(x.key, x.value) }))
    .filter((x) => x.value);
  const fs = getAdminFirestore();
  for (const idt of normalized) {
    const existing = await findGuestByExternalIdentity(idt.key, idt.value);
    if (existing) {
      const ref = fs.collection("global_users").doc(existing);
      await fs.runTransaction(async (trx) => {
        const snap = await trx.get(ref);
        const prevIdentities = snap.exists ? ((snap.data()?.identities ?? {}) as Record<string, unknown>) : {};
        const systemRoleRaw = typeof snap.data()?.systemRole === "string" ? String(snap.data()!.systemRole).trim().toUpperCase() : "";
        const systemRole = systemRoleRaw === "STAFF" || systemRoleRaw === "ADMIN" ? systemRoleRaw : "GUEST";
        const nextIdentities: Record<string, string> = {};
        for (const x of normalized) nextIdentities[x.key] = x.value;
        trx.set(
          ref,
          {
            identities: { ...prevIdentities, ...nextIdentities },
            systemRole,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
      return existing;
    }
  }

  const ref = fs.collection("global_users").doc();
  const nextIdentities: Record<string, string> = {};
  for (const idt of normalized) nextIdentities[idt.key] = idt.value;
  await ref.set({
    identities: nextIdentities,
    systemRole: "GUEST",
    affiliations: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function linkIdentityToGlobalGuestUid(
  globalGuestUid: string,
  identity: GuestIdentityInput
): Promise<boolean> {
  const uid = String(globalGuestUid ?? "").trim();
  const value = normalizeIdentityValue(identity.key, identity.value);
  if (!uid || !value) return false;
  const fs = getAdminFirestore();
  const guestRef = fs.collection("global_users").doc(uid);

  await fs.runTransaction(async (trx) => {
    const guestSnap = await trx.get(guestRef);
    if (!guestSnap.exists) return;
    const prevIdentities = guestSnap.exists ? ((guestSnap.data()?.identities ?? {}) as Record<string, unknown>) : {};
    const systemRoleRaw = typeof guestSnap.data()?.systemRole === "string" ? String(guestSnap.data()!.systemRole).trim().toUpperCase() : "";
    const systemRole = systemRoleRaw === "STAFF" || systemRoleRaw === "ADMIN" ? systemRoleRaw : "GUEST";
    trx.set(
      guestRef,
      {
        identities: { ...prevIdentities, [identity.key]: value },
        systemRole,
        createdAt: guestSnap.data()?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  return true;
}
