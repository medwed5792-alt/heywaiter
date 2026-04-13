/** Имя cookie с global_guest_uid для серверного check-in без ожидания клиентских ключей. */
export const HEYWAITER_GUEST_COOKIE = "hw_guest";

export function setClientGuestCookie(globalGuestUid: string): void {
  if (typeof document === "undefined") return;
  const v = encodeURIComponent(globalGuestUid.trim());
  if (!v) return;
  try {
    const maxAge = 60 * 60 * 24 * 400;
    document.cookie = `${HEYWAITER_GUEST_COOKIE}=${v}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } catch {
    // ignore
  }
}

export function getClientGuestCookie(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${HEYWAITER_GUEST_COOKIE}=([^;]*)`));
    const raw = m?.[1];
    if (!raw) return null;
    const v = decodeURIComponent(raw).trim();
    return v || null;
  } catch {
    return null;
  }
}
