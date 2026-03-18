"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { UserPlus, User, Briefcase, Star, Phone, BookOpen } from "lucide-react";
import type { Staff, StaffGroup, CallCategory, UnifiedIdentities, GlobalUser, MedicalCard } from "@/lib/types";
import type { ServiceRole } from "@/lib/types";
import { SERVICE_ROLE_GROUP, STAFF_GROUP_CALL_CATEGORY } from "@/lib/types";

const venueId = "venue_andrey_alt";
const VENUE_ID = venueId;

/** Тип поиска: номер телефона или одна из соцсетей (совпадает с API). */
type LookupSearchType = "phone" | keyof Pick<UnifiedIdentities, "tg" | "wa" | "vk" | "viber" | "wechat" | "inst" | "fb" | "line">;

/** Ответ API lookup-by-identity: трудовая книжка из global_users */
type LookupByIdentityResult = {
  found: true;
  foundBy?: LookupSearchType;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  photoUrl: string | null;
  identities: UnifiedIdentities;
  tgId: string | null;
  globalScore: number | null;
  medicalCard: MedicalCard | null;
  careerHistory: { venueId: string; position: string; joinDate: unknown; exitDate: unknown; exitReason: string; rating?: number; comment?: string }[];
  affiliations: { venueId: string; role?: string; status?: string }[];
};

/** Иерархия должностей v2: группа → список ролей с подписями. */
const POSITION_GROUPS_V2: { groupId: StaffGroup; groupLabel: string; roles: { value: ServiceRole; label: string }[] }[] = [
  {
    groupId: "lpr",
    groupLabel: "ЛПР (Администрация)",
    roles: [
      { value: "owner", label: "Владелец" },
      { value: "director", label: "Управляющий" },
      { value: "administrator", label: "Администратор" },
      { value: "manager", label: "Менеджер" },
    ],
  },
  {
    groupId: "hall",
    groupLabel: "Зал (Обслуживание)",
    roles: [
      { value: "waiter", label: "Официант" },
      { value: "bartender", label: "Бармен" },
      { value: "runner", label: "Раннер" },
      { value: "hookah", label: "Кальянщик" },
      { value: "sommelier", label: "Сомелье" },
      { value: "tea_master", label: "Чайный мастер" },
    ],
  },
  {
    groupId: "kitchen",
    groupLabel: "Кухня (Производство)",
    roles: [
      { value: "chef", label: "Шеф-повар" },
      { value: "cook", label: "Повар" },
      { value: "pastry_chef", label: "Кондитер" },
    ],
  },
  {
    groupId: "service",
    groupLabel: "Сервис (Поддержка)",
    roles: [
      { value: "cleaner", label: "Уборка" },
      { value: "security", label: "Охрана" },
      { value: "hostess", label: "Хостес" },
    ],
  },
];

/** Плоский список всех должностей для фильтра и отображения. */
const ALL_POSITIONS_FLAT = POSITION_GROUPS_V2.flatMap((g) => g.roles);

function getPositionLabel(position: string): string {
  const found = ALL_POSITIONS_FLAT.find((r) => r.value === position);
  return (found?.label ?? position) || "—";
}

function getGroupAndCallCategory(position: string): { group: StaffGroup; call_category: CallCategory } | null {
  const group = SERVICE_ROLE_GROUP[position as ServiceRole];
  if (!group) return null;
  const call_category = STAFF_GROUP_CALL_CATEGORY[group];
  return { group, call_category };
}

/** Unified ID V.2.0: все 8 соцсетей + phone, email для карточки сотрудника. */
const IDENTITY_OPTIONS: { value: keyof UnifiedIdentities; label: string; short: string }[] = [
  { value: "tg", label: "Telegram", short: "TG" },
  { value: "wa", label: "WhatsApp", short: "WA" },
  { value: "vk", label: "VK", short: "VK" },
  { value: "viber", label: "Viber", short: "VB" },
  { value: "wechat", label: "WeChat", short: "WC" },
  { value: "inst", label: "Instagram", short: "IN" },
  { value: "fb", label: "Facebook", short: "FB" },
  { value: "line", label: "Line", short: "LN" },
  { value: "phone", label: "Телефон", short: "📞" },
  { value: "email", label: "Email", short: "✉" },
];

/** Варианты типа поиска: Номер телефона по умолчанию + 8 соцсетей (для dropdown поиска в Трудовой книжке). */
const SEARCH_TYPE_OPTIONS: { value: LookupSearchType; label: string }[] = [
  { value: "phone", label: "Номер телефона" },
  { value: "tg", label: "Telegram" },
  { value: "wa", label: "WhatsApp" },
  { value: "vk", label: "VK" },
  { value: "viber", label: "Viber" },
  { value: "wechat", label: "WeChat" },
  { value: "inst", label: "Instagram" },
  { value: "fb", label: "Facebook" },
  { value: "line", label: "Line" },
];

/** Placeholder для поля ввода в зависимости от выбранного типа поиска. */
const SEARCH_PLACEHOLDERS: Record<LookupSearchType, string> = {
  phone: "79991234567 или 375336555200",
  tg: "Введите @username или числовой ID",
  wa: "Номер с кодом страны (например 79001234567)",
  vk: "ID или short name",
  viber: "Номер или ID",
  wechat: "ID пользователя",
  inst: "Username или ID",
  fb: "ID или username",
  line: "ID пользователя",
};

function identitiesToEntries(identities?: UnifiedIdentities | null): { type: keyof UnifiedIdentities; value: string }[] {
  if (!identities) return [];
  const entries: { type: keyof UnifiedIdentities; value: string }[] = [];
  (IDENTITY_OPTIONS as { value: keyof UnifiedIdentities }[]).forEach(({ value }) => {
    const v = identities[value];
    if (v && String(v).trim()) entries.push({ type: value, value: String(v).trim() });
  });
  return entries;
}

function entriesToIdentities(entries: { type: keyof UnifiedIdentities; value: string }[]): UnifiedIdentities {
  const identities: UnifiedIdentities = {};
  entries.forEach(({ type, value }) => {
    const trimmed = value.trim();
    if (trimmed) identities[type] = trimmed;
  });
  return identities;
}

/** Группа сотрудника: из поля group или по position через SERVICE_ROLE_GROUP. */
function getStaffGroup(staff: Staff): StaffGroup | null {
  if (staff.group) return staff.group;
  return getGroupAndCallCategory(staff.position ?? "")?.group ?? null;
}

const GROUP_FILTER_OPTIONS: { value: "" | StaffGroup; label: string }[] = [
  { value: "", label: "Все группы" },
  { value: "lpr", label: "ЛПР" },
  { value: "hall", label: "Зал" },
  { value: "kitchen", label: "Кухня" },
  { value: "service", label: "Сервис" },
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
      <td className="p-3">
        <div>
          <p className="text-sm font-medium text-gray-900">{name}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {IDENTITY_OPTIONS.filter((o) => o.value !== "email").map((opt) => {
              const linked = !!(staff.identities?.[opt.value] ?? (opt.value === "tg" && staff.tgId));
              return (
                <span
                  key={opt.value}
                  title={`${opt.label}: ${linked ? "привязан" : "нет"}`}
                  className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded px-1 text-[10px] font-medium ${
                    linked ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {opt.short}
                </span>
              );
            })}
          </div>
        </div>
      </td>
      <td className="p-3 text-sm text-gray-600">{positionLabel}</td>
      <td className="p-3 text-sm">{staff.globalScore != null ? `${staff.globalScore}` : "—"}</td>
      <td className="p-3 text-sm">
        {!isActive ? (
          <span className="text-gray-500">Уволен</span>
        ) : onShift ? (
          <span className="inline-flex items-center gap-1.5 text-green-600 font-medium">
            <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" aria-hidden /> На смене
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-gray-400">
            <span className="h-2 w-2 rounded-full bg-gray-400 shrink-0" aria-hidden /> Не на смене
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
            Расторгнуть контракт (Unlink)
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
  const router = useRouter();
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [tables, setTables] = useState<TableItem[]>([]);
  const [halls, setHalls] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nameSearch, setNameSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<"" | StaffGroup>("");
  const [positionFilter, setPositionFilter] = useState<string>("");
  const [tableFilterId, setTableFilterId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "on_shift">("all");
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [dismissModal, setDismissModal] = useState<Staff | null>(null);
  const [exitReasonText, setExitReasonText] = useState("");
  const [rating, setRating] = useState(3);
  const [loading, setLoading] = useState(false);
  const [lookupType, setLookupType] = useState<LookupSearchType>("phone");
  const [lookupValue, setLookupValue] = useState("");
  const [lookupResult, setLookupResult] = useState<LookupByIdentityResult | null>(null);
  const [lookupNotFound, setLookupNotFound] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerStatus, setOfferStatus] = useState<{ status: string | null; staffId: string | null } | null>(null);
  const [cancelOfferLoading, setCancelOfferLoading] = useState(false);
  const [dupCleanupLoading, setDupCleanupLoading] = useState(false);

  useEffect(() => {
    setOfferLoading(false);
    setLookupLoading(false);
    if (typeof window !== "undefined") {
      console.log("TEAM_PAGE_VERSION: 2.0_GROUPS_ADDED");
    }
  }, []);

  useEffect(() => {
    fetch(`/api/admin/staff/check-medical-cards?venueId=${encodeURIComponent(VENUE_ID)}`).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [hallsSnap, tablesFromSub, tablesFromRoot] = await Promise.all([
          getDocs(collection(db, "venues", VENUE_ID, "halls")),
          getDocs(collection(db, "venues", VENUE_ID, "tables")),
          getDocs(query(collection(db, "tables"), where("venueId", "==", VENUE_ID))),
        ]);
        setHalls(hallsSnap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? "" })));
        const fromSub = tablesFromSub.docs.map((d) => {
          const data = d.data();
          return { id: d.id, number: (data.number as number) ?? 0, hallId: data.hallId as string | undefined };
        });
        const fromRoot = tablesFromRoot.docs.map((d) => ({ id: d.id, number: (d.data().number as number) ?? 0, hallId: undefined as string | undefined }));
        setTables(fromSub.length ? fromSub : fromRoot);
      } catch (_e) {
        // halls/tables optional
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    const staffColRef = collection(db, "venues", VENUE_ID, "staff");
    const unsubscribe = onSnapshot(staffColRef, async (snap) => {
      const staffDocs = snap.docs;
      const userIds = [...new Set(staffDocs.map((d) => d.data().userId as string).filter(Boolean))];
      const globalUsers = new Map<string, GlobalUser>();
      for (const uid of userIds) {
        const ref = doc(db, "global_users", uid);
        const globalSnap = await getDoc(ref);
        if (globalSnap.exists()) {
          globalUsers.set(uid, { id: globalSnap.id, ...globalSnap.data() } as GlobalUser);
        }
      }
      const list: Staff[] = [];
      for (const d of staffDocs) {
        const data = d.data();
        const userId = data.userId as string | undefined;
        const global = userId ? globalUsers.get(userId) : null;
        const aff = global?.affiliations?.find((a) => a.venueId === VENUE_ID);
        const isActive = data.active === true;
        if (!isActive) continue;
        if (global) {
          list.push({
            id: d.id,
            userId: global.id,
            venueId: VENUE_ID,
            role: (data.role as Staff["role"]) ?? "waiter",
            primaryChannel: (global.primaryChannel as Staff["primaryChannel"]) ?? "telegram",
            identity: global.identity ?? { channel: "telegram", externalId: "", locale: "ru" },
            onShift: data.onShift ?? aff?.onShift ?? false,
            active: true,
            firstName: global.firstName ?? data.firstName,
            lastName: global.lastName ?? data.lastName,
            position: aff?.position ?? data.position,
            group: data.group ?? undefined,
            call_category: data.call_category ?? undefined,
            assignedTableIds: aff?.assignedTableIds ?? data.assignedTableIds ?? [],
            globalScore: global.globalScore ?? data.globalScore,
            guestRating: global.guestRating ?? data.guestRating,
            venueRating: global.venueRating ?? data.venueRating,
            photoUrl: global.photoUrl ?? data.photoUrl,
            phone: global.phone ?? data.phone,
            tgId: global.tgId ?? data.tgId,
            identities: global.identities ?? (data.tgId ? { tg: data.tgId } : undefined),
            medicalCard: global.medicalCard ?? data.medicalCard,
            careerHistory: global.careerHistory,
            updatedAt: global.updatedAt ?? data.updatedAt,
          } as Staff);
        } else {
          list.push({
            id: d.id,
            venueId: VENUE_ID,
            role: (data.role as Staff["role"]) ?? "waiter",
            primaryChannel: (data.primaryChannel as Staff["primaryChannel"]) ?? "telegram",
            identity: (data.identity as Staff["identity"]) ?? { channel: "telegram", externalId: "", locale: "ru" },
            onShift: data.onShift ?? false,
            active: true,
            firstName: data.firstName,
            lastName: data.lastName,
            position: data.position,
            group: data.group,
            call_category: data.call_category,
            assignedTableIds: data.assignedTableIds ?? [],
            globalScore: data.globalScore,
            guestRating: data.guestRating,
            venueRating: data.venueRating,
            photoUrl: data.photoUrl,
            phone: data.phone,
            tgId: data.tgId,
            identities: data.identities ?? (data.tgId ? { tg: data.tgId } : undefined),
            medicalCard: data.medicalCard,
            careerHistory: data.careerHistory,
            updatedAt: data.updatedAt,
          } as Staff);
        }
      }
      setStaffList(list);
    });
    return () => unsubscribe();
  }, []);

  const filteredStaff = staffList.filter((s) => {
    const name = (s.firstName ?? "") + " " + (s.lastName ?? "") + " " + (s.identity?.displayName ?? "") + " " + (s.identity?.name ?? "");
    if (nameSearch.trim() && !name.toLowerCase().includes(nameSearch.trim().toLowerCase())) return false;
    if (groupFilter) {
      const sGroup = getStaffGroup(s);
      if (sGroup !== groupFilter) return false;
    }
    if (positionFilter && (s.position ?? "") !== positionFilter) return false;
    if (tableFilterId && !(s.assignedTableIds ?? []).includes(tableFilterId)) return false;
    if (statusFilter === "on_shift" && s.onShift !== true) return false;
    return true;
  });

  const positionOptionsForFilter = groupFilter
    ? (POSITION_GROUPS_V2.find((g) => g.groupId === groupFilter)?.roles ?? [])
    : ALL_POSITIONS_FLAT;

  // Как только прилетает новый найденный юзер (foundUser), все флаги загрузки — false
  useEffect(() => {
    setOfferLoading(false);
    setLookupLoading(false);
  }, [lookupResult]);

  const fetchOfferStatus = useCallback(async (userId: string) => {
    const res = await fetch(
      `/api/admin/staff/offer-status?userId=${encodeURIComponent(userId)}&venueId=${encodeURIComponent(VENUE_ID)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { status: data.status ?? null, staffId: data.staffId ?? null } as { status: string | null; staffId: string | null };
  }, []);

  // Проверка статуса оффера для найденного пользователя + авто-обновление (если сотрудник принял оффер в чате/Mini App)
  useEffect(() => {
    if (!lookupResult?.userId) {
      setOfferStatus(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const next = await fetchOfferStatus(lookupResult.userId);
      if (!cancelled && next) setOfferStatus(next);
    })();
    return () => { cancelled = true; };
  }, [lookupResult?.userId, fetchOfferStatus]);

  // Периодическое обновление статуса оффера, чтобы при принятии в чате/Mini App карточка показала "В штате"
  useEffect(() => {
    if (!lookupResult?.userId) return;
    const interval = setInterval(async () => {
      const next = await fetchOfferStatus(lookupResult.userId);
      if (next) setOfferStatus(next);
    }, 5000);
    return () => clearInterval(interval);
  }, [lookupResult?.userId, fetchOfferStatus]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      console.log("Button State - isLoading:", offerLoading);
    }
  }, [offerLoading]);

  const handleLookupByIdentity = async () => {
    const value = lookupValue.trim();
    if (!value) {
      toast.error("Введите значение для поиска");
      return;
    }
    setLookupError(null);
    setLookupResult(null);
    setLookupNotFound(false);
    setLookupLoading(true);
    setOfferLoading(false);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const params = new URLSearchParams({ type: lookupType, value });
      const res = await fetch(`/api/admin/staff/lookup-by-identity?${params.toString()}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (res.status === 404) {
        clearTimeout(timeoutId);
        setLookupNotFound(true);
        setLookupResult(null);
        setOfferLoading(false);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Ошибка поиска");
      if (data.found) {
        setLookupResult(data as LookupByIdentityResult);
        setLookupNotFound(false);
        setOfferLoading(false);
      } else {
        setLookupNotFound(true);
        setLookupResult(null);
        setOfferLoading(false);
      }
    } catch (e) {
      clearTimeout(timeoutId);
      setLookupError(e instanceof Error ? (e.name === "AbortError" ? "Сервер не ответил" : e.message) : "Ошибка поиска");
      setLookupResult(null);
      setLookupNotFound(false);
      setOfferLoading(false);
    } finally {
      setLookupLoading(false);
      setOfferLoading(false);
    }
  };

  const resetLookupResults = () => {
    setLookupResult(null);
    setLookupNotFound(false);
    setLookupError(null);
    setLookupValue("");
    setLookupType("phone");
    setOfferLoading(false);
    setLookupLoading(false);
    setOfferStatus(null);
  };

  const handleCancelOffer = async () => {
    if (!lookupResult?.userId || cancelOfferLoading) return;
    const staffId = offerStatus?.staffId ?? `${VENUE_ID}_${lookupResult.userId}`;
    setCancelOfferLoading(true);
    try {
      const res = await fetch("/api/admin/staff/cancel-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка отмены");
      toast.success("Предложение отменено. Можно отправить заново.");
      const next = await fetchOfferStatus(lookupResult.userId);
      if (next) setOfferStatus(next);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка отмены предложения");
    } finally {
      setCancelOfferLoading(false);
    }
  };

  const handleCancelLookup = () => {
    setOfferLoading(false);
    setLookupLoading(false);
    setLookupResult(null);
    setLookupValue("");
    setLookupNotFound(false);
    setLookupError(null);
    setLookupType("phone");
    setOfferStatus(null);
  };

  const normalizePhone = (value: unknown): string => {
    const s = typeof value === "string" || typeof value === "number" ? String(value) : "";
    return s.replace(/\D/g, "");
  };

  const normalizeName = (first?: unknown, last?: unknown): string => {
    const f = typeof first === "string" ? first.trim() : "";
    const l = typeof last === "string" ? last.trim() : "";
    const full = [f, l].filter(Boolean).join(" ");
    return full.replace(/\s+/g, " ").trim().toLowerCase();
  };

  // Временная кнопка: удаление дублей staff в venues/venue_andrey_alt/staff
  const handleDeleteDuplicates = async () => {
    if (dupCleanupLoading) return;
    if (typeof window === "undefined") return;
    const ok = window.confirm("УДАЛИТЬ ДУБЛИКАТЫ staff в venues/venue_andrey_alt/staff? Операция необратима.");
    if (!ok) return;

    setDupCleanupLoading(true);
    const venueId = VENUE_ID;
    try {
      const staffSnap = await getDocs(collection(db, "venues", venueId, "staff"));
      const staffDocs = staffSnap.docs;
      if (staffDocs.length === 0) {
        toast.error("staff коллекция пустая");
        return;
      }

      const staffIdPrefix = `${venueId}_`;
      const userIds = [
        ...new Set(
          staffDocs
            .map((d) => {
              const data = d.data() ?? {};
              const explicit = data.userId as string | undefined;
              const derived = d.id.startsWith(staffIdPrefix) ? d.id.slice(staffIdPrefix.length) : undefined;
              return explicit || derived;
            })
            .filter(Boolean)
        ),
      ] as string[];

      const globalUsers = new Map<string, GlobalUser>();
      for (const uid of userIds) {
        const ref = doc(db, "global_users", uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          globalUsers.set(uid, { id: snap.id, ...(snap.data() as any) } as GlobalUser);
        }
      }

      type StaffDocInfo = { docId: string; data: any; nameKey: string; phoneKey: string };
      const infos: StaffDocInfo[] = staffDocs.map((d) => {
        const data = d.data() ?? {};
        const derivedUid = d.id.startsWith(staffIdPrefix) ? d.id.slice(staffIdPrefix.length) : undefined;
        const uid = (data.userId as string | undefined) ?? derivedUid;
        const g = uid ? globalUsers.get(uid) : undefined;
        const firstName = (g?.firstName as string | undefined) ?? (data.firstName as string | undefined);
        const lastName = (g?.lastName as string | undefined) ?? (data.lastName as string | undefined);
        const phone = (g?.phone as string | undefined) ?? (data.phone as string | undefined);

        return {
          docId: d.id,
          data,
          nameKey: normalizeName(firstName, lastName),
          phoneKey: normalizePhone(phone),
        };
      });

      const groups = new Map<string, StaffDocInfo[]>();
      for (const info of infos) {
        const key = `${info.nameKey}__${info.phoneKey}`;
        const arr = groups.get(key) ?? [];
        arr.push(info);
        groups.set(key, arr);
      }

      // oldDocId -> keepDocId
      const duplicatesMap = new Map<string, string>();
      // keepDocId -> merged defaultTables/assignedTableIds
      const mergedDefaultsByKeep = new Map<string, Set<string>>();
      const mergedAssignedByKeep = new Map<string, Set<string>>();

      let duplicatesFound = 0;

      for (const [_key, arr] of groups.entries()) {
        if (arr.length <= 1) continue;
        duplicatesFound++;

        const onShiftDocs = arr.filter((x) => x.data?.onShift === true);
        // Требование: удалять дубликаты только если среди них есть onShift:true.
        if (onShiftDocs.length === 0) continue;
        const keep = onShiftDocs[0];
        const keepId = keep.docId;

        // init sets
        if (!mergedDefaultsByKeep.has(keepId)) mergedDefaultsByKeep.set(keepId, new Set());
        if (!mergedAssignedByKeep.has(keepId)) mergedAssignedByKeep.set(keepId, new Set());

        for (const item of arr) {
          if (item.docId !== keepId) duplicatesMap.set(item.docId, keepId);

          const dt = Array.isArray(item.data?.defaultTables) ? item.data.defaultTables : [];
          dt.forEach((x: unknown) => mergedDefaultsByKeep.get(keepId)?.add(String(x)));

          const at = Array.isArray(item.data?.assignedTableIds) ? item.data.assignedTableIds : [];
          at.forEach((x: unknown) => mergedAssignedByKeep.get(keepId)?.add(String(x)));
        }
      }

      if (duplicatesMap.size === 0) {
        toast.success("Дубликаты не найдены");
        return;
      }

      toast.success(`Найдены дубликаты: ${duplicatesMap.size} связей для перепривязки. Применяю...`);

      // 1) Перепривязка таблиц: assignments.waiter -> keepDocId
      const tablesSnap = await getDocs(collection(db, "venues", venueId, "tables"));
      let batch = writeBatch(db);
      let batchOps = 0;
      const commitBatch = async () => {
        if (batchOps <= 0) return;
        await batch.commit();
        batchOps = 0;
        batch = writeBatch(db);
      };

      for (const t of tablesSnap.docs) {
        const data = t.data() ?? {};
        const assignments = (data.assignments as Record<string, unknown> | undefined) ?? {};
        const waiter = typeof assignments.waiter === "string" ? assignments.waiter : (assignments.waiter as unknown as string | undefined);
        if (waiter && duplicatesMap.has(waiter)) {
          const nextWaiter = duplicatesMap.get(waiter)!;
          batch.update(doc(db, "venues", venueId, "tables", t.id), {
            "assignments.waiter": nextWaiter,
            updatedAt: serverTimestamp(),
          });
          batchOps++;
        }

        // иногда waiter мог быть продублирован в assignedStaffId
        const assignedStaffId = typeof data.assignedStaffId === "string" ? data.assignedStaffId : undefined;
        if (assignedStaffId && duplicatesMap.has(assignedStaffId)) {
          const nextWaiter = duplicatesMap.get(assignedStaffId)!;
          batch.update(doc(db, "venues", venueId, "tables", t.id), {
            assignedStaffId: nextWaiter,
            updatedAt: serverTimestamp(),
          });
          batchOps++;
        }

        // commit by chunks (writeBatch limit 500)
        if (batchOps >= 450) {
          await commitBatch();
        }
      }
      await commitBatch();

      // 2) Обновление keep-docs (слияние defaultTables/assignedTableIds)
      for (const [keepId, setDt] of mergedDefaultsByKeep.entries()) {
        const setAt = mergedAssignedByKeep.get(keepId) ?? new Set<string>();
        await updateDoc(doc(db, "venues", venueId, "staff", keepId), {
          defaultTables: Array.from(setDt),
          assignedTableIds: Array.from(setAt),
          updatedAt: serverTimestamp(),
        });
      }

      // 3) Удаление duplicate staff docs
      const deleteIds = [...duplicatesMap.keys()];
      for (const dupId of deleteIds) {
        await deleteDoc(doc(db, "venues", venueId, "staff", dupId));
      }

      toast.success(`Дубликаты удалены: групп=${duplicatesFound}, docs=${deleteIds.length}`);
    } catch (e) {
      console.error("[dupCleanup] error:", e);
      toast.error(e instanceof Error ? e.message : "Ошибка зачистки дублей");
    } finally {
      setDupCleanupLoading(false);
    }
  };

  const handleSendOffer = async () => {
    const tgId = lookupResult?.tgId ?? lookupResult?.identities?.tg ?? "";
    if (!lookupResult?.userId || !tgId) return;
    setOfferLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch("/api/admin/staff/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: lookupResult.userId,
          venueId: VENUE_ID,
          tgId,
          firstName: lookupResult.firstName ?? undefined,
          lastName: lookupResult.lastName ?? undefined,
          venueName: "Заведение",
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка отправки");
      if (data.notificationSent === false) {
        toast.success("Предложение создано. Сотрудник увидит его при входе в Личный кабинет.");
      } else {
        toast.success("Предложение отправлено. Сотрудник получит сообщение в Telegram.");
      }
      router.refresh();
      resetLookupResults();
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof Error && e.name === "AbortError") {
        toast.error("Ошибка связи с сервером");
      } else {
        toast.error(e instanceof Error ? e.message : "Ошибка отправки предложения");
      }
    } finally {
      setOfferLoading(false);
      setLookupLoading(false);
    }
  };
  // sendOffer: finally всегда разблокирует кнопку (setIsLoading(false))

  const handleCreateNewFromLookup = () => {
    const value = lookupValue.trim();
    const digitsOnly = value.replace(/\D/g, "");
    const identities: UnifiedIdentities = {};
    if (lookupType === "phone" && digitsOnly) {
      identities.phone = digitsOnly;
    } else if (lookupType !== "phone" && value) {
      identities[lookupType] = value.startsWith("@") ? value.slice(1) : value;
    }
    const staffNew: Staff = {
      id: "",
      venueId: VENUE_ID,
      role: "waiter",
      primaryChannel: "telegram",
      identity: { channel: "telegram", externalId: "", locale: "ru" },
      onShift: false,
      phone: lookupType === "phone" && digitsOnly ? digitsOnly : undefined,
      identities: Object.keys(identities).length > 0 ? identities : undefined,
    };
    resetLookupResults();
    setEditingStaff(staffNew);
  };

  const handleDismiss = (staff: Staff) => {
    setDismissModal(staff);
    setExitReasonText("");
    setRating(3);
  };

  const handleDismissSubmit = async () => {
    if (!dismissModal) return;
    if (!exitReasonText.trim()) {
      toast.error("Укажите причину увольнения");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/staff/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: dismissModal.id,
          venueId: VENUE_ID,
          exitReason: exitReasonText.trim(),
          rating,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setStaffList((prev) => prev.filter((s) => s.id !== dismissModal.id));
      setDismissModal(null);
      toast.success("Контракт расторгнут. Запись убрана из списка активных.");
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
        Управление штатом заведения: только сотрудники, привязанные к этому venue. «Отвязать» — снятие связи с заведением (причина увольнения сохраняется в глобальный профиль в архив).
      </p>

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/50 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Phone className="h-4 w-4" />
          Принять по телефону или ID соцсети
        </h3>
        <p className="mt-1 text-xs text-gray-600">
          Выберите тип идентификатора и введите значение — поиск идёт строго по выбранной платформе (без пересечения цифровых ID).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-gray-900 focus-within:border-gray-900">
            <select
              value={lookupType}
              onChange={(e) => {
                setLookupType(e.target.value as LookupSearchType);
                setLookupError(null);
                setLookupResult(null);
                setLookupNotFound(false);
              }}
              className="rounded-l-lg border-0 bg-gray-50 px-3 py-2 text-sm text-gray-700 focus:ring-0"
              aria-label="Тип поиска"
            >
              {SEARCH_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder={SEARCH_PLACEHOLDERS[lookupType]}
              value={lookupValue}
              onChange={(e) => {
                setLookupValue(e.target.value);
                setLookupError(null);
                setLookupResult(null);
                setLookupNotFound(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleLookupByIdentity()}
              className="min-w-[200px] max-w-[280px] rounded-r-lg border-0 border-l border-gray-200 px-3 py-2 text-sm focus:ring-0"
              aria-label="Значение для поиска"
            />
          </div>
          <button
            type="button"
            onClick={handleLookupByIdentity}
            disabled={lookupLoading || !lookupValue.trim()}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {lookupLoading ? "Поиск…" : "Найти"}
          </button>
          <button
            type="button"
            onClick={handleCancelLookup}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Отмена
          </button>
        </div>
        {lookupError && <p className="mt-2 text-sm text-red-600">{lookupError}</p>}
        {lookupResult && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50/80 p-3">
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded-full overflow-hidden bg-gray-200 shrink-0 flex items-center justify-center">
                {lookupResult.photoUrl ? (
                  <img src={lookupResult.photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-6 w-6 text-gray-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">
                  {[lookupResult.firstName, lookupResult.lastName].filter(Boolean).join(" ") || "Без имени"}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {IDENTITY_OPTIONS.filter((o) => o.value !== "email").map((opt) => {
                    const linked = !!(lookupResult!.identities?.[opt.value] ?? (opt.value === "tg" && lookupResult!.tgId));
                    const isFoundBy = lookupResult!.foundBy === opt.value;
                    return (
                      <span
                        key={opt.value}
                        title={`${opt.label}: ${linked ? "привязан" : "нет"}${isFoundBy ? " (найден по этому полю)" : ""}`}
                        className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded px-1 text-[10px] font-medium ${
                          isFoundBy ? "ring-2 ring-blue-500 bg-blue-100 text-blue-800" : linked ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-400"
                        }`}
                      >
                        {opt.short}
                      </span>
                    );
                  })}
                </div>
                {lookupResult.globalScore != null && (
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-amber-700">
                    <Star className="h-3.5 w-3.5" /> Рейтинг: {lookupResult.globalScore}
                  </p>
                )}
                {lookupResult.careerHistory && lookupResult.careerHistory.length > 0 && (
                  <div className="mt-2 flex items-start gap-1.5 text-xs text-gray-600">
                    <BookOpen className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      Опыт: {lookupResult.careerHistory.length} записей (должности: {lookupResult.careerHistory.map((e) => e.position).filter(Boolean).join(", ") || "—"})
                    </span>
                  </div>
                )}
                {lookupResult.medicalCard?.expiryDate && (
                  <p className="mt-1 text-xs text-gray-600">
                    Медкнижка до: {lookupResult.medicalCard.expiryDate}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {offerStatus?.status === "active" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">
                      <span aria-hidden>✅</span> Сотрудник уже в штате заведения
                    </span>
                  ) : offerStatus?.status === "pending_offer" ? (
                    <button
                      type="button"
                      onClick={handleCancelOffer}
                      disabled={cancelOfferLoading}
                      className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      {cancelOfferLoading ? "…" : "Отменить предложение"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSendOffer}
                      disabled={offerLoading}
                      className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50"
                    >
                      {offerLoading && (
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
                      )}
                      {offerLoading ? "Отправка…" : "Отправить предложение"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {lookupNotFound && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3">
            <p className="text-sm text-gray-700">Пользователь не найден в системе.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCreateNewFromLookup}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500"
              >
                Создать нового (данные будут подставлены)
              </button>
              <button
                type="button"
                onClick={handleCancelLookup}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Поиск по имени"
          value={nameSearch}
          onChange={(e) => setNameSearch(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm w-44"
        />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Группа:</span>
          <select
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={groupFilter}
            onChange={(e) => {
              const v = e.target.value as "" | StaffGroup;
              setGroupFilter(v);
              if (v && positionFilter) {
                const allowed = POSITION_GROUPS_V2.find((g) => g.groupId === v)?.roles ?? [];
                if (!allowed.some((r) => r.value === positionFilter)) setPositionFilter("");
              }
            }}
          >
            {GROUP_FILTER_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Briefcase className="h-4 w-4 text-gray-500" />
          <span className="text-gray-600">Должность:</span>
          <select
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
          >
            <option value="">Все</option>
            {positionOptionsForFilter.map((o) => (
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
                    positionLabel={getPositionLabel(s.position ?? "")}
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
          conflictByTableId={(() => {
            const other = staffList.filter((s) => s.id !== editingStaff.id && s.active !== false);
            const out: Record<string, { staffId: string; displayName: string }[]> = {};
            for (const s of other) {
              const name = [s.firstName, s.lastName].filter(Boolean).join(" ") || s.identity?.displayName || s.id.slice(-8);
              for (const tid of s.assignedTableIds ?? []) {
                if (!out[tid]) out[tid] = [];
                out[tid].push({ staffId: s.id, displayName: name });
              }
            }
            return out;
          })()}
          onClose={() => setEditingStaff(null)}
          onSaved={(updated) => {
            if (editingStaff.id) {
              setStaffList((prev) => prev.map((s) => (s.id === editingStaff.id ? { ...s, ...updated } : s)));
            }
            // При добавлении нового сотрудника список обновится по onSnapshot — не дублируем вручную
            setEditingStaff(null);
          }}
        />
      )}

      {dismissModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="dismiss-title">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 id="dismiss-title" className="font-semibold text-gray-900">Расторгнуть контракт (Unlink): {dismissName}</h3>
            <p className="mt-1 text-sm text-gray-600">
              Укажите причину увольнения и оценку (1–5). Связь с заведением будет снята, запись сохранится в архив профиля.
            </p>
            <label className="mt-3 block text-sm font-medium text-gray-700">Причина увольнения</label>
            <textarea
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[80px] resize-y"
              placeholder="Введите причину увольнения…"
              value={exitReasonText}
              onChange={(e) => setExitReasonText(e.target.value)}
              rows={3}
              required
            />
            <label className="mt-3 block text-sm font-medium text-gray-700">Рейтинг (1–5)</label>
            <div className="mt-1 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    rating === n
                      ? "border-amber-500 bg-amber-50 text-amber-700"
                      : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">Выбрано: {rating} из 5</p>
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
                disabled={loading || !exitReasonText.trim()}
              >
                {loading ? "Отправка…" : "Подтвердить"}
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
  conflictByTableId,
  onClose,
  onSaved,
}: {
  staff: Staff;
  tables: TableItem[];
  halls: { id: string; name: string }[];
  /** По tableId — список других активных сотрудников, у которых уже закреплён этот стол */
  conflictByTableId: Record<string, { staffId: string; displayName: string }[]>;
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
  const [medicalCardExpiry, setMedicalCardExpiry] = useState(staff.medicalCard?.expiryDate ?? "");
  const [photoUrl, setPhotoUrl] = useState(staff.photoUrl ?? "");
  const [phone, setPhone] = useState(staff.phone ?? "");
  const [identitiesEntries, setIdentitiesEntries] = useState<{ type: keyof UnifiedIdentities; value: string }[]>(() => {
    const fromIdentities = identitiesToEntries(staff.identities);
    if (fromIdentities.length) return fromIdentities;
    const tg = staff.tgId ?? staff.identity?.externalId ?? "";
    return tg ? [{ type: "tg", value: String(tg).trim() }] : [];
  });
  const [position, setPosition] = useState(staff.position ?? "");
  const [assignedTableIds, setAssignedTableIds] = useState<string[]>(staff.assignedTableIds ?? []);
  const [saving, setSaving] = useState(false);
  const groupAndCall = position ? getGroupAndCallCategory(position) : null;
  const group = groupAndCall?.group ?? (staff.group as StaffGroup | undefined);
  const call_category = groupAndCall?.call_category ?? (staff.call_category as CallCategory | undefined);

  const displayName = (staff.identity?.displayName ?? [firstName, lastName].filter(Boolean).join(" ")) || "Имя для уведомлений";
  const identities = entriesToIdentities(identitiesEntries);
  const primaryTg = identities.tg ?? "";

  const addIdentityRow = () => {
    setIdentitiesEntries((prev) => [...prev, { type: "tg", value: "" }]);
  };

  const updateIdentityRow = (index: number, field: "type" | "value", val: keyof UnifiedIdentities | string) => {
    setIdentitiesEntries((prev) => {
      const next = [...prev];
      if (field === "type") next[index] = { ...next[index], type: val as keyof UnifiedIdentities };
      else next[index] = { ...next[index], value: String(val) };
      return next;
    });
  };

  const removeIdentityRow = (index: number) => {
    setIdentitiesEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!phone.trim()) {
      toast.error("Введите номер телефона");
      return;
    }
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
          identities,
          tgId: primaryTg || undefined,
          position: position || undefined,
          group: group ?? (position ? getGroupAndCallCategory(position)?.group : undefined),
          call_category: call_category ?? (position ? getGroupAndCallCategory(position)?.call_category : undefined),
          assignedTableIds: assignedTableIds,
          medicalCard: medicalCardExpiry.trim() ? { expiryDate: medicalCardExpiry.trim(), lastChecked: null, notes: undefined } : undefined,
          identity: staff.identity ? { ...staff.identity, externalId: primaryTg || staff.identity.externalId, displayName: [firstName, lastName].filter(Boolean).join(" ") || displayName } : { channel: "telegram", externalId: primaryTg, locale: "ru", displayName: [firstName, lastName].filter(Boolean).join(" ") },
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
      if (!res.ok) throw new Error(data.error || data.duplicateWarning || "Ошибка");
      const savedId = data.staffId ?? staff.id;
      const nextGroup = position ? getGroupAndCallCategory(position)?.group : undefined;
      const nextCallCategory = position ? getGroupAndCallCategory(position)?.call_category : undefined;
      const savedPhone = phone.trim() || undefined;
      onSaved({
        ...(savedId ? { id: savedId } : {}),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        gender: gender || undefined,
        birthDate: birthDate || undefined,
        photoUrl: photoUrl.trim() || undefined,
        phone: savedPhone,
        identities,
        tgId: primaryTg || undefined,
        position: position || undefined,
        group: nextGroup,
        call_category: nextCallCategory,
        assignedTableIds: assignedTableIds.length ? assignedTableIds : undefined,
        medicalCard: medicalCardExpiry.trim() ? { expiryDate: medicalCardExpiry.trim(), lastChecked: null, notes: undefined } : undefined,
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
              <label>
                <span className="block text-xs text-gray-600">Дата окончания медкнижки</span>
                <input type="date" value={medicalCardExpiry} onChange={(e) => setMedicalCardExpiry(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
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
            </div>
            <div className="mt-3">
              <span className="block text-xs text-gray-600 mb-2">Привязанные соцсети</span>
              <div className="space-y-2">
                {identitiesEntries.map((row, index) => (
                  <div key={index} className="flex gap-2 items-center">
                    <select
                      value={row.type}
                      onChange={(e) => updateIdentityRow(index, "type", e.target.value as keyof UnifiedIdentities)}
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm w-32"
                    >
                      {IDENTITY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={row.value}
                      onChange={(e) => updateIdentityRow(index, "value", e.target.value)}
                      placeholder={row.type === "email" ? "email@example.com" : row.type === "phone" ? "+7 900 …" : "ID или номер"}
                      className="flex-1 min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeIdentityRow(index)}
                      className="shrink-0 rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                      aria-label="Удалить"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addIdentityRow}
                  className="rounded border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
                >
                  + Добавить еще
                </button>
              </div>
            </div>
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Проф</h4>
            <label>
              <span className="block text-xs text-gray-600">Должность</span>
              <select value={position} onChange={(e) => setPosition(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">—</option>
                {POSITION_GROUPS_V2.map((group) => (
                  <optgroup key={group.groupId} label={group.groupLabel}>
                    {group.roles.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="mt-2 block">
              <span className="block text-xs text-gray-600">Закреплённые столы (по залам)</span>
              <div className="mt-1 space-y-2">
                {tables.length === 0 ? (
                  <span className="text-xs text-gray-500">Нет столов. Добавьте залы и столы в Зал & QR.</span>
                ) : tablesByHall.length === 0 ? (
                  tables.map((t) => {
                    const conflict = conflictByTableId[t.id];
                    const isConflict = conflict && conflict.length > 0;
                    const tooltip = isConflict ? `Уже закреплен за ${conflict.map((c) => c.displayName).join(", ")}` : undefined;
                    return (
                      <label
                        key={t.id}
                        title={tooltip}
                        className={`inline-flex items-center gap-1.5 rounded border px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-50 mr-2 mb-1 ${
                          isConflict ? "border-amber-400 bg-amber-50/80" : "border-gray-200"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={assignedTableIds.includes(t.id)}
                          onChange={() => toggleTable(t.id)}
                          className={`rounded ${isConflict ? "border-amber-500 text-amber-600" : "border-gray-300"}`}
                        />
                        <span>Стол {t.number}</span>
                      </label>
                    );
                  })
                ) : (
                  tablesByHall.map((group) => (
                    <div key={group.hallId || "none"}>
                      <p className="text-xs font-medium text-gray-500 mb-1">{group.hallName}:</p>
                      <div className="flex flex-wrap gap-2">
                        {group.tables.map((t) => {
                          const conflict = conflictByTableId[t.id];
                          const isConflict = conflict && conflict.length > 0;
                          const tooltip = isConflict ? `Уже закреплен за ${conflict.map((c) => c.displayName).join(", ")}` : undefined;
                          return (
                            <label
                              key={t.id}
                              title={tooltip}
                              className={`inline-flex items-center gap-1.5 rounded border px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-50 ${
                                isConflict ? "border-amber-400 bg-amber-50/80" : "border-gray-200"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={assignedTableIds.includes(t.id)}
                                onChange={() => toggleTable(t.id)}
                                className={`rounded ${isConflict ? "border-amber-500 text-amber-600" : "border-gray-300"}`}
                              />
                              <span>{t.number}</span>
                            </label>
                          );
                        })}
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
