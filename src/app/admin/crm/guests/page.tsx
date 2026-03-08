"use client";

import { useState, useEffect } from "react";
import { collection, query, where, limit, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Guest, GuestType } from "@/lib/types";
import type { MessengerChannel } from "@/lib/types";

const VENUE_ID = "current";
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
const CHANNEL_SHORT: Record<MessengerChannel, string> = {
  telegram: "TG",
  whatsapp: "WA",
  vk: "VK",
  viber: "VB",
  wechat: "WC",
  instagram: "IG",
  facebook: "FB",
  line: "Line",
};

function hasChannel(guest: Guest, channel: MessengerChannel): boolean {
  const field = CHANNEL_FIELD[channel];
  const value = guest[field];
  return Boolean(value && String(value).trim());
}

function guestChannels(guest: Guest): MessengerChannel[] {
  return (Object.keys(CHANNEL_FIELD) as MessengerChannel[]).filter((ch) =>
    hasChannel(guest, ch)
  );
}

function RowSkeleton() {
  return (
    <tr>
      <td className="p-3"><div className="h-4 w-24 animate-pulse rounded bg-gray-200" /></td>
      <td className="p-3"><div className="h-4 w-32 animate-pulse rounded bg-gray-200" /></td>
      <td className="p-3"><div className="h-4 w-20 animate-pulse rounded bg-gray-200" /></td>
      <td className="p-3"><div className="h-4 w-16 animate-pulse rounded bg-gray-200" /></td>
    </tr>
  );
}

export default function CRMGuestsPage() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<MessengerChannel | "">("");

  useEffect(() => {
    const q = query(
      collection(db, "guests"),
      where("venueId", "==", VENUE_ID),
      limit(200)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: Guest[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          type: (data.type as GuestType) || "regular",
        } as Guest;
      });
      setGuests(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const filtered =
    channelFilter === ""
      ? guests
      : guests.filter((g) => hasChannel(g, channelFilter));

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">CRM: Гости</h2>
      <p className="mt-2 text-sm text-gray-600">
        Управление профилями гостей по заведению (venueId). Фильтр по каналу входа. Склейка: если гость в VK ввёл телефон, совпадающий с гостем в TG, используйте «Склеить» в карточке гостя или API merge.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Канал входа:</span>
          <select
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value as MessengerChannel | "")}
          >
            <option value="">Все</option>
            {(Object.keys(CHANNEL_LABEL) as MessengerChannel[]).map((ch) => (
              <option key={ch} value={ch}>
                {CHANNEL_LABEL[ch]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <table className="w-full min-w-[400px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="p-3 text-left text-xs font-medium text-gray-600">Имя / ID</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Телефон</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Мессенджер</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Каналы</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Тип</th>
              </tr>
            </thead>
            <tbody>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </tbody>
          </table>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">Нет гостей (фильтр: venueId={VENUE_ID})</p>
        ) : (
          <table className="w-full min-w-[400px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="p-3 text-left text-xs font-medium text-gray-600">Имя / ID</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Телефон</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Мессенджер</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Каналы</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Тип</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id} className="border-b border-gray-100">
                  <td className="p-3 text-sm">
                    {g.name || g.nickname || g.id.slice(0, 8)}
                  </td>
                  <td className="p-3 text-sm text-gray-600">{g.phone ?? "—"}</td>
                  <td className="p-3">
                    <span className="inline-flex flex-wrap gap-1">
                      {guestChannels(g).length ? guestChannels(g).map((ch) => (
                        <span key={ch} className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700" title={CHANNEL_LABEL[ch]}>
                          {CHANNEL_SHORT[ch]}
                        </span>
                      )) : "—"}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-gray-500">
                    {guestChannels(g).map((ch) => CHANNEL_LABEL[ch]).join(", ") || "—"}
                  </td>
                  <td className="p-3 text-xs text-gray-500">{g.type ?? "regular"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
