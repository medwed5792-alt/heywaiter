/**
 * Единая серверная нормализация ID стола.
 */
export function tableIdVariants(raw: string): string[] {
  const t = String(raw ?? "").trim();
  if (!t) return [];
  const out = new Set<string>([t]);
  if (/^\d+$/.test(t)) {
    out.add(String(parseInt(t, 10)));
    const stripped = t.replace(/^0+/, "");
    if (stripped) out.add(stripped);
  }
  return [...out];
}

export function normalizeTableId(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  if (/^\d+$/.test(t)) return String(parseInt(t, 10));
  return t;
}
