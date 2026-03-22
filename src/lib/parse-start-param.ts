/**
 * Парсинг start_param / QR: единственный разделитель смысла — литерал "_t_".
 * Слева — venueId целиком (после опционального префикса "v_"), справа — tableId и опционально legacy "_vid_".
 * Без "_t_" возвращаем null — без угадываний и подстановок (режим «Личный кабинет» в Mini App).
 */
export function parseStartParamPayload(
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
