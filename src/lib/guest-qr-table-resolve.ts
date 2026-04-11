import type { Firestore } from "firebase/firestore";
import { parseStartParamPayload } from "@/lib/parse-start-param";
import { parseSotaStartappPayload } from "@/lib/sota-id";
import { resolveSotaStartappToVenueTable } from "@/lib/sota-resolve";

async function resolveTableFromUrl(db: Firestore, u: URL): Promise<{ venueId: string; tableId: string } | null> {
  const path = u.pathname || "";
  if (path.includes("/check-in") || path.includes("/mini-app")) {
    const v = u.searchParams.get("v") || u.searchParams.get("venueId");
    const t =
      u.searchParams.get("t") || u.searchParams.get("tableId") || u.searchParams.get("tableRef") || "";
    if (v && v.trim()) return { venueId: v.trim(), tableId: t.trim() };
  }
  const startapp = u.searchParams.get("startapp");
  if (startapp) {
    const decoded = (() => {
      try {
        return decodeURIComponent(startapp.trim());
      } catch {
        return startapp.trim();
      }
    })();
    const sota = parseSotaStartappPayload(decoded);
    if (sota) {
      const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
      if (resolved) return { venueId: resolved.venueId, tableId: resolved.tableId || "" };
    }
    const legacy = parseStartParamPayload(decoded);
    if (legacy) return { venueId: legacy.venueId, tableId: legacy.tableId };
  }
  return null;
}

/**
 * Извлекает venueId/tableId из текста QR (URL, startapp, legacy payload) — без вызова check-in.
 */
export async function resolveGuestTableFromQrText(
  raw: string,
  db: Firestore
): Promise<{ venueId: string; tableId: string } | null> {
  const text = raw.trim();
  if (!text) return null;

  try {
    if (/^https?:\/\//i.test(text)) return await resolveTableFromUrl(db, new URL(text));
    if (text.includes("heywaiter.vercel.app")) {
      const normalized = text.startsWith("heywaiter.vercel.app")
        ? `https://${text}`
        : `https://${text.replace(/^\/+/, "")}`;
      return await resolveTableFromUrl(db, new URL(normalized));
    }
  } catch {
    // fall through to token / raw payloads
  }

  const startappMatch = text.match(/startapp=([^&\s]+)/i);
  if (startappMatch?.[1]) {
    const rawToken = startappMatch[1];
    const decoded = (() => {
      try {
        return decodeURIComponent(rawToken.trim());
      } catch {
        return rawToken.trim();
      }
    })();
    const sota = parseSotaStartappPayload(decoded);
    if (sota) {
      const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
      if (resolved) return { venueId: resolved.venueId, tableId: resolved.tableId || "" };
    }
    const legacy = parseStartParamPayload(decoded);
    if (legacy) return { venueId: legacy.venueId, tableId: legacy.tableId };
  }

  const legacy = parseStartParamPayload(text);
  if (legacy) return { venueId: legacy.venueId, tableId: legacy.tableId };
  const sota = parseSotaStartappPayload(text);
  if (sota) {
    const resolved = await resolveSotaStartappToVenueTable(db, sota.venueSotaId, sota.tableRef);
    if (resolved) return { venueId: resolved.venueId, tableId: resolved.tableId || "" };
  }
  return null;
}
