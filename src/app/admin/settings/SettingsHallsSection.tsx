"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { LayoutGrid, Map, Plus, Pencil, Trash2, QrCode } from "lucide-react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import type { VenueType } from "@/lib/types";

const DEFAULT_CHECK_IN = "Располагайтесь! Нажмите кнопку ниже, чтобы открыть меню или позвать официанта.";
const DEFAULT_BOOKING = "Извините, этот стол забронирован. Обратитесь к хостес.";
const DEFAULT_THANK_YOU = "🙏 Спасибо за визит! Будем рады видеть вас снова.";
const VENUE_ID = "venue_andrey_alt";

interface Hall {
  id: string;
  name: string;
  order?: number;
}

interface VenueTable {
  id: string;
  hallId: string;
  number: number;
  name?: string;
  description?: string;
  seats?: number;
}

function buildCheckInUrl(tableId: string): string {
  // Жёсткая свая: QR всегда ведёт на прод-домен guest-интерфейса
  // https://heywaiter.vercel.app/check-in?v=venue_andrey_alt&t={tableId}
  return `https://heywaiter.vercel.app/check-in?v=${encodeURIComponent(
    VENUE_ID
  )}&t=${encodeURIComponent(tableId)}`;
}

function QRModal({ table, onClose }: { table: VenueTable; onClose: () => void }) {
  const url = buildCheckInUrl(table.id);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
  const handleDownload = () => {
    try {
      const a = document.createElement("a");
      a.href = qrSrc;
      a.download = `table-${table.number}-${table.id}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      window.open(qrSrc, "_blank");
    }
  };
  const handlePrint = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <!DOCTYPE html><html><head><title>QR Стол ${table.number}</title></head>
      <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:sans-serif;">
        <p style="font-size:18px;margin-bottom:12px;">Стол ${table.number}${table.name ? ` · ${table.name}` : ""}</p>
        <img src="${qrSrc}" alt="QR" width="200" height="200" />
        <p style="font-size:12px;color:#666;margin-top:12px;">Сканируйте для входа</p>
      </body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
    w.close();
  };
  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Стол ${table.number}`, text: `QR для стола ${table.number}`, url });
      } catch (e) {
        if ((e as Error).name !== "AbortError") navigator.clipboard?.writeText(url);
      }
    } else {
      await navigator.clipboard?.writeText(url);
      toast.success("Ссылка скопирована в буфер обмена.");
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <h3 className="font-semibold text-gray-900">QR-код стола {table.number}</h3>
        <p className="mt-1 text-sm text-gray-500">
          {table.name ? `«${table.name}» · ` : null}
          {table.seats != null ? `Мест: ${table.seats}` : null}
        </p>
        <div className="mt-4 flex justify-center">
          <img src={qrSrc} alt="QR" className="h-[200px] w-[200px]" />
        </div>
        <p className="mt-2 break-all text-xs text-gray-500">{url}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            Закрыть
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-800"
            onClick={handlePrint}
          >
            Печать
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={handleDownload}
          >
            Скачать QR
          </button>
        </div>
      </div>
    </div>
  );
}

/** Модалка карточки стола: QR (venue_andrey_alt) + форма редактирования */
function TableCardModal({
  table,
  halls,
  onSave,
  onClose,
}: {
  table: VenueTable;
  halls: Hall[];
  onSave: (hallId: string, n: number, name: string, desc: string, seats: number) => void;
  onClose: () => void;
}) {
  const url = buildCheckInUrl(table.id);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <h3 className="font-semibold text-gray-900">Стол {table.number}{table.name ? ` · ${table.name}` : ""}</h3>
        <p className="mt-1 text-xs text-gray-500">QR и редактирование (v=venue_andrey_alt)</p>
        <div className="mt-4 flex justify-center">
          <img src={qrSrc} alt="QR" className="h-[200px] w-[200px]" />
        </div>
        <p className="mt-2 break-all text-xs text-gray-500">{url}</p>
        <div className="mt-4 border-t border-gray-200 pt-4">
          <EditTableForm
            table={table}
            halls={halls}
            onSave={(hallId, num, name, desc, seats) => {
              onSave(hallId, num, name, desc, seats);
              onClose();
            }}
            onCancel={onClose}
          />
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

function AddTableForm({ hallId, onSave, onCancel }: { hallId: string; onSave: (n: number, name: string, desc: string, seats: number) => void; onCancel: () => void }) {
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [seats, setSeats] = useState("");
  return (
    <div className="mt-3 rounded border border-gray-200 bg-white p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
      <label><span className="block text-xs text-gray-600">Номер *</span><input type="number" min={1} value={number} onChange={(e) => setNumber(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
      <label><span className="block text-xs text-gray-600">Название</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Опционально" className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
      <label><span className="block text-xs text-gray-600">Мест</span><input type="number" min={0} value={seats} onChange={(e) => setSeats(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
      <div className="flex items-end gap-1">
        <button type="button" className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800" onClick={() => onSave(Number(number) || 0, name, description, Number(seats) || 0)}>Добавить</button>
        <button type="button" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

function EditTableForm({
  table,
  halls,
  onSave,
  onCancel,
}: {
  table: VenueTable;
  halls: Hall[];
  onSave: (hallId: string, n: number, name: string, desc: string, seats: number) => void;
  onCancel: () => void;
}) {
  const [number, setNumber] = useState(String(table.number));
  const [name, setName] = useState(table.name ?? "");
  const [description, setDescription] = useState(table.description ?? "");
  const [seats, setSeats] = useState(table.seats != null ? String(table.seats) : "");
  const [hallId, setHallId] = useState(table.hallId ?? "");
  return (
    <div className="mt-3 rounded border border-gray-200 bg-white p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
      <label className="col-span-2 sm:col-span-2">
        <span className="block text-xs text-gray-600">Зал</span>
        <select
          value={hallId}
          onChange={(e) => setHallId(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Без зала</option>
          {halls.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name || h.id}
            </option>
          ))}
        </select>
      </label>
      <label><span className="block text-xs text-gray-600">Номер *</span><input type="number" min={1} value={number} onChange={(e) => setNumber(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
      <label><span className="block text-xs text-gray-600">Название</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
      <label><span className="block text-xs text-gray-600">Мест</span><input type="number" min={0} value={seats} onChange={(e) => setSeats(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
      <div className="flex items-end gap-1">
        <button
          type="button"
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800"
          onClick={() => onSave(hallId, Number(number) || 0, name, description, Number(seats) || 0)}
        >
          Сохранить
        </button>
        <button type="button" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

export function SettingsHallsSection() {
  const [venueType, setVenueType] = useState<VenueType>("full_service");
  const [venueTypeSaving, setVenueTypeSaving] = useState(false);
  const [messages, setMessages] = useState({ checkIn: DEFAULT_CHECK_IN, booking: DEFAULT_BOOKING, thankYou: DEFAULT_THANK_YOU });
  const [saving, setSaving] = useState(false);
  const [halls, setHalls] = useState<Hall[]>([]);
  const [tables, setTables] = useState<VenueTable[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [newHallName, setNewHallName] = useState("");
  const [editingHall, setEditingHall] = useState<Hall | null>(null);
  const [editingHallName, setEditingHallName] = useState("");
  const [addingTableHallId, setAddingTableHallId] = useState<string | null>(null);
  const [editingTable, setEditingTable] = useState<VenueTable | null>(null);
  const [qrTable, setQrTable] = useState<VenueTable | null>(null);
  /** Модалка «карточка стола»: редактирование + QR (открывается по клику на стол) */
  const [tableCardModal, setTableCardModal] = useState<VenueTable | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant: "danger" | "primary";
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const cleanupPhantomTables = async () => {
    setCleanupLoading(true);
    try {
      const res = await fetch("/api/admin/cleanup-phantom-tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId: VENUE_ID }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Ошибка очистки");
      }
      const data = (await res.json()) as { deleted?: number };
      const deleted = Number(data.deleted ?? 0);
      toast.success(`Очистка завершена: удалено ${deleted} фантомных столов`);
      // Таблицы пересчитаются заново по fetch/load (мы их не трогаем локально).
      // Быстрей всего — просто перезагрузить страницу данных секции.
      void loadHallsAndTables();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка очистки");
    } finally {
      setCleanupLoading(false);
    }
  };

  // Жёсткая свая: работаем только с venues/venue_andrey_alt/*
  const hallsRef = collection(db, "venues", VENUE_ID, "halls");
  const tablesRef = collection(db, "venues", VENUE_ID, "tables");

  useEffect(() => {
    (async () => {
      let hallList: Hall[] = [];
      let tableList: VenueTable[] = [];
      try {
        const venueSnap = await getDoc(doc(db, "venues", VENUE_ID));
        if (venueSnap.exists() && venueSnap.data().venueType) setVenueType(venueSnap.data().venueType as VenueType);
        if (venueSnap.exists() && venueSnap.data().messages) {
          const m = venueSnap.data().messages as { checkIn?: string; booking?: string; thankYou?: string };
          setMessages((prev) => ({ checkIn: m.checkIn ?? prev.checkIn, booking: m.booking ?? prev.booking, thankYou: m.thankYou ?? prev.thankYou }));
        }
      } catch {
        // venue load failed — не блокируем залы и столы
      }
      try {
        let hallsSnap = await getDocs(hallsRef);
        if (hallsSnap.empty) {
          try {
            const roomsRef = collection(db, "venues", VENUE_ID, "rooms");
            const roomsSnap = await getDocs(roomsRef);
            if (!roomsSnap.empty) hallsSnap = roomsSnap;
          } catch {
            // ignore
          }
        }
        hallList = hallsSnap.docs.map((d) => ({
          id: d.id,
          name: (d.data().name as string) ?? "",
          order: (d.data().order as number) ?? 0,
        }));
        hallList.sort((a, b) => a.order - b.order);
        setHalls(hallList);
      } catch {
        // залы не загрузились — не блокируем столы
      }
      try {
        const tablesSnap = await getDocs(tablesRef);
        tableList = tablesSnap.docs.map((d) => {
          const data = d.data();
          const hallId = (data.hallId as string) || (data.roomId as string) || "";
          return {
            id: d.id,
            hallId,
            number: (data.number as number) ?? 0,
            name: data.name as string | undefined,
            description: data.description as string | undefined,
            seats: data.seats as number | undefined,
          };
        });
      } catch {
        // столы не загрузились — оставляем пустой список
      }
      setTables(tableList);
      setLoaded(true);
    })();
  }, []);

  const loadHallsAndTables = async () => {
    let hallsSnap = await getDocs(hallsRef);
    if (hallsSnap.empty) {
      try {
        const roomsRef = collection(db, "venues", VENUE_ID, "rooms");
        const roomsSnap = await getDocs(roomsRef);
        if (!roomsSnap.empty) {
          hallsSnap = roomsSnap;
        }
      } catch {
        // ignore
      }
    }
    const tablesSnap = await getDocs(tablesRef);
    const hallList = hallsSnap.docs.map((d) => ({
      id: d.id,
      name: (d.data().name as string) ?? "",
      order: (d.data().order as number) ?? 0,
    }));
    hallList.sort((a, b) => a.order - b.order);
    setHalls(hallList);
    setTables(
      tablesSnap.docs.map((d) => {
        const data = d.data();
        const hallId = (data.hallId as string) || (data.roomId as string) || "";
        return {
          id: d.id,
          hallId,
          number: (data.number as number) ?? 0,
          name: data.name as string | undefined,
          description: data.description as string | undefined,
          seats: data.seats as number | undefined,
        };
      })
    );
  };

  const addHall = async () => {
    const name = newHallName.trim();
    if (!name) {
      toast.error("Введите название зала");
      return;
    }
    try {
      await addDoc(hallsRef, { name, order: halls.length, updatedAt: serverTimestamp() });
      setNewHallName("");
      await loadHallsAndTables();
      toast.success("Зал добавлен");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка добавления зала");
    }
  };

  const updateHall = async (hall: Hall) => {
    const name = editingHallName.trim();
    if (!name) return;
    try {
      try {
        // сначала пытаемся обновить в новой коллекции halls
        await updateDoc(doc(db, "venues", VENUE_ID, "halls", hall.id), {
          name,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // алиас для старых данных: пробуем rooms
        await updateDoc(doc(db, "venues", VENUE_ID, "rooms", hall.id), {
          name,
          updatedAt: serverTimestamp(),
        });
      }
      setEditingHall(null);
      setEditingHallName("");
      await loadHallsAndTables();
      toast.success("Зал сохранён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка сохранения зала");
    }
  };

  const openDeleteHallConfirm = (hall: Hall) => {
    setConfirmState({
      open: true,
      title: "Подтверждение",
      message: `Удалить зал «${hall.name}» и все столы в нём?`,
      variant: "danger",
      onConfirm: async () => {
        try {
          for (const t of tables.filter((x) => x.hallId === hall.id)) {
            await deleteDoc(doc(db, "venues", VENUE_ID, "tables", t.id));
          }
          try {
            await deleteDoc(doc(db, "venues", VENUE_ID, "halls", hall.id));
          } catch {
            await deleteDoc(doc(db, "venues", VENUE_ID, "rooms", hall.id));
          }
          await loadHallsAndTables();
          toast.success("Зал удалён");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Ошибка удаления зала");
        }
        setConfirmState(null);
      },
    });
  };

  const addTable = async (hallId: string, number: number, name: string, description: string, seats: number) => {
    if (!number && number !== 0) return;
    try {
      await addDoc(tablesRef, { hallId, number: Number(number), name: name.trim() || null, description: description.trim() || null, seats: seats > 0 ? seats : null, updatedAt: serverTimestamp() });
      setAddingTableHallId(null);
      await loadHallsAndTables();
      toast.success("Стол добавлен");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка добавления стола");
    }
  };

  const updateTable = async (t: VenueTable, hallId: string, number: number, name: string, description: string, seats: number) => {
    try {
      await updateDoc(doc(db, "venues", VENUE_ID, "tables", t.id), {
        hallId: hallId || null,
        number: Number(number),
        name: name.trim() || null,
        description: description.trim() || null,
        seats: seats > 0 ? seats : null,
        updatedAt: serverTimestamp(),
      });
      setEditingTable(null);
      await loadHallsAndTables();
      toast.success("Стол сохранён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка сохранения стола");
    }
  };

  const openDeleteTableConfirm = (t: VenueTable) => {
    setConfirmState({
      open: true,
      title: "Подтверждение",
      message: `Удалить стол ${t.number}?`,
      variant: "danger",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "venues", VENUE_ID, "tables", t.id));
          await loadHallsAndTables();
          toast.success("Стол удалён");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Ошибка удаления стола");
        }
        setConfirmState(null);
      },
    });
  };

  /** Столы, не привязанные ни к одному залу (нет hallId или зал удалён) */
  const unassignedTables = tables.filter((t) => !halls.some((h) => h.id === t.hallId));

  return (
    <div className="mt-3 space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h4 className="font-medium text-gray-900">Тип заведения</h4>
        <p className="mt-1 text-xs text-gray-500">Полный сервис — столы и вызов официанта; фастфуд — заказ по номеру и уведомление «Готово».</p>
        <div className="mt-3 flex gap-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="venueType" checked={venueType === "full_service"} onChange={() => setVenueType("full_service")} className="text-gray-900" />
            <span className="text-sm">Полный сервис (столы, официант)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="venueType" checked={venueType === "fast_food"} onChange={() => setVenueType("fast_food")} className="text-gray-900" />
            <span className="text-sm">Фастфуд (заказ по номеру, выдача)</span>
          </label>
        </div>
        <button type="button" className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50" onClick={async () => { setVenueTypeSaving(true); try { await updateDoc(doc(db, "venues", VENUE_ID), { venueType, updatedAt: serverTimestamp() }); toast.success("Тип заведения сохранён"); } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setVenueTypeSaving(false); } }} disabled={venueTypeSaving}>
          {venueTypeSaving ? "Сохранение…" : "Сохранить тип"}
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h4 className="font-medium text-gray-900">Тексты сценариев (venue.messages)</h4>
        <p className="mt-1 text-xs text-gray-500">При закрытии стола официант вводит цифру → гостю уходит messages.thankYou.</p>
        <label className="mt-4 block text-sm font-medium text-gray-700">Посадка (checkIn)</label>
        <textarea className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={2} value={messages.checkIn} onChange={(e) => setMessages((m) => ({ ...m, checkIn: e.target.value }))} />
        <label className="mt-4 block text-sm font-medium text-gray-700">Бронь / отказ (booking)</label>
        <textarea className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={2} value={messages.booking} onChange={(e) => setMessages((m) => ({ ...m, booking: e.target.value }))} />
        <label className="mt-4 block text-sm font-medium text-gray-700">Благодарность (thankYou)</label>
        <textarea className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={2} value={messages.thankYou} onChange={(e) => setMessages((m) => ({ ...m, thankYou: e.target.value }))} />
        <button type="button" className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50" onClick={async () => { setSaving(true); try { const res = await fetch("/api/admin/venue/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ venueId: "venue_andrey_alt", messages }) }); if (!res.ok) throw new Error((await res.json()).error || "Ошибка"); toast.success("Тексты сохранены"); } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setSaving(false); }} } disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить тексты"}
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h4 className="flex items-center gap-2 font-medium text-gray-900"><Map className="h-5 w-5 text-gray-500" /> Залы и столы</h4>
        <p className="mt-1 text-sm text-gray-500">
          Создайте залы и добавляйте столы. QR ведёт на
          {" "}
          https://heywaiter.vercel.app/check-in?v=venue_andrey_alt&t=ID_СТОЛА.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={cleanupLoading}
            onClick={async () => {
              const ok = window.confirm("Очистить коллекцию venues/venue_andrey_alt/tables от фантомных столов (number=0/'0'/пусто)? Операция необратима.");
              if (!ok) return;
              await cleanupPhantomTables();
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {cleanupLoading ? "Очистка…" : "Очистить фантомные столы"}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 min-h-[40px]">
          <input type="text" placeholder="Название зала" value={newHallName} onChange={(e) => setNewHallName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addHall()} className="rounded border border-gray-300 px-3 py-1.5 text-sm w-48 flex-shrink-0" />
          <button type="button" className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800" onClick={addHall}><Plus className="h-4 w-4" /> Добавить зал</button>
        </div>
        {!loaded ? (
          <p className="mt-4 text-sm text-gray-500">Загрузка…</p>
        ) : (
          <div className="mt-6 space-y-6">
            {halls.length === 0 && tables.length > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
                Залы не найдены. Все столы отображаются в блоке «Нераспределенные столы» ниже — откройте QR-коды по клику на стол.
              </p>
            )}
            {halls.map((hall) => {
              const hallTables = tables.filter((t) => t.hallId === hall.id);
              return (
                <div key={hall.id} className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4 text-gray-500" />
                      {editingHall?.id === hall.id ? (
                        <input type="text" value={editingHallName} onChange={(e) => setEditingHallName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") updateHall(hall); if (e.key === "Escape") { setEditingHall(null); setEditingHallName(""); } }} className="rounded border border-gray-300 px-2 py-1 text-sm w-48" autoFocus />
                      ) : (
                        <h5 className="font-medium text-gray-900">{hall.name}</h5>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {editingHall?.id === hall.id ? (
                        <><button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100" onClick={() => updateHall(hall)}>Сохранить</button><button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100" onClick={() => { setEditingHall(null); setEditingHallName(""); }}>Отмена</button></>
                      ) : (
                        <><button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-200" onClick={() => { setEditingHall(hall); setEditingHallName(hall.name); }} title="Редактировать зал"><Pencil className="h-3.5 w-3.5" /></button><button type="button" className="rounded p-1 text-gray-500 hover:text-red-600 hover:bg-red-50" onClick={() => openDeleteHallConfirm(hall)} title="Удалить зал"><Trash2 className="h-3.5 w-3.5" /></button></>
                      )}
                    </div>
                  </div>
                  {editingHall?.id !== hall.id && (
                    <div className="mt-3"><button type="button" className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setAddingTableHallId(hall.id)}><Plus className="h-3.5 w-3.5" /> Добавить стол</button></div>
                  )}
                  {addingTableHallId === hall.id && <AddTableForm hallId={hall.id} onSave={(num, name, desc, seats) => addTable(hall.id, num, name, desc, seats)} onCancel={() => setAddingTableHallId(null)} />}
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {hallTables.map((t) => (
                      <div key={t.id} className="flex items-center justify-between rounded border border-gray-200 bg-white p-3">
                        <div
                          className="cursor-pointer min-w-0 flex-1"
                          onClick={() => setTableCardModal(t)}
                          title="Открыть карточку стола (редактирование и QR)"
                        >
                          <p className="font-medium text-gray-900">
                            Стол {t.number}
                            {t.name ? ` · ${t.name}` : ""}
                          </p>
                          {t.seats != null && <p className="text-xs text-gray-500">Мест: {t.seats}</p>}
                        </div>
                        <div className="flex flex-shrink-0 gap-1">
                          <button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-100" onClick={(e) => { e.stopPropagation(); setTableCardModal(t); }} title="Карточка и QR"><QrCode className="h-4 w-4" /></button>
                          <button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-100" onClick={(e) => { e.stopPropagation(); setEditingTable(t); }} title="Редактировать"><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" className="rounded p-1 text-gray-500 hover:text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); openDeleteTableConfirm(t); }} title="Удалить"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {editingTable && editingTable.hallId === hall.id && (
                    <EditTableForm
                      table={editingTable}
                      halls={halls}
                      onSave={(hallId, num, name, desc, seats) => updateTable(editingTable, hallId, num, name, desc, seats)}
                      onCancel={() => setEditingTable(null)}
                    />
                  )}
                </div>
              );
            })}
            {unassignedTables.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
                <h5 className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  Нераспределенные столы
                </h5>
                <p className="mt-1 text-xs text-gray-500">
                  Столы без зала или с нарушенной связью (зал удалён). Отредактируйте и выберите зал.
                </p>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {unassignedTables.map((t) => (
                    <div key={t.id} className="flex items-center justify-between rounded border border-gray-200 bg-white p-3">
                      <div
                        className="cursor-pointer min-w-0 flex-1"
                        onClick={() => setTableCardModal(t)}
                        title="Открыть карточку стола (редактирование и QR)"
                      >
                        <p className="font-medium text-gray-900">
                          Стол {t.number}
                          {t.name ? ` · ${t.name}` : ""}
                        </p>
                        {t.seats != null && <p className="text-xs text-gray-500">Мест: {t.seats}</p>}
                      </div>
                      <div className="flex flex-shrink-0 gap-1">
                        <button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-100" onClick={(e) => { e.stopPropagation(); setTableCardModal(t); }} title="Карточка и QR"><QrCode className="h-4 w-4" /></button>
                        <button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-100" onClick={(e) => { e.stopPropagation(); setEditingTable(t); }} title="Редактировать"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" className="rounded p-1 text-gray-500 hover:text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); openDeleteTableConfirm(t); }} title="Удалить"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                {editingTable && unassignedTables.some((u) => u.id === editingTable.id) && (
                  <EditTableForm
                    table={editingTable}
                    halls={halls}
                    onSave={(hallId, num, name, desc, seats) => updateTable(editingTable, hallId, num, name, desc, seats)}
                    onCancel={() => setEditingTable(null)}
                  />
                )}
              </div>
            )}
            {halls.length === 0 && tables.length === 0 && (
              <p className="text-sm text-gray-500">Нет залов. Добавьте зал выше.</p>
            )}
          </div>
        )}
      </div>

      {qrTable && <QRModal table={qrTable} onClose={() => setQrTable(null)} />}

      {tableCardModal && (
        <TableCardModal
          table={tableCardModal}
          halls={halls}
          onSave={(hallId, num, name, desc, seats) => updateTable(tableCardModal, hallId, num, name, desc, seats)}
          onClose={() => setTableCardModal(null)}
        />
      )}

      {confirmState && (
        <ConfirmModal
          open={confirmState.open}
          title={confirmState.title}
          message={confirmState.message}
          variant={confirmState.variant}
          confirmLabel="ПОДТВЕРДИТЬ"
          cancelLabel="ОТМЕНА"
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}
