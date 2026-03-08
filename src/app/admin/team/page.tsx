"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { UserPlus, User, Briefcase, Star, Circle } from "lucide-react";
import type { ExitReason, Staff } from "@/lib/types";
import type { ServiceRole } from "@/lib/types";

const VENUE_ID = "current";

const EXIT_REASONS: { value: ExitReason; label: string }[] = [
  { value: "discipline", label: "Дисциплина" },
  { value: "own_wish", label: "Личные причины" },
  { value: "professionalism", label: "Профи" },
  { value: "conflict", label: "Конфликтность" },
  { value: "other", label: "Другое" },
];

const POSITION_OPTIONS: { value: ServiceRole | ""; label: string }[] = [
  { value: "", label: "—" },
  { value: "waiter", label: "Официант" },
  { value: "sommelier", label: "Сомелье" },
  { value: "bartender", label: "Бармен" },
  { value: "chef", label: "Шеф-повар" },
  { value: "cook", label: "Повар" },
  { value: "manager", label: "Менеджер" },
  { value: "security", label: "Охрана" },
  { value: "runner", label: "Раннер" },
  { value: "cleaner", label: "Уборщик" },
];

function StaffRow({
  staff,
  onEdit,
  onDismiss,
  positionLabel,
}: {
  staff: Staff;
  onEdit: (s: Staff) => void;
  onDismiss: (s: Staff) => void;
  positionLabel: string;
}) {
  const name = (staff.firstName || staff.lastName)
    ? [staff.firstName, staff.lastName].filter(Boolean).join(" ")
    : (staff.identity?.displayName ?? staff.identity?.name ?? staff.id);
  const isActive = staff.active !== false;
  const onShift = staff.onShift === true;

  return (
    <tr className="border-b border-gray-100">
      <td className="p-3">
        <div className="h-10 w-10 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center shrink-0">
          {staff.photoUrl ? (
            <img src={staff.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <User className="h-5 w-5 text-gray-500" />
          )}
        </div>
      </td>
      <td className="p-3 text-sm font-medium text-gray-900">{name}</td>
      <td className="p-3 text-sm text-gray-600">{positionLabel}</td>
      <td className="p-3 text-sm">{staff.globalScore != null ? `${staff.globalScore}` : "—"}</td>
      <td className="p-3 text-sm">
        {!isActive ? (
          <span className="text-gray-500">Уволен</span>
        ) : onShift ? (
          <span className="inline-flex items-center gap-1 text-green-700">
            <Circle className="h-2 w-2 fill-current" /> На смене
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-gray-500">
            <Circle className="h-2 w-2 fill-current" /> Не на смене
          </span>
        )}
      </td>
      <td className="p-3 flex gap-2">
        <button
          type="button"
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          onClick={() => onEdit(staff)}
        >
          Редактировать
        </button>
        {isActive && (
          <button
            type="button"
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
            onClick={() => onDismiss(staff)}
          >
            Удалить
          </button>
        )}
      </td>
    </tr>
  );
}

export interface TableItem {
  id: string;
  number: number;
  hallId?: string;
}
export interface HallWithTables {
  hallId: string;
  hallName: string;
  tables: TableItem[];
}

export default function TeamPage() {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [tables, setTables] = useState<TableItem[]>([]);
  const [halls, setHalls] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nameSearch, setNameSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState<string>("");
  const [tableFilterId, setTableFilterId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "on_shift">("all");
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [dismissModal, setDismissModal] = useState<Staff | null>(null);
  const [exitReason, setExitReason] = useState<ExitReason>("own_wish");
  const [rating, setRating] = useState(3);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const [staffSnap, hallsSnap, tablesFromSub, tablesFromRoot] = await Promise.all([
        getDocs(query(collection(db, "staff"), where("venueId", "==", VENUE_ID))),
        getDocs(collection(db, "venues", VENUE_ID, "halls")),
        getDocs(collection(db, "venues", VENUE_ID, "tables")),
        getDocs(query(collection(db, "tables"), where("venueId", "==", VENUE_ID))),
      ]);
      setStaffList(staffSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Staff)));
      setHalls(hallsSnap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? "" })));
      const fromSub = tablesFromSub.docs.map((d) => {
        const data = d.data();
        return { id: d.id, number: (data.number as number) ?? 0, hallId: data.hallId as string | undefined };
      });
      const fromRoot = tablesFromRoot.docs.map((d) => ({ id: d.id, number: (d.data().number as number) ?? 0, hallId: undefined as string | undefined }));
      setTables(fromSub.length ? fromSub : fromRoot);
      setLoaded(true);
    })();
  }, []);

  const filteredStaff = staffList.filter((s) => {
    const name = (s.firstName ?? "") + " " + (s.lastName ?? "") + " " + (s.identity?.displayName ?? "") + " " + (s.identity?.name ?? "");
    if (nameSearch.trim() && !name.toLowerCase().includes(nameSearch.trim().toLowerCase())) return false;
    if (positionFilter && (s.position ?? "") !== positionFilter) return false;
    if (tableFilterId && !(s.assignedTableIds ?? []).includes(tableFilterId)) return false;
    if (statusFilter === "on_shift" && s.onShift !== true) return false;
    return true;
  });

  const handleDismiss = (staff: Staff) => {
    setDismissModal(staff);
    setExitReason("own_wish");
    setRating(3);
  };

  const handleDismissSubmit = async () => {
    if (!dismissModal) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/staff/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: dismissModal.id,
          exitReason,
          rating,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setStaffList((prev) =>
        prev.map((s) => (s.id === dismissModal.id ? { ...s, active: false } : s))
      );
      setDismissModal(null);
      toast.success("Сотрудник уволен");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка увольнения");
    } finally {
      setLoading(false);
    }
  };

  const dismissName = (dismissModal?.firstName || dismissModal?.lastName)
    ? [dismissModal.firstName, dismissModal.lastName].filter(Boolean).join(" ")
    : (dismissModal?.identity?.name ?? dismissModal?.id ?? "");

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Команда</h2>
      <p className="mt-2 text-sm text-gray-600">
        Управление штатом: HR-профиль, закрепление за столами. При сохранении данные синхронизируются с global_staff. При удалении обязательны причина и оценка.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Поиск по имени"
          value={nameSearch}
          onChange={(e) => setNameSearch(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm w-44"
        />
        <label className="flex items-center gap-2 text-sm">
          <Briefcase className="h-4 w-4 text-gray-500" />
          <span className="text-gray-600">Должность:</span>
          <select
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
          >
            <option value="">Все</option>
            {POSITION_OPTIONS.filter((o) => o.value).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Зона (стол):</span>
          <select
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={tableFilterId}
            onChange={(e) => setTableFilterId(e.target.value)}
          >
            <option value="">Все столы</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>Стол {t.number}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Статус:</span>
          <div className="flex rounded-lg border border-gray-300 p-0.5">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${statusFilter === "all" ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:bg-gray-100"}`}
            >
              Все
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("on_shift")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${statusFilter === "on_shift" ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:bg-gray-100"}`}
            >
              На смене
            </button>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          onClick={() => setEditingStaff({ id: "", venueId: VENUE_ID, role: "waiter", primaryChannel: "telegram", identity: { channel: "telegram", externalId: "", locale: "ru" }, onShift: false } as Staff)}
        >
          <UserPlus className="h-4 w-4" />
          + Добавить сотрудника
        </button>
      </div>

      {!loaded ? (
        <p className="mt-4 text-sm text-gray-500">Загрузка…</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="p-3 text-left text-xs font-medium text-gray-600">Фото</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Имя / Фамилия</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Должность</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600"><span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5" /> Рейтинг</span></th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Статус</th>
                <th className="p-3 text-left text-xs font-medium text-gray-600">Действие</th>
              </tr>
            </thead>
            <tbody>
              {filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-sm text-gray-500">
                    Нет сотрудников.
                  </td>
                </tr>
              ) : (
                filteredStaff.map((s) => (
                  <StaffRow
                    key={s.id}
                    staff={s}
                    onEdit={setEditingStaff}
                    onDismiss={handleDismiss}
                    positionLabel={POSITION_OPTIONS.find((o) => o.value === (s.position ?? ""))?.label ?? (s.position ?? "—")}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {editingStaff && (
        <StaffFormModal
          staff={editingStaff}
          tables={tables}
          halls={halls}
          onClose={() => setEditingStaff(null)}
          onSaved={(updated) => {
            if (editingStaff.id) {
              setStaffList((prev) => prev.map((s) => (s.id === editingStaff.id ? { ...s, ...updated } : s)));
            } else {
              const id = (updated as { id?: string }).id;
              if (id) setStaffList((prev) => [...prev, { ...editingStaff, ...updated, id } as Staff]);
            }
            setEditingStaff(null);
          }}
        />
      )}

      {dismissModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="dismiss-title">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 id="dismiss-title" className="font-semibold text-gray-900">Подтверждение удаления: {dismissName}</h3>
            <p className="mt-1 text-sm text-gray-600">
              Обязательно укажите причину увольнения и оценку от ЛПР (1–5). Данные обновят globalScore и синхронизируются с Биржей труда (global_staff).
            </p>
            <label className="mt-3 block text-sm font-medium text-gray-700">Причина увольнения</label>
            <select
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value as ExitReason)}
            >
              {EXIT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <label className="mt-3 block text-sm font-medium text-gray-700">Рейтинг от ЛПР (1–5 звёзд)</label>
            <div className="mt-1 flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="rounded p-1 text-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  <span className={rating >= star ? "text-amber-500" : "text-gray-300"}>★</span>
                </button>
              ))}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">{rating} из 5</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setDismissModal(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                onClick={handleDismissSubmit}
                disabled={loading}
              >
                {loading ? "Сохранение…" : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StaffFormModal({
  staff,
  tables,
  halls,
  onClose,
  onSaved,
}: {
  staff: Staff;
  tables: TableItem[];
  halls: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (data: Partial<Staff> & { id?: string }) => void;
}) {
  const tablesByHall: HallWithTables[] = (() => {
    const withHall = tables.filter((t) => t.hallId);
    const withoutHall = tables.filter((t) => !t.hallId);
    const result: HallWithTables[] = [];
    for (const hall of halls) {
      const list = withHall.filter((t) => t.hallId === hall.id);
      if (list.length) result.push({ hallId: hall.id, hallName: hall.name, tables: list });
    }
    if (withoutHall.length) result.push({ hallId: "", hallName: "Без зала", tables: withoutHall });
    return result;
  })();
  const [firstName, setFirstName] = useState(staff.firstName ?? "");
  const [lastName, setLastName] = useState(staff.lastName ?? "");
  const [gender, setGender] = useState(staff.gender ?? "");
  const [birthDate, setBirthDate] = useState(staff.birthDate ?? "");
  const [photoUrl, setPhotoUrl] = useState(staff.photoUrl ?? "");
  const [phone, setPhone] = useState(staff.phone ?? "");
  const [tgId, setTgId] = useState(staff.tgId ?? staff.identity?.externalId ?? "");
  const [position, setPosition] = useState(staff.position ?? "");
  const [assignedTableIds, setAssignedTableIds] = useState<string[]>(staff.assignedTableIds ?? []);
  const [saving, setSaving] = useState(false);

  const displayName = (staff.identity?.displayName ?? [firstName, lastName].filter(Boolean).join(" ")) || "Имя для уведомлений";

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/staff/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: staff.id || undefined,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          gender: gender || undefined,
          birthDate: birthDate || undefined,
          photoUrl: photoUrl.trim() || undefined,
          phone: phone.trim() || undefined,
          tgId: tgId.trim() || undefined,
          position: position || undefined,
          assignedTableIds: assignedTableIds,
          identity: staff.identity ? { ...staff.identity, externalId: tgId.trim() || staff.identity.externalId, displayName: [firstName, lastName].filter(Boolean).join(" ") || displayName } : { channel: "telegram", externalId: tgId.trim(), locale: "ru", displayName: [firstName, lastName].filter(Boolean).join(" ") },
          primaryChannel: staff.primaryChannel ?? "telegram",
          role: staff.role ?? "waiter",
          onShift: staff.onShift ?? false,
          active: staff.active ?? true,
          guestRating: staff.guestRating,
          venueRating: staff.venueRating,
          globalScore: staff.globalScore,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      const savedId = data.staffId ?? staff.id;
      onSaved({
        ...(savedId ? { id: savedId } : {}),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        gender: gender || undefined,
        birthDate: birthDate || undefined,
        photoUrl: photoUrl.trim() || undefined,
        phone: phone.trim() || undefined,
        tgId: tgId.trim() || undefined,
        position: position || undefined,
        assignedTableIds: assignedTableIds.length ? assignedTableIds : undefined,
      });
      toast.success("Сохранено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const toggleTable = (id: string) => {
    setAssignedTableIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-lg">
        <div className="border-b border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900">
            {staff.id ? "Редактировать сотрудника" : "Новый сотрудник"}
          </h3>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
          <section>
            <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Личные</h4>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 sm:col-span-1">
                <span className="block text-xs text-gray-600">Фото (URL или Upload)</span>
                <input type="url" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://..." className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </label>
              <label>
                <span className="block text-xs text-gray-600">Имя (для уведомлений)</span>
                <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </label>
              <label>
                <span className="block text-xs text-gray-600">Фамилия</span>
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </label>
              <label>
                <span className="block text-xs text-gray-600">Пол</span>
                <select value={gender} onChange={(e) => setGender(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">—</option>
                  <option value="male">М</option>
                  <option value="female">Ж</option>
                </select>
              </label>
              <label>
                <span className="block text-xs text-gray-600">Дата рождения</span>
                <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </label>
            </div>
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Связь</h4>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2">
                <span className="block text-xs text-gray-600">Телефон</span>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="col-span-2">
                <span className="block text-xs text-gray-600">ID мессенджера (для связи со Staff-ботом)</span>
                <input type="text" value={tgId} onChange={(e) => setTgId(e.target.value)} placeholder="tgId, waId…" className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </label>
            </div>
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Проф</h4>
            <label>
              <span className="block text-xs text-gray-600">Должность</span>
              <select value={position} onChange={(e) => setPosition(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                {POSITION_OPTIONS.map((o) => (
                  <option key={o.value || "empty"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 block">
              <span className="block text-xs text-gray-600">Закреплённые столы (по залам)</span>
              <div className="mt-1 space-y-2">
                {tables.length === 0 ? (
                  <span className="text-xs text-gray-500">Нет столов. Добавьте залы и столы в Зал & QR.</span>
                ) : tablesByHall.length === 0 ? (
                  tables.map((t) => (
                    <label key={t.id} className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-50 mr-2 mb-1">
                      <input type="checkbox" checked={assignedTableIds.includes(t.id)} onChange={() => toggleTable(t.id)} className="rounded border-gray-300" />
                      <span>Стол {t.number}</span>
                    </label>
                  ))
                ) : (
                  tablesByHall.map((group) => (
                    <div key={group.hallId || "none"}>
                      <p className="text-xs font-medium text-gray-500 mb-1">{group.hallName}:</p>
                      <div className="flex flex-wrap gap-2">
                        {group.tables.map((t) => (
                          <label key={t.id} className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                            <input type="checkbox" checked={assignedTableIds.includes(t.id)} onChange={() => toggleTable(t.id)} className="rounded border-gray-300" />
                            <span>{t.number}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </label>
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Системные (только чтение)</h4>
            <div className="grid grid-cols-3 gap-2 rounded border border-gray-100 bg-gray-50 p-3 text-sm">
              <div>
                <span className="block text-gray-500">Рейтинг гостей</span>
                <p className="font-medium">{staff.guestRating != null ? staff.guestRating : "—"}</p>
              </div>
              <div>
                <span className="block text-gray-500">Рейтинг ЛПР</span>
                <p className="font-medium">{staff.venueRating != null ? staff.venueRating : "—"}</p>
              </div>
              <div>
                <span className="block text-gray-500">Global Score</span>
                <p className="font-medium">{staff.globalScore != null ? staff.globalScore : "—"}</p>
              </div>
            </div>
          </section>
        </div>
        <div className="flex gap-2 border-t border-gray-200 p-4">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Отмена
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
