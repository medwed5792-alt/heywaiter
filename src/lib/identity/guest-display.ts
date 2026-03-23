export function fallbackGuestNumber(uid: string): string {
  const raw = String(uid || "").trim();
  if (!raw) return "Гость №000";
  const tail = raw.replace(/\D/g, "").slice(-3);
  if (tail) return `Гость №${tail.padStart(3, "0")}`;
  const compact = raw.replace(/[^a-zA-Z0-9]/g, "").slice(-3);
  return `Гость №${(compact || "000").toUpperCase()}`;
}

export function resolveGuestDisplayName(args: {
  uid: string;
  currentUid?: string | null;
  currentUserName?: string | null;
  knownNamesByUid?: Record<string, string | undefined>;
}): string {
  const uid = String(args.uid || "").trim();
  if (!uid) return "Гость №000";

  const known = args.knownNamesByUid?.[uid]?.trim();
  if (known) return known;

  if (args.currentUid && uid === args.currentUid) {
    const me = String(args.currentUserName || "").trim();
    if (me) return me;
  }

  return fallbackGuestNumber(uid);
}

