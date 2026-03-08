"use client";

import { useState, useEffect } from "react";
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
import type { VenueType } from "@/lib/types";

const DEFAULT_CHECK_IN = "Располагайтесь! Нажмите кнопку ниже, чтобы открыть меню или позвать официанта.";
const DEFAULT_BOOKING = "Извините, этот стол забронирован. Обратитесь к хостес.";
const DEFAULT_THANK_YOU = "🙏 Спасибо за визит! Будем рады видеть вас снова.";
const VENUE_ID = "current";

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
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/check-in?v=${VENUE_ID}&t=${encodeURIComponent(tableId)}`;
}

function QRModal({ table, onClose }: { table: VenueTable; onClose: () => void }) {
  const url = buildCheckInUrl(table.id);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
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
      alert("Ссылка скопирована в буфер обмена.");
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <h3 className="font-semibold text-gray-900">QR-код стола {table.number}</h3>
        <p className="mt-1 text-sm text-gray-500">Ссылка для гостевого входа</p>
        <div className="mt-4 flex justify-center">
          <img src={qrSrc} alt="QR" className="h-[200px] w-[200px]" />
        </div>
        <p className="mt-2 break-all text-xs text-gray-500">{url}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" onClick={onClose}>Закрыть</button>
          <button type="button" className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-800" onClick={handlePrint}>На печать</button>
          <button type="button" className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" onClick={handleShare}>Поделиться</button>
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

function EditTableForm({ table, onSave, onCancel }: { table: VenueTable; onSave: (n: number, name: string, desc: string, seats: number) => void; onCancel: () => void }) {
  const [number, setNumber] = useState(String(table.number));
  const [name, setName] = useState(table.name ?? "");
  const [description, setDescription] = useState(table.description ?? "");
  const [seats, setSeats] = useState(table.seats != null ? String(table.seats) : "");
  return (
    <div className="mt-3 rounded border border-gray-200 bg-white p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
      <label><span className="block text-xs text-gray-600">Номер *</span><input type="number" min={1} value={number} onChange={(e) => setNumber(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
      <label><span className="block text-xs text-gray-600">Название</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
      <label><span className="block text-xs text-gray-600">Мест</span><input type="number" min={0} value={seats} onChange={(e) => setSeats(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
      <div className="flex items-end gap-1">
        <button type="button" className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800" onClick={() => onSave(Number(number) || 0, name, description, Number(seats) || 0)}>Сохранить</button>
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
  const [newHallName, setNewHallName] = useState("");
  const [editingHall, setEditingHall] = useState<Hall | null>(null);
  const [editingHallName, setEditingHallName] = useState("");
  const [addingTableHallId, setAddingTableHallId] = useState<string | null>(null);
  const [editingTable, setEditingTable] = useState<VenueTable | null>(null);
  const [qrTable, setQrTable] = useState<VenueTable | null>(null);

  const hallsRef = collection(db, "venues", VENUE_ID, "halls");
  const tablesRef = collection(db, "venues", VENUE_ID, "tables");

  useEffect(() => {
    (async () => {
      const [venueSnap, hallsSnap, tablesSnap] = await Promise.all([getDoc(doc(db, "venues", VENUE_ID)), getDocs(hallsRef), getDocs(tablesRef)]);
      if (venueSnap.exists() && venueSnap.data().venueType) setVenueType(venueSnap.data().venueType as VenueType);
      if (venueSnap.exists() && venueSnap.data().messages) {
        const m = venueSnap.data().messages as { checkIn?: string; booking?: string; thankYou?: string };
        setMessages((prev) => ({ checkIn: m.checkIn ?? prev.checkIn, booking: m.booking ?? prev.booking, thankYou: m.thankYou ?? prev.thankYou }));
      }
      const hallList = hallsSnap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? "", order: (d.data().order as number) ?? 0 }));
      hallList.sort((a, b) => a.order - b.order);
      setHalls(hallList);
      setTables(tablesSnap.docs.map((d) => {
        const data = d.data();
        return { id: d.id, hallId: (data.hallId as string) ?? "", number: (data.number as number) ?? 0, name: data.name as string | undefined, description: data.description as string | undefined, seats: data.seats as number | undefined };
      }));
      setLoaded(true);
    })();
  }, []);

  const loadHallsAndTables = async () => {
    const [hallsSnap, tablesSnap] = await Promise.all([getDocs(hallsRef), getDocs(tablesRef)]);
    const hallList = hallsSnap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? "", order: (d.data().order as number) ?? 0 }));
    hallList.sort((a, b) => a.order - b.order);
    setHalls(hallList);
    setTables(tablesSnap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, hallId: (data.hallId as string) ?? "", number: (data.number as number) ?? 0, name: data.name as string | undefined, description: data.description as string | undefined, seats: data.seats as number | undefined };
    }));
  };

  const addHall = async () => {
    const name = newHallName.trim();
    if (!name) return;
    try {
      await addDoc(hallsRef, { name, order: halls.length, updatedAt: serverTimestamp() });
      setNewHallName("");
      await loadHallsAndTables();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка добавления зала");
    }
  };

  const updateHall = async (hall: Hall) => {
    const name = editingHallName.trim();
    if (!name) return;
    try {
      await updateDoc(doc(db, "venues", VENUE_ID, "halls", hall.id), { name, updatedAt: serverTimestamp() });
      setEditingHall(null);
      setEditingHallName("");
      await loadHallsAndTables();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения зала");
    }
  };

  const deleteHall = async (hall: Hall) => {
    if (!confirm(`Удалить зал «${hall.name}» и все столы в нём?`)) return;
    try {
      for (const t of tables.filter((x) => x.hallId === hall.id)) await deleteDoc(doc(db, "venues", VENUE_ID, "tables", t.id));
      await deleteDoc(doc(db, "venues", VENUE_ID, "halls", hall.id));
      await loadHallsAndTables();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления зала");
    }
  };

  const addTable = async (hallId: string, number: number, name: string, description: string, seats: number) => {
    if (!number && number !== 0) return;
    try {
      await addDoc(tablesRef, { hallId, number: Number(number), name: name.trim() || null, description: description.trim() || null, seats: seats > 0 ? seats : null, updatedAt: serverTimestamp() });
      setAddingTableHallId(null);
      await loadHallsAndTables();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка добавления стола");
    }
  };

  const updateTable = async (t: VenueTable, number: number, name: string, description: string, seats: number) => {
    try {
      await updateDoc(doc(db, "venues", VENUE_ID, "tables", t.id), { number: Number(number), name: name.trim() || null, description: description.trim() || null, seats: seats > 0 ? seats : null, updatedAt: serverTimestamp() });
      setEditingTable(null);
      await loadHallsAndTables();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения стола");
    }
  };

  const deleteTable = async (t: VenueTable) => {
    if (!confirm(`Удалить стол ${t.number}?`)) return;
    try {
      await deleteDoc(doc(db, "venues", VENUE_ID, "tables", t.id));
      await loadHallsAndTables();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления стола");
    }
  };

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
        <button type="button" className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50" onClick={async () => { setVenueTypeSaving(true); try { await updateDoc(doc(db, "venues", VENUE_ID), { venueType, updatedAt: serverTimestamp() }); } catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); } finally { setVenueTypeSaving(false); } }} disabled={venueTypeSaving}>
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
        <button type="button" className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50" onClick={async () => { setSaving(true); try { const res = await fetch("/api/admin/venue/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ venueId: "current", messages }) }); if (!res.ok) throw new Error((await res.json()).error || "Ошибка"); } catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); } finally { setSaving(false); }} } disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить тексты"}
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h4 className="flex items-center gap-2 font-medium text-gray-900"><Map className="h-5 w-5 text-gray-500" /> Залы и столы</h4>
        <p className="mt-1 text-sm text-gray-500">Создайте залы и добавляйте столы. QR ведёт на /check-in?v=venueId&t=tableId.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input type="text" placeholder="Название зала" value={newHallName} onChange={(e) => setNewHallName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addHall()} className="rounded border border-gray-300 px-3 py-1.5 text-sm w-48" />
          <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800" onClick={addHall}><Plus className="h-4 w-4" /> Добавить зал</button>
        </div>
        {!loaded ? (
          <p className="mt-4 text-sm text-gray-500">Загрузка…</p>
        ) : (
          <div className="mt-6 space-y-6">
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
                        <><button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-200" onClick={() => { setEditingHall(hall); setEditingHallName(hall.name); }} title="Редактировать зал"><Pencil className="h-3.5 w-3.5" /></button><button type="button" className="rounded p-1 text-gray-500 hover:text-red-600 hover:bg-red-50" onClick={() => deleteHall(hall)} title="Удалить зал"><Trash2 className="h-3.5 w-3.5" /></button></>
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
                        <div><p className="font-medium text-gray-900">Стол {t.number}{t.name ? ` · ${t.name}` : ""}</p>{t.seats != null && <p className="text-xs text-gray-500">Мест: {t.seats}</p>}</div>
                        <div className="flex gap-1">
                          <button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-100" onClick={() => setQrTable(t)} title="QR-код"><QrCode className="h-4 w-4" /></button>
                          <button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-100" onClick={() => setEditingTable(t)} title="Редактировать"><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" className="rounded p-1 text-gray-500 hover:text-red-600 hover:bg-red-50" onClick={() => deleteTable(t)} title="Удалить"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {editingTable && editingTable.hallId === hall.id && <EditTableForm table={editingTable} onSave={(num, name, desc, seats) => updateTable(editingTable, num, name, desc, seats)} onCancel={() => setEditingTable(null)} />}
                </div>
              );
            })}
            {halls.length === 0 && <p className="text-sm text-gray-500">Нет залов. Добавьте зал выше.</p>}
          </div>
        )}
      </div>

      {qrTable && <QRModal table={qrTable} onClose={() => setQrTable(null)} />}
    </div>
  );
}
