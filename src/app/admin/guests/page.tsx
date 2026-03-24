"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import toast from "react-hot-toast";
import { collection, doc, addDoc, updateDoc, getDoc, query, where, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { StickyNote } from "lucide-react";
import { db } from "@/lib/firebase";
import type { Guest, GuestType } from "@/lib/types";
import type { MessengerChannel } from "@/lib/types";
import { DEFAULT_VENUE_ID as VENUE_ID } from "@/lib/standards/venue-default";
import { generateSotaId, type GuestSubtype } from "@/lib/sota-id";
const GLOBAL_GUESTS_BATCH = 30;
const DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const CHANNEL_FIELD: Record<MessengerChannel, keyof Guest> = {
  telegram: "tgId",
  whatsapp: "waId",
  vk: "vkId",
  viber: "viberId",
  wechat: "wechatId",
  instagram: "instagramId",
  facebook: "facebookId",
  line: "lineId",
};
const CHANNEL_LABEL: Record<MessengerChannel, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  vk: "VK",
  viber: "Viber",
  wechat: "WeChat",
  instagram: "Instagram",
  facebook: "Facebook",
  line: "Line",
};

const GUEST_TYPES: { value: GuestType; label: string }[] = [
  { value: "regular", label: "Новый (Чужой)" },
  { value: "constant", label: "Постоянный" },
  { value: "favorite", label: "Любимый" },
  { value: "vip", label: "VIP" },
  { value: "blacklisted", label: "ЧС" },
];

const OWN_TYPES: GuestType[] = ["constant", "favorite", "vip", "blacklisted"];

function isOwnType(g: Guest): boolean {
  return OWN_TYPES.includes(g.type ?? "regular");
}

function guestSubtypeForSota(t: GuestType): GuestSubtype {
  if (t === "vip") return "V";
  if (t === "regular") return "N";
  return "P";
}

function lastVisitWithin7Days(g: Guest): boolean {
  const v = g.lastVisitAt;
  if (v == null) return true;
  const ms = typeof v === "object" && "toMillis" in v ? (v as { toMillis: () => number }).toMillis() : new Date(String(v)).getTime();
  return Date.now() - ms <= DAYS_MS;
}

export default function AdminGuestsPage() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [sessions, setSessions] = useState<{ guestId?: string; tableId: string; tableNumber: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | "new" | "own" | "vip" | "blacklisted">("all");
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [globalScores, setGlobalScores] = useState<Record<string, number>>({});

  useEffect(() => {
    const unsubG = onSnapshot(collection(db, "venues", VENUE_ID, "guests"), (snap) => {
      setGuests(
        snap.docs.map((d) => {
          const data = d.data();
          return { id: d.id, ...data, type: (data.type as GuestType) || "regular", note: data.note as string | undefined } as Guest;
        })
      );
      setLoading(false);
    });
    return () => unsubG();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "activeSessions"),
      where("venueId", "==", VENUE_ID),
      where("status", "==", "check_in_success")
    );
    const unsub = onSnapshot(q, (snap) => {
      setSessions(snap.docs.map((d) => {
        const data = d.data();
        return { guestId: data.guestId, tableId: data.tableId ?? "", tableNumber: data.tableNumber ?? 0 };
      }));
    });
    return () => unsub();
  }, []);

  const inHallGuestIds = useMemo(() => new Set(sessions.map((s) => s.guestId).filter(Boolean)), [sessions]);

  const visibleGuests = useMemo(() => {
    const filtered = guests.filter((g) => {
      const inHall = inHallGuestIds.has(g.id);
      const own = isOwnType(g);
      const recent = lastVisitWithin7Days(g);
      if (!inHall && !own && !recent) return false;
      if (!own && g.lastVisitAt != null && !recent) return false;
      if (typeFilter === "new") return g.type === "regular";
      if (typeFilter === "own") return own;
      if (typeFilter === "vip") return g.type === "vip";
      if (typeFilter === "blacklisted") return g.type === "blacklisted";
      return true;
    });
    const typeOrder: Record<GuestType, number> = { constant: 0, favorite: 1, vip: 2, blacklisted: 3, regular: 4 };
    return [...filtered].sort((a, b) => (typeOrder[a.type ?? "regular"] ?? 4) - (typeOrder[b.type ?? "regular"] ?? 4));
  }, [guests, inHallGuestIds, typeFilter]);

  const newGuests = useMemo(() => visibleGuests.filter((g) => g.type === "regular"), [visibleGuests]);
  const ownGuests = useMemo(() => visibleGuests.filter((g) => isOwnType(g)), [visibleGuests]);

  const visibleGuestIds = useMemo(() => visibleGuests.map((g) => g.id).sort().join(","), [visibleGuests]);

  const convertToOwn = useCallback(async (g: Guest) => {
    try {
      await updateDoc(doc(db, "venues", VENUE_ID, "guests", g.id), { type: "constant", updatedAt: serverTimestamp() });
      setEditingGuest({ ...g, type: "constant" });
      toast.success("Гость переведён в «Свои». Заполните доп. данные при необходимости.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    }
  }, []);

  useEffect(() => {
    if (visibleGuestIds === "") {
      setGlobalScores({});
      return;
    }
    const ids = visibleGuests.map((g) => g.id);
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += GLOBAL_GUESTS_BATCH) {
      batches.push(ids.slice(i, i + GLOBAL_GUESTS_BATCH));
    }
    let cancelled = false;
    (async () => {
      const map: Record<string, number> = {};
      for (const batch of batches) {
        if (cancelled) return;
        const snaps = await Promise.all(batch.map((id) => getDoc(doc(db, "global_guests", id))));
        snaps.forEach((snap, i) => {
          const id = batch[i];
          if (!id) return;
          const data = snap.exists() ? snap.data() : {};
          const score = data.globalGuestScore;
          if (typeof score === "number") map[id] = Math.round(score * 10) / 10;
        });
      }
      if (!cancelled) setGlobalScores(map);
    })();
    return () => { cancelled = true; };
  }, [visibleGuestIds, visibleGuests]);

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Гости</h2>
      <p className="mt-2 text-sm text-gray-600">
        Только гости за последние 7 дней + в зале сейчас. Тип «Свой» (Постоянный, VIP, Любимый, ЧС) не скрывается по TTL.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Тип:</span>
          <select
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          >
            <option value="all">Все</option>
            <option value="new">Новый (Чужой)</option>
            <option value="own">Свой (Постоянный, VIP, Любимый, ЧС)</option>
            <option value="vip">Только VIP</option>
            <option value="blacklisted">Только ЧС</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          onClick={() => setAddingNew(true)}
        >
          + Добавить гостя
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <p className="p-6 text-sm text-gray-500">Загрузка…</p>
        ) : visibleGuests.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">Нет гостей по выбранным условиям</p>
        ) : typeFilter === "all" ? (
          <div className="divide-y divide-gray-200">
            <section className="p-4">
              <h3 className="text-sm font-semibold text-gray-700">Новые</h3>
              <p className="text-xs text-gray-500 mt-0.5">Попали в базу через бронь впервые</p>
              {newGuests.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">Нет новых гостей</p>
              ) : (
                <table className="w-full min-w-[500px] mt-2">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="p-3 text-left text-xs font-medium text-gray-600">ФИО / Контакт</th>
                      <th className="p-3 text-left text-xs font-medium text-gray-600">Рейтинг</th>
                      <th className="p-3 text-left text-xs font-medium text-gray-600">В зале</th>
                      <th className="p-3 text-left text-xs font-medium text-gray-600">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {newGuests.map((g) => (
                      <tr key={g.id} className="border-b border-gray-100">
                        <td className="p-3 text-sm flex items-center gap-1.5">
                          {g.note?.trim() ? <span title="Есть примечание"><StickyNote className="h-4 w-4 shrink-0 text-amber-600" /></span> : null}
                          {g.name || g.nickname || g.phone || g.id.slice(0, 8)}
                        </td>
                        <td className="p-3 text-xs text-gray-700">{globalScores[g.id] != null ? String(globalScores[g.id]) : "—"}</td>
                        <td className="p-3 text-xs">{inHallGuestIds.has(g.id) ? "Да" : "—"}</td>
                        <td className="p-3 flex flex-wrap gap-1">
                          <button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50" onClick={() => setEditingGuest(g)}>Редактировать</button>
                          <button type="button" className="rounded border border-emerald-600 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50" onClick={() => convertToOwn(g)}>Перевести в Свои</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="p-4">
              <h3 className="text-sm font-semibold text-gray-700">Свои</h3>
              <p className="text-xs text-gray-500 mt-0.5">Постоянные гости с заполненными профилями</p>
              {ownGuests.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">Нет гостей в категории «Свои»</p>
              ) : (
                <table className="w-full min-w-[500px] mt-2">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="p-3 text-left text-xs font-medium text-gray-600">ФИО / Контакт</th>
                      <th className="p-3 text-left text-xs font-medium text-gray-600">Тип</th>
                      <th className="p-3 text-left text-xs font-medium text-gray-600">Рейтинг</th>
                      <th className="p-3 text-left text-xs font-medium text-gray-600">В зале</th>
                      <th className="p-3 text-left text-xs font-medium text-gray-600">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ownGuests.map((g) => (
                      <tr key={g.id} className="border-b border-gray-100">
                        <td className="p-3 text-sm flex items-center gap-1.5">
                          {g.note?.trim() ? <span title="Есть примечание"><StickyNote className="h-4 w-4 shrink-0 text-amber-600" /></span> : null}
                          {g.name || g.nickname || g.phone || g.id.slice(0, 8)}
                        </td>
                        <td className="p-3 text-xs text-gray-600">{GUEST_TYPES.find((t) => t.value === g.type)?.label ?? g.type}</td>
                        <td className="p-3 text-xs text-gray-700">{globalScores[g.id] != null ? String(globalScores[g.id]) : "—"}</td>
                        <td className="p-3 text-xs">{inHallGuestIds.has(g.id) ? "Да" : "—"}</td>
                        <td className="p-3">
                          <button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50" onClick={() => setEditingGuest(g)}>Редактировать</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        ) : (
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="p-3 text-left text-xs font-medium text-gray-600">ФИО / Контакт</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Тип</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Рейтинг</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">В зале</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Действие</th>
              </tr>
            </thead>
            <tbody>
              {visibleGuests.map((g) => (
                <tr key={g.id} className="border-b border-gray-100">
                  <td className="p-3 text-sm flex items-center gap-1.5">
                    {g.note?.trim() ? <span title="Есть примечание"><StickyNote className="h-4 w-4 shrink-0 text-amber-600" /></span> : null}
                    {g.name || g.nickname || g.phone || g.id.slice(0, 8)}
                  </td>
                  <td className="p-3 text-xs text-gray-600">{GUEST_TYPES.find((t) => t.value === g.type)?.label ?? g.type}</td>
                  <td className="p-3 text-xs text-gray-700">{globalScores[g.id] != null ? String(globalScores[g.id]) : "—"}</td>
                  <td className="p-3 text-xs">{inHallGuestIds.has(g.id) ? "Да" : "—"}</td>
                  <td className="p-3 flex flex-wrap gap-1">
                    <button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50" onClick={() => setEditingGuest(g)}>Редактировать</button>
                    {g.type === "regular" && (
                      <button type="button" className="rounded border border-emerald-600 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50" onClick={() => convertToOwn(g)}>Перевести в Свои</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(editingGuest || addingNew) && (
        <GuestCardModal
          guest={editingGuest ?? undefined}
          venueId={VENUE_ID}
          onClose={() => { setEditingGuest(null); setAddingNew(false); }}
          onSaved={() => { setEditingGuest(null); setAddingNew(false); }}
          onRatingSaved={(guestId, newScore) => setGlobalScores((prev) => ({ ...prev, [guestId]: newScore }))}
        />
      )}
    </div>
  );
}

function GuestCardModal({
  guest,
  venueId,
  onClose,
  onSaved,
  onRatingSaved,
}: {
  guest?: Guest;
  venueId: string;
  onClose: () => void;
  onSaved: () => void;
  onRatingSaved?: (guestId: string, newScore: number) => void;
}) {
  const [name, setName] = useState(guest?.name ?? "");
  const [gender, setGender] = useState(guest?.gender ?? "");
  const [birthday, setBirthday] = useState(guest?.birthday ?? "");
  const [phone, setPhone] = useState(guest?.phone ?? "");
  const [type, setType] = useState<GuestType>(guest?.type ?? "regular");
  const [note, setNote] = useState(guest?.note ?? "");
  const [channelIds, setChannelIds] = useState<Record<MessengerChannel, string>>({
    telegram: guest?.tgId ?? "",
    whatsapp: guest?.waId ?? "",
    vk: guest?.vkId ?? "",
    viber: guest?.viberId ?? "",
    wechat: guest?.wechatId ?? "",
    instagram: guest?.instagramId ?? "",
    facebook: guest?.facebookId ?? "",
    line: guest?.lineId ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [globalGuestScore, setGlobalGuestScore] = useState<number | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);
  const [newRating, setNewRating] = useState<number | null>(null);

  useEffect(() => {
    if (!guest?.id) {
      setGlobalGuestScore(null);
      return;
    }
    getDoc(doc(db, "global_guests", guest.id)).then((snap) => {
      const data = snap.exists() ? snap.data() : {};
      const score = data.globalGuestScore;
      setGlobalGuestScore(typeof score === "number" ? Math.round(score * 10) / 10 : null);
    });
  }, [guest?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const venueId = VENUE_ID;
      const payload: Record<string, unknown> = {
        name: name.trim() || null,
        gender: gender || null,
        birthday: birthday || null,
        phone: phone.trim() || null,
        type,
        note: note.trim() || null,
        venueId,
        tgId: channelIds.telegram.trim() || null,
        waId: channelIds.whatsapp.trim() || null,
        vkId: channelIds.vk.trim() || null,
        viberId: channelIds.viber.trim() || null,
        wechatId: channelIds.wechat.trim() || null,
        instagramId: channelIds.instagram.trim() || null,
        facebookId: channelIds.facebook.trim() || null,
        lineId: channelIds.line.trim() || null,
        updatedAt: serverTimestamp(),
      };
      if (guest?.id) {
        if (!guest.sotaId?.trim()) {
          payload.sotaId = generateSotaId("G", guestSubtypeForSota(type));
        }
        await updateDoc(doc(db, "venues", venueId, "guests", guest.id), payload);
        toast.success("Гость сохранён");
      } else {
        payload.sotaId = generateSotaId("G", guestSubtypeForSota(type));
        await addDoc(collection(db, "venues", venueId, "guests"), { ...payload, createdAt: serverTimestamp() });
        toast.success("Гость добавлен");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRating = async () => {
    if (!guest?.id || newRating == null) return;
    setRatingSaving(true);
    try {
      const ref = doc(db, "global_guests", guest.id);
      const snap = await getDoc(ref);
      const data = snap.exists() ? snap.data() : {};
      const ratings: number[] = Array.isArray(data.ratings) ? data.ratings : [];
      const newRatings = [...ratings, newRating];
      const sum = newRatings.reduce((a, b) => a + b, 0);
      const avg = Math.round((sum / newRatings.length) * 10) / 10;
      await setDoc(ref, { ratings: newRatings, globalGuestScore: avg }, { merge: true });
      setGlobalGuestScore(avg);
      setNewRating(null);
      onRatingSaved?.(guest.id, avg);
      toast.success("Оценка сохранена");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сохранения оценки");
    } finally {
      setRatingSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-lg">
        <div className="border-b border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900">{guest ? "Редактировать гостя" : "Новый гость"}</h3>
          {guest?.sotaId?.trim() ? (
            <p className="mt-1 font-mono text-xs text-violet-700" title="SOTA-ID">
              {guest.sotaId.trim()}
            </p>
          ) : null}
        </div>
        <form onSubmit={handleSave} className="p-4 space-y-4">
          <label className="block">
            <span className="block text-xs font-medium text-gray-600">ФИО</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" placeholder="Имя Фамилия" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="block text-xs font-medium text-gray-600">Пол</span>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm">
                <option value="">—</option>
                <option value="male">М</option>
                <option value="female">Ж</option>
              </select>
            </label>
            <label>
              <span className="block text-xs font-medium text-gray-600">Дата рождения</span>
              <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600">Телефон</span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600">Тип</span>
            <select value={type} onChange={(e) => setType(e.target.value as GuestType)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm">
              {GUEST_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600">Примечание</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm min-h-[80px]" placeholder="Заметка о госте для бронирования и дашборда" />
          </label>
          {guest?.id && (
            <div className="block">
              <span className="block text-xs font-medium text-gray-600">Рейтинг гостя (ЛПР)</span>
              {globalGuestScore != null && (
                <p className="mt-1 text-sm text-gray-700">Средний балл: <strong>{globalGuestScore}</strong></p>
              )}
              <div className="mt-2 flex items-center gap-2">
                {([1, 2, 3, 4, 5] as const).map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`rounded border px-2 py-1 text-sm ${newRating === star ? "border-amber-500 bg-amber-50 text-amber-700" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"}`}
                    onClick={() => setNewRating(star)}
                  >
                    {star} ★
                  </button>
                ))}
                <button
                  type="button"
                  disabled={newRating == null || ratingSaving}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  onClick={handleSaveRating}
                >
                  {ratingSaving ? "…" : "Поставить оценку"}
                </button>
              </div>
            </div>
          )}
          <div>
            <span className="block text-xs font-medium text-gray-600 mb-2">ID соцсетей (8 каналов)</span>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(CHANNEL_LABEL) as MessengerChannel[]).map((ch) => (
                <label key={ch} className="flex items-center gap-2">
                  <span className="w-20 text-xs text-gray-500">{CHANNEL_LABEL[ch]}</span>
                  <input
                    type="text"
                    value={channelIds[ch]}
                    onChange={(e) => setChannelIds((prev) => ({ ...prev, [ch]: e.target.value }))}
                    className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    placeholder="ID"
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Отмена</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{saving ? "Сохранение…" : "Сохранить"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
