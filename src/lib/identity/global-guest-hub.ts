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

function identityDocId(key: GuestIdentityKey, value: string): string {
  return `${key}:${value}`;
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

  const idxSnap = await fs.collection("global_guest_identities").doc(identityDocId(key, value)).get();
  if (idxSnap.exists) {
    const guestUid = typeof idxSnap.data()?.guestUid === "string" ? idxSnap.data()!.guestUid.trim() : "";
    if (guestUid) return guestUid;
  }

  const q = await fs.collection("global_guest_users").where(`identities.${key}`, "==", value).limit(1).get();
  if (q.empty) return null;
  return q.docs[0]!.id;
}

export async function resolveOrCreateGlobalGuestUid(identities: GuestIdentityInput[]): Promise<string> {
  const normalized = identities
    .map((x) => ({ key: x.key, value: normalizeIdentityValue(x.key, x.value) }))
    .filter((x) => x.value);
  if (normalized.length === 0) {
    const fs = getAdminFirestore();
    const ref = fs.collection("global_guest_users").doc();
    const guestUid = `gg:${ref.id}`;
    await ref.set({
      guestUid,
      identities: {},
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return guestUid;
  }

  const fs = getAdminFirestore();
  const idxRefs = normalized.map((x) =>
    fs.collection("global_guest_identities").doc(identityDocId(x.key, x.value))
  );

  const resolved = await fs.runTransaction(async (trx) => {
    const idxSnaps = await Promise.all(idxRefs.map((r) => trx.get(r)));
    const existing = idxSnaps
      .map((s) => (s.exists ? (typeof s.data()?.guestUid === "string" ? s.data()!.guestUid.trim() : "") : ""))
      .filter(Boolean);
    const guestUid = existing[0] || `gg:${fs.collection("global_guest_users").doc().id}`;
    const guestRef = fs.collection("global_guest_users").doc(guestUid.slice(3));
    const guestSnap = await trx.get(guestRef);
    const prevIdentities = guestSnap.exists ? ((guestSnap.data()?.identities ?? {}) as Record<string, unknown>) : {};
    const nextIdentities: Record<string, string> = {};
    for (const idt of normalized) nextIdentities[idt.key] = idt.value;

    trx.set(
      guestRef,
      {
        guestUid,
        identities: { ...prevIdentities, ...nextIdentities },
        createdAt: guestSnap.exists ? guestSnap.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    for (let i = 0; i < normalized.length; i++) {
      trx.set(
        idxRefs[i]!,
        {
          key: normalized[i]!.key,
          value: normalized[i]!.value,
          guestUid,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: idxSnaps[i]!.exists ? idxSnaps[i]!.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    return guestUid;
  });

  return resolved;
}

export async function linkIdentityToGlobalGuestUid(
  globalGuestUid: string,
  identity: GuestIdentityInput
): Promise<boolean> {
  const uid = String(globalGuestUid ?? "").trim();
  const value = normalizeIdentityValue(identity.key, identity.value);
  if (!uid.startsWith("gg:") || !value) return false;
  const docId = uid.slice(3);
  if (!docId) return false;
  const fs = getAdminFirestore();
  const guestRef = fs.collection("global_guest_users").doc(docId);
  const idxRef = fs.collection("global_guest_identities").doc(identityDocId(identity.key, value));

  await fs.runTransaction(async (trx) => {
    const guestSnap = await trx.get(guestRef);
    const prevIdentities = guestSnap.exists ? ((guestSnap.data()?.identities ?? {}) as Record<string, unknown>) : {};
    trx.set(
      guestRef,
      {
        guestUid: uid,
        identities: { ...prevIdentities, [identity.key]: value },
        createdAt: guestSnap.exists ? guestSnap.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    trx.set(
      idxRef,
      {
        key: identity.key,
        value,
        guestUid: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  return true;
}
