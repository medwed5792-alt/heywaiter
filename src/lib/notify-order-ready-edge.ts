/**
 * Уведомление «заказ готов» через Firestore REST API + Telegram API.
 * Только fetch, без firebase/firebase-admin — для Edge runtime (избегаем SyntaxError # в Node-бандле).
 */
const TELEGRAM_API = "https://api.telegram.org/bot";

export async function notifyOrderReadyEdge(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const token = process.env.TELEGRAM_CLIENT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "Нет токена бота" };
  if (!projectId) return { ok: false, error: "Нет projectId" };

  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/orders/${orderId}`;
  const res = await fetch(firestoreUrl, {
    headers: { Authorization: `Bearer ${await getGoogleAccessToken()}` },
  });
  if (!res.ok) {
    if (res.status === 404) return { ok: false, error: "Заказ не найден" };
    return { ok: false, error: "Ошибка чтения заказа" };
  }
  const doc = (await res.json()) as { fields?: Record<string, { stringValue?: string; integerValue?: string }> };
  const fields = doc.fields ?? {};
  const getStr = (k: string) => fields[k]?.stringValue ?? "";
  const status = getStr("status");
  if (status !== "pending") return { ok: false, error: "Заказ уже обработан" };
  const guestChatId = getStr("guestChatId");
  const orderNum = fields.orderNumber?.integerValue ?? orderId;
  if (!guestChatId) return { ok: false, error: "Нет guestChatId в заказе" };

  const text = `🍔 Заказ №${orderNum} готов! Заберите на выдаче!`;
  const tgRes = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: guestChatId, text }),
  });
  const tgData = (await tgRes.json().catch(() => ({}))) as { ok?: boolean };
  if (!tgRes.ok || !tgData.ok) return { ok: false, error: "Не удалось отправить уведомление" };

  const patchUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/orders/${orderId}?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt`;
  const now = new Date().toISOString();
  await fetch(patchUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${await getGoogleAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        status: { stringValue: "ready" },
        updatedAt: { timestampValue: now },
      },
    }),
  });
  return { ok: true };
}

async function getGoogleAccessToken(): Promise<string> {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!key) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON not set");
  let serviceAccount: { client_email?: string; private_key?: string };
  try {
    serviceAccount = JSON.parse(key);
  } catch {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON");
  }
  const jwt = await createSignedJwt(serviceAccount);
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(data.error ?? "Failed to get access token");
  return data.access_token;
}

async function createSignedJwt(sa: { client_email?: string; private_key?: string }): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore",
  };
  const b64 = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const message = `${b64(header)}.${b64(payload)}`;
  const pem = (sa.private_key ?? "").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binaryKey = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(message)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${message}.${sigB64}`;
}
