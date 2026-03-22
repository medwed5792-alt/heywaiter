/**
 * Парсинг start_param / QR для Mini App и ботов.
 *
 * Основной формат (короткий): `v:venueId:t:tableId` и опционально `:vid:visitorId`
 * Легаси: `v_venueId_t_tableId` и `..._vid_...`
 */

function parseColonPayload(
  payload: string
): { venueId: string; tableId: string; visitorId?: string } | null {
  const raw = payload?.trim() ?? "";
  const marker = ":t:";
  const i = raw.indexOf(marker);
  if (i === -1 || !raw.startsWith("v:")) return null;
  const venueId = raw.slice(2, i).trim();
  const afterT = raw.slice(i + marker.length);
  const vidSep = ":vid:";
  const vi = afterT.indexOf(vidSep);
  let tableId: string;
  let visitorId: string | undefined;
  if (vi === -1) {
    tableId = afterT.trim();
  } else {
    tableId = afterT.slice(0, vi).trim();
    visitorId = afterT.slice(vi + vidSep.length).trim();
  }
  if (!venueId || !tableId) return null;
  if (visitorId !== undefined && !visitorId) return null;
  return visitorId ? { venueId, tableId, visitorId } : { venueId, tableId };
}

function parseLegacyUnderscorePayload(
  payload: string
): { venueId: string; tableId: string; visitorId?: string } | null {
  const s = payload?.trim();
  if (!s) return null;

  const marker = "_t_";
  const idx = s.indexOf(marker);
  if (idx === -1) return null;

  let left = s.slice(0, idx);
  const rightRaw = s.slice(idx + marker.length);
  if (!rightRaw.trim()) return null;

  if (left.startsWith("v_")) {
    left = left.slice(2);
  }

  const venueId = left.trim();
  let tablePart = rightRaw.trim();
  if (!venueId || !tablePart) return null;

  const vidMarker = "_vid_";
  const vidIdx = tablePart.indexOf(vidMarker);
  if (vidIdx !== -1) {
    const tableId = tablePart.slice(0, vidIdx).trim();
    const visitorId = tablePart.slice(vidIdx + vidMarker.length).trim();
    if (!tableId || !visitorId) return null;
    return { venueId, tableId, visitorId };
  }

  return { venueId, tableId: tablePart };
}

export function parseStartParamPayload(
  payload: string
): { venueId: string; tableId: string; visitorId?: string } | null {
  const s = payload?.trim();
  if (!s) return null;
  const colon = parseColonPayload(s);
  if (colon) return colon;
  return parseLegacyUnderscorePayload(s);
}
