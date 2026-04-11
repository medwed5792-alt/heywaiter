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

export async function guestSessionClear(initData: string): Promise<void> {
  await postSessionContext({ action: "clear", initData }).catch(() => undefined);
}
