/**
 * Парсинг контракта v_<venueId>_t_<tableId>[_vid_<visitorId>] (legacy).
 * venueId может содержать подчёркивания — граница venue|table: последний литерал "_t_" в строке
 * после префикса "v_".
 */
export function parseStartParamPayload(
  payload: string
): { venueId: string; tableId: string; visitorId?: string } | null {
  const s = payload?.trim();
  if (!s) return null;

  if (!s.startsWith("v_")) {
    const parts = s.split("_");
    if (parts.length >= 2) {
      return { venueId: parts[0], tableId: parts.slice(1).join("_") };
    }
    return null;
  }

  const rest = s.slice(2);
  const tMarker = "_t_";
  const lastT = rest.lastIndexOf(tMarker);
  if (lastT === -1) {
    const parts = s.split("_");
    if (parts.length >= 2) {
      return { venueId: parts[0], tableId: parts.slice(1).join("_") };
    }
    return null;
  }

  const venueId = rest.slice(0, lastT);
  const afterT = rest.slice(lastT + tMarker.length);

  const vidMarker = "_vid_";
  const vidIdx = afterT.indexOf(vidMarker);
  if (vidIdx !== -1) {
    const tableId = afterT.slice(0, vidIdx);
    const visitorId = afterT.slice(vidIdx + vidMarker.length);
    if (!venueId || !tableId || !visitorId) return null;
    return { venueId, tableId, visitorId };
  }

  if (!venueId || !afterT) return null;
  return { venueId, tableId: afterT };
}
