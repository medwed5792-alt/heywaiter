"use client";

import { useState, useEffect, useCallback } from "react";
import { collection, query, where, getDocs, doc, getDoc, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { resolveVenueDisplayName } from "@/lib/venue-display";
import { parseStartParamPayload } from "@/lib/parse-start-param";
import { AdSpace } from "@/components/ads/AdSpace";
import { DEFAULT_VENUE_ID } from "@/lib/standards/venue-default";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        showScanQrPopup: (params: { text?: string }, callback: (text: string) => void) => void;
        close: () => void;
        initDataUnsafe?: { user?: { first_name?: string; last_name?: string; username?: string } };
      };
    };
  }
}

const APP_URL = typeof window !== "undefined" ? window.location.origin : "";

function parseQrPayload(text: string): { tableId: string } | null {
  const trimmed = text?.trim() ?? "";
  const fromVt = parseStartParamPayload(trimmed);
  if (fromVt) {
    return { tableId: fromVt.tableId };
  }
  const qp = trimmed.match(/v=([^&]+)&t=([^&]+)/);
  if (qp) return { tableId: qp[2] };
  return null;
}

interface GuestMainMenuProps {
  chatId?: string;
  platform?: string;
}

export function GuestMainMenu({ chatId, platform = "telegram" }: GuestMainMenuProps) {
  const [view, setView] = useState<
    "menu" | "history" | "scanner" | "monitor" | "booking" | "promos" | "rating" | "search" | "contact"
  >("menu");
  const [venues, setVenues] = useState<Array<{ id: string; name: string; address?: string }>>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string>("");
  const [freeTables, setFreeTables] = useState<Array<{ tableId: string; tableNumber?: number }>>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; address?: string; contact?: string }>>([]);
  const [promo, setPromo] = useState<{ text?: string; imageUrl?: string } | null>(null);
  const [rating, setRating] = useState<{ avg: number; count: number } | null>(null);
  const [bookingForm, setBookingForm] = useState({ date: "", startTime: "12:00", endTime: "14:00", seats: 2, guestName: "", guestContact: "" });
  const [bookingSubmit, setBookingSubmit] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  const [hubVenueTitle, setHubVenueTitle] = useState("");
  const [hubAdLocation, setHubAdLocation] = useState<string | undefined>(undefined);

  useEffect(() => {
    getDoc(doc(db, "venues", DEFAULT_VENUE_ID)).then((snap) => {
      const data = snap.data();
      setHubVenueTitle(resolveVenueDisplayName(snap.exists() ? data?.name : undefined));
      const r = typeof data?.adRegion === "string" ? data.adRegion.trim() : "";
      setHubAdLocation(r || undefined);
    });
  }, []);

  const guestName = typeof window !== "undefined" && window.Telegram?.WebApp?.initDataUnsafe?.user
    ? [window.Telegram.WebApp.initDataUnsafe.user.first_name, window.Telegram.WebApp.initDataUnsafe.user.last_name].filter(Boolean).join(" ") || "Гость"
    : "Гость";

  const openScanner = useCallback(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp?.showScanQrPopup) {
      window.Telegram.WebApp.showScanQrPopup({ text: "Отсканируйте QR-код стола" }, (text) => {
        const parsed = parseQrPayload(text);
        if (parsed) {
          window.location.href = `${APP_URL}/check-in/panel?v=${DEFAULT_VENUE_ID}&t=${parsed.tableId}&chatId=${chatId ?? ""}&platform=${platform}`;
        }
      });
    } else {
      setView("scanner");
    }
  }, [chatId, platform]);

  useEffect(() => {
    if (view !== "monitor" && view !== "booking" && view !== "promos" && view !== "rating") return;
    getDocs(collection(db, "venues")).then((snap) => {
      setVenues(snap.docs.map((d) => ({ id: d.id, name: resolveVenueDisplayName(d.data().name), address: d.data().address as string | undefined })));
      if (!selectedVenueId && snap.docs[0]) setSelectedVenueId(snap.docs[0].id);
    });
  }, [view, selectedVenueId]);

  useEffect(() => {
    if (view !== "monitor" || !selectedVenueId) return;
    Promise.all([
      getDocs(query(collection(db, "tables"), where("venueId", "==", selectedVenueId))),
      getDocs(query(collection(db, "activeSessions"), where("venueId", "==", selectedVenueId), where("status", "==", "check_in_success"))),
    ]).then(([tablesSnap, sessionsSnap]) => {
      const occupied = new Set(sessionsSnap.docs.map((d) => d.data().tableId ?? ""));
      const free = tablesSnap.docs
        .filter((d) => !occupied.has(d.data().tableId ?? d.id))
        .map((d) => ({ tableId: (d.data().tableId ?? d.id) as string, tableNumber: d.data().tableNumber as number | undefined }));
      setFreeTables(free);
    });
  }, [view, selectedVenueId]);

  useEffect(() => {
    if (view !== "promos" || !selectedVenueId) return;
    getDoc(doc(db, "venues", selectedVenueId)).then((snap) => {
      const config = snap.data()?.config as { promos?: { text?: string; imageUrl?: string } } | undefined;
      setPromo(config?.promos ?? null);
    });
  }, [view, selectedVenueId]);

  useEffect(() => {
    if (view !== "rating" || !selectedVenueId) return;
    getDocs(query(collection(db, "reviews"), where("venueId", "==", selectedVenueId))).then((snap) => {
      if (snap.empty) { setRating({ avg: 0, count: 0 }); return; }
      let sum = 0;
      snap.docs.forEach((d) => { sum += (d.data().stars as number) ?? 0; });
      setRating({ avg: sum / snap.size, count: snap.size });
    });
  }, [view, selectedVenueId]);

  const doSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    fetch(`/api/venues/search?q=${encodeURIComponent(searchQuery.trim())}`)
      .then((r) => r.json())
      .then((data) => setSearchResults(data.venues ?? []))
      .catch(() => setSearchResults([]));
  }, [searchQuery]);

  const sendContact = useCallback(() => {
    addDoc(collection(db, "staffNotifications"), {
      venueId: "current",
      tableId: "",
      type: "guest_contact",
      message: `Гость ${guestName} хочет связаться`,
      read: false,
      targetUids: [],
      payload: { chatId, platform },
      createdAt: serverTimestamp(),
    }).then(() => setContactSent(true));
  }, [chatId, platform, guestName]);

  const submitBooking = useCallback(() => {
    if (!selectedVenueId || !bookingForm.date) return;
    fetch("/api/bookings/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venueId: selectedVenueId,
        guestName: bookingForm.guestName,
        guestContact: bookingForm.guestContact,
        seats: bookingForm.seats,
        date: bookingForm.date,
        startTime: bookingForm.startTime,
        endTime: bookingForm.endTime,
      }),
    })
      .then((r) => r.json())
      .then((data) => { if (data.ok) setBookingSubmit(true); })
      .catch(() => {});
  }, [selectedVenueId, bookingForm]);

  if (view === "history") {
    return (
      <main className="min-h-screen bg-slate-50 p-6" style={{ zoom: 0.75 }}>
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => setView("menu")} className="mb-4 text-sm text-gray-600 underline">
            ← Меню
          </button>
          <h2 className="text-lg font-bold text-gray-900">📋 История</h2>
          <p className="mt-4 text-sm text-gray-600">
            Здесь появится история ваших визитов и заказов.
          </p>
        </div>
      </main>
    );
  }

  if (view === "search") {
    return (
      <main className="min-h-screen bg-slate-50 p-6" style={{ zoom: 0.75 }}>
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => setView("menu")} className="mb-4 text-sm text-gray-600 underline">← Меню</button>
          <h2 className="text-lg font-bold text-gray-900">🔍 Поиск заведения</h2>
          <input
            type="text"
            placeholder="Название или адрес"
            className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
          <button type="button" onClick={doSearch} className="mt-2 w-full rounded-xl bg-gray-900 py-2 text-sm text-white">Найти</button>
          <ul className="mt-4 space-y-2">
            {searchResults.map((v) => (
              <li key={v.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="font-medium text-gray-900">{v.name}</p>
                {v.address && <p className="text-xs text-gray-600">{v.address}</p>}
                {v.contact && <p className="mt-1 text-sm text-blue-600">{v.contact}</p>}
              </li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  if (view === "contact") {
    return (
      <main className="min-h-screen bg-slate-50 p-6" style={{ zoom: 0.75 }}>
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => setView("menu")} className="mb-4 text-sm text-gray-600 underline">← Меню</button>
          <h2 className="text-lg font-bold text-gray-900">📞 Связаться</h2>
          {contactSent ? (
            <p className="mt-4 text-sm text-green-600">Запрос отправлен. С вами свяжутся.</p>
          ) : (
            <button type="button" onClick={sendContact} className="mt-4 w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white">Отправить запрос на связь</button>
          )}
        </div>
      </main>
    );
  }

  if (view === "promos" && selectedVenueId) {
    return (
      <main className="min-h-screen bg-slate-50 p-6" style={{ zoom: 0.75 }}>
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => setView("menu")} className="mb-4 text-sm text-gray-600 underline">← Меню</button>
          <select value={selectedVenueId} onChange={(e) => setSelectedVenueId(e.target.value)} className="mb-4 w-full rounded border border-gray-300 px-2 py-1 text-sm">
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <h2 className="text-lg font-bold text-gray-900">🎁 Акции</h2>
          {promo ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
              {promo.imageUrl && <img src={promo.imageUrl} alt="" className="mb-2 max-h-40 w-full object-cover rounded" />}
              {promo.text && <p className="text-sm text-gray-700">{promo.text}</p>}
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500">Нет активных акций.</p>
          )}
        </div>
      </main>
    );
  }

  if (view === "rating" && selectedVenueId) {
    return (
      <main className="min-h-screen bg-slate-50 p-6" style={{ zoom: 0.75 }}>
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => setView("menu")} className="mb-4 text-sm text-gray-600 underline">← Меню</button>
          <select value={selectedVenueId} onChange={(e) => setSelectedVenueId(e.target.value)} className="mb-4 w-full rounded border border-gray-300 px-2 py-1 text-sm">
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <h2 className="text-lg font-bold text-gray-900">⭐ Рейтинг</h2>
          {rating ? (
            <p className="mt-4 text-2xl font-bold text-gray-900">{rating.avg.toFixed(1)} ★ ({rating.count} отзывов)</p>
          ) : (
            <p className="mt-4 text-sm text-gray-500">Нет отзывов.</p>
          )}
        </div>
      </main>
    );
  }

  if (view === "monitor") {
    return (
      <main className="min-h-screen bg-slate-50 p-6" style={{ zoom: 0.75 }}>
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => setView("menu")} className="mb-4 text-sm text-gray-600 underline">← Меню</button>
          <h2 className="text-lg font-bold text-gray-900">📍 Монитор мест</h2>
          <select value={selectedVenueId} onChange={(e) => setSelectedVenueId(e.target.value)} className="mt-2 mb-4 w-full rounded border border-gray-300 px-2 py-1 text-sm">
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <p className="text-sm text-gray-600">Свободные столы:</p>
          <ul className="mt-2 space-y-1">
            {freeTables.map((t) => (
              <li key={t.tableId} className="rounded border border-gray-200 bg-white px-3 py-2 text-sm">Стол №{t.tableNumber ?? t.tableId}</li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  if (view === "booking") {
    return (
      <main className="min-h-screen bg-slate-50 p-6" style={{ zoom: 0.75 }}>
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => setView("menu")} className="mb-4 text-sm text-gray-600 underline">← Меню</button>
          <h2 className="text-lg font-bold text-gray-900">📅 Бронирование</h2>
          <select value={selectedVenueId} onChange={(e) => setSelectedVenueId(e.target.value)} className="mt-2 mb-2 w-full rounded border border-gray-300 px-2 py-1 text-sm">
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          {bookingSubmit ? (
            <p className="mt-4 text-sm text-green-600">Заявка отправлена. Ожидайте подтверждения.</p>
          ) : (
            <>
              <label className="mt-2 block text-xs text-gray-600">Дата</label>
              <input type="date" className="w-full rounded border px-2 py-1.5 text-sm" value={bookingForm.date} onChange={(e) => setBookingForm((p) => ({ ...p, date: e.target.value }))} />
              <label className="mt-2 block text-xs text-gray-600">Время с — по</label>
              <div className="flex gap-2">
                <input type="time" className="flex-1 rounded border px-2 py-1.5 text-sm" value={bookingForm.startTime} onChange={(e) => setBookingForm((p) => ({ ...p, startTime: e.target.value }))} />
                <input type="time" className="flex-1 rounded border px-2 py-1.5 text-sm" value={bookingForm.endTime} onChange={(e) => setBookingForm((p) => ({ ...p, endTime: e.target.value }))} />
              </div>
              <label className="mt-2 block text-xs text-gray-600">Места</label>
              <input type="number" min={1} className="w-full rounded border px-2 py-1.5 text-sm" value={bookingForm.seats} onChange={(e) => setBookingForm((p) => ({ ...p, seats: Number(e.target.value) }))} />
              <label className="mt-2 block text-xs text-gray-600">Ваше имя</label>
              <input className="w-full rounded border px-2 py-1.5 text-sm" value={bookingForm.guestName} onChange={(e) => setBookingForm((p) => ({ ...p, guestName: e.target.value }))} />
              <label className="mt-2 block text-xs text-gray-600">Контакт (телефон / соцсеть)</label>
              <input className="w-full rounded border px-2 py-1.5 text-sm" value={bookingForm.guestContact} onChange={(e) => setBookingForm((p) => ({ ...p, guestContact: e.target.value }))} />
              <button type="button" onClick={submitBooking} className="mt-4 w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white">Отправить заявку</button>
            </>
          )}
        </div>
      </main>
    );
  }

  if (view === "scanner") {
    return (
      <main className="min-h-screen bg-slate-50 p-6" style={{ zoom: 0.75 }}>
        <div className="mx-auto max-w-md text-center">
          <button type="button" onClick={() => setView("menu")} className="mb-4 text-sm text-gray-600 underline">← Меню</button>
          <p className="text-gray-600">Сканирование QR доступно в приложении Telegram. Откройте бота и нажмите «Сканер QR» снова.</p>
        </div>
      </main>
    );
  }

  const cabinetButtons = [
    { id: "history" as const, label: "📋 История", onClick: () => setView("history") },
    { id: "promos" as const, label: "🎁 Акции", onClick: () => setView("promos") },
    { id: "rating" as const, label: "⭐ Рейтинг", onClick: () => setView("rating") },
  ];

  const serviceButtons = [
    { id: "scanner" as const, label: "📸 Сканер QR", onClick: openScanner },
    { id: "monitor" as const, label: "📍 Монитор мест", onClick: () => setView("monitor") },
    { id: "booking" as const, label: "📅 Бронирование", onClick: () => setView("booking") },
    { id: "search" as const, label: "🔍 Поиск", onClick: () => setView("search") },
    { id: "contact" as const, label: "📞 Связаться", onClick: () => setView("contact") },
  ];

  return (
    <main className="min-h-screen bg-slate-50 p-6" style={{ zoom: 0.75 }}>
      <div className="mx-auto max-w-md">
        <h1 className="mb-4 text-lg font-bold text-gray-900">{hubVenueTitle || "HeyWaiter"}</h1>
        <p className="mb-4 text-sm text-gray-500">Выберите действие</p>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Личный кабинет</p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={cabinetButtons[0].onClick}
            className="w-full rounded-xl border border-gray-200 bg-white py-3 px-4 text-left text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
          >
            {cabinetButtons[0].label}
          </button>
          <AdSpace placement="guest_hub_between_history_promos" venueId={DEFAULT_VENUE_ID} location={hubAdLocation} />
          <button
            type="button"
            onClick={cabinetButtons[1].onClick}
            className="w-full rounded-xl border border-gray-200 bg-white py-3 px-4 text-left text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
          >
            {cabinetButtons[1].label}
          </button>
          <AdSpace placement="guest_hub_between_promos_rating" venueId={DEFAULT_VENUE_ID} location={hubAdLocation} />
          <button
            type="button"
            onClick={cabinetButtons[2].onClick}
            className="w-full rounded-xl border border-gray-200 bg-white py-3 px-4 text-left text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
          >
            {cabinetButtons[2].label}
          </button>
        </div>
        <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Сервисы</p>
        <div className="space-y-2">
          {serviceButtons.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={btn.onClick}
              className="w-full rounded-xl border border-gray-200 bg-white py-3 px-4 text-left text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
