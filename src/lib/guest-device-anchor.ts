/**
 * Долгоживущий якорь гостя в браузере (localStorage).
 * Совпадает с ключом VisitorProvider — один id на устройство.
 */

const STORAGE_KEY = "heywaiter_visitor_id";

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Синхронно: для fetch до гидрации React (стабильный anon-якорь). */
export function getOrCreateGuestDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = generateId();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return generateId();
  }
}

export { STORAGE_KEY as GUEST_DEVICE_STORAGE_KEY };
