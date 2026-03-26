export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/superadmin-guard";
import { getAdminFirestore } from "@/lib/firebase-admin";

type RegistryKind = "venue" | "staff" | "guest";

function normalizePrefix(p: string): string {
  return p.trim().toUpperCase();
}

function kindByPrefix(prefix: string): RegistryKind | null {
  if (prefix === "VR") return "venue";
  if (prefix === "SW") return "staff";
  if (prefix === "GP" || prefix === "GN") return "guest";
  return null;
}

function buildPrefixRange(prefix: string) {
  const start = prefix;
  const end = prefix + "\uf8ff";
  return { start, end };
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const qRaw = (searchParams.get("q") ?? "").trim();
  const prefixRaw = (searchParams.get("prefix") ?? "").trim();

  const queryStr = normalizePrefix(qRaw);
  const prefix = normalizePrefix(prefixRaw || queryStr.slice(0, 2));
  const kind = kindByPrefix(prefix);
  if (!kind) {
    return NextResponse.json({ ok: false, error: "Unsupported prefix" }, { status: 400 });
  }
  if (!queryStr || queryStr.length < 2) {
    return NextResponse.json({ ok: true, kind, results: [] });
  }

  const firestore = getAdminFirestore();
  const { start, end } = buildPrefixRange(queryStr);

  const col =
    kind === "venue" ? "venues" : kind === "staff" ? "staff" : "global_users";

  const snap = await firestore
    .collection(col)
    .where("sotaId", ">=", start)
    .where("sotaId", "<=", end)
    .limit(25)
    .get();

  const results = snap.docs.map((d) => {
    const data = d.data() ?? {};
    return {
      kind,
      docId: d.id,
      sotaId: typeof data.sotaId === "string" ? data.sotaId : null,
      venueId: typeof data.venueId === "string" ? data.venueId : null,
      displayName:
        typeof data.name === "string"
          ? data.name
          : typeof data.displayName === "string"
            ? data.displayName
            : typeof data.title === "string"
              ? data.title
              : null,
    };
  });

  return NextResponse.json({ ok: true, kind, results });
}

