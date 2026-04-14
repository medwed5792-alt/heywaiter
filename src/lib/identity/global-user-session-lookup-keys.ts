/**
 * Только id документа global_users — без канальных алиасов и legacy-форм.
 */
export function canonicalGlobalUserLookupKeys(profileDocId: string): string[] {
  const id = String(profileDocId ?? "").trim();
  return id ? [id] : [];
}
