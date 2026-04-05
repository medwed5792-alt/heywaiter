/**
 * Клиентские вызовы API «умной склейки» (active_sessions).
 * Тело запроса всегда с подписанным initData — tg id не доверяем с клиента отдельным полем.
 */

export type GuestRecoverSessionResponse =
  | { active: false }
  | { active: true; vrId: string; tableId: string; order_status?: string };

export async function guestSessionContextRecover(initData: string): Promise<GuestRecoverSessionResponse> {
  const res = await fetch("/api/guest/session-context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "recover", initData }),
  });
  const data = (await res.json().catch(() => ({}))) as GuestRecoverSessionResponse & { error?: string };
  if (!res.ok) return { active: false };
  if (data.active === true && data.vrId && data.tableId) {
    return { active: true, vrId: data.vrId, tableId: data.tableId, order_status: data.order_status };
  }
  return { active: false };
}

export async function guestSessionContextBind(
  initData: string,
  venueId: string,
  tableId: string
): Promise<boolean> {
  const res = await fetch("/api/guest/session-context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "bind", initData, venueId, tableId }),
  });
  return res.ok;
}

export async function guestSessionContextClear(initData: string): Promise<void> {
  await fetch("/api/guest/session-context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "clear", initData }),
  }).catch(() => undefined);
}
