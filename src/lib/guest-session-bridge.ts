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

export async function guestSessionClear(initData: string): Promise<void> {
  await postSessionContext({ action: "clear", initData }).catch(() => undefined);
}
