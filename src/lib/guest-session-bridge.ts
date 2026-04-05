/**
 * Клиент → POST /api/guest/session-context.
 * Telegram user id только из подписанного initData на сервере.
 */

const JSON_HDR = { "Content-Type": "application/json" } as const;

async function postSessionContext(body: Record<string, string>): Promise<Response> {
  return fetch("/api/guest/session-context", {
    method: "POST",
    headers: JSON_HDR,
    body: JSON.stringify(body),
  });
}

export type GuestRecoverSessionResponse =
  | { active: false }
  | { active: true; vrId: string; tableId: string; order_status?: string };

export async function guestSessionRecover(initData: string): Promise<GuestRecoverSessionResponse> {
  const res = await postSessionContext({ action: "recover", initData });
  const data = (await res.json().catch(() => ({}))) as GuestRecoverSessionResponse & { error?: string };
  if (!res.ok || data.active !== true || !data.vrId || !data.tableId) return { active: false };
  return { active: true, vrId: data.vrId, tableId: data.tableId, order_status: data.order_status };
}

export async function guestSessionClaim(initData: string, venueId: string, tableId: string): Promise<boolean> {
  const res = await postSessionContext({ action: "claim", initData, venueId, tableId });
  return res.ok;
}

export async function guestSessionClear(initData: string): Promise<void> {
  await postSessionContext({ action: "clear", initData }).catch(() => undefined);
}
