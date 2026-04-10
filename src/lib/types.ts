/**
 * HeyWaiter — типы для мультиязычности (Language Free) и мессенджеров.
 * ID мессенджера = паспорт/идентификация в системе.
 */

/**
 * Жизненный цикл предзаказа (модуль Предзаказ).
 * Заглушки под платёжный шлюз / остатки — переходы ready/completed расширятся позже.
 */
export type PreOrderStatus = "draft" | "sent" | "confirmed" | "ready" | "completed" | "cancelled";

/** 8 каналов (Dual-Bot: Client + Staff). Платформы: TG, WA, VK, Viber, WeChat, Insta, FB, Line */
export type MessengerChannel =
  | "telegram"
  | "whatsapp"
  | "vk"
  | "viber"
  | "wechat"
  | "instagram"
  | "facebook"
  | "line";

/** Язык интерфейса (гость видит на своём, персонал — на своём) */
export type LocaleCode =
  | "ru"
  | "en"
  | "zh"
  | "it"
  | "tr"
  | "de"
  | "fr"
  | "es"
  | "ar"
  | string;

/** Идентификатор пользователя в канале (паспорт системы) */
export interface MessengerIdentity {
  channel: MessengerChannel;
  /** ID в мессенджере (например telegram user id, wa phone) */
  externalId: string;
  /** Язык устройства/профиля для Language Free */
  locale: LocaleCode;
  /** Имя из профиля мессенджера (опционально) */
  displayName?: string;
}

/** Роль персонала (staff) — привязка к platformId через код ЛПР */
export type StaffRole = "waiter" | "manager" | "security";

/** Роли обслуживания: вызов из мини-приложения гостя (кнопки по смене). v2: ЛПР, Зал, Кухня, Сервис. */
export type ServiceRole =
  | "waiter"
  | "sommelier"
  | "hookah"
  | "bartender"
  | "runner"
  | "tea_master"
  | "animator"
  | "chef"
  | "sous_chef"
  | "cook"
  | "pastry_chef"
  | "cleaner"
  | "dishwasher"
  | "security"
  | "hostess"
  | "owner"
  | "director"
  | "manager"
  | "administrator";

/** Группы персонала v2: ЛПР (Администрация), Зал (Обслуживание), Кухня (Производство), Сервис (Поддержка). */
export type StaffGroup = "lpr" | "hall" | "kitchen" | "service" | "aux" | "spec";

export const SERVICE_ROLE_GROUP: Record<ServiceRole, StaffGroup> = {
  owner: "lpr",
  director: "lpr",
  manager: "lpr",
  administrator: "lpr",
  waiter: "hall",
  sommelier: "hall",
  hookah: "hall",
  bartender: "hall",
  runner: "hall",
  tea_master: "hall",
  animator: "spec",
  security: "service",
  hostess: "service",
  chef: "kitchen",
  sous_chef: "kitchen",
  cook: "kitchen",
  pastry_chef: "kitchen",
  cleaner: "service",
  dishwasher: "aux",
};

/** Тег для маршрутизации вызовов из Telegram (по группе сотрудника). */
export type CallCategory = "lpr_call" | "order_call" | "kitchen_call" | "service_call";

export const STAFF_GROUP_CALL_CATEGORY: Record<StaffGroup, CallCategory> = {
  lpr: "lpr_call",
  hall: "order_call",
  kitchen: "kitchen_call",
  service: "service_call",
  aux: "service_call",
  spec: "order_call",
};

/** ЛПР — всегда получают уведомления для контроля KPI */
export const LPR_ROLES: ServiceRole[] = ["owner", "director", "manager", "administrator"];

/** Роль в админке (RBAC): owner=ЛПР, superadmin=глобальная аналитика */
export type AdminRole = "owner" | "manager" | "waiter" | "security" | "superadmin";

/** Тип бота: клиентский (гости) или служебный (персонал) */
export type BotType = "client" | "staff";

/** Роль в системе (legacy/универсальная) */
export type Role = "guest" | "waiter" | "head" | "administrator";

/** Конструктор сценариев ЛПР: тексты посадки, брони, благодарности */
export interface VenueMessages {
  checkIn?: string;
  booking?: string;
  thankYou?: string;
}

/** Конфиг ботов: токены Client/Staff по каналам (в т.ч. vkTokens) */
export interface BotsConfig {
  telegram?: { clientToken?: string; staffToken?: string };
  whatsapp?: { clientToken?: string; staffToken?: string };
  vk?: { clientToken?: string; staffToken?: string };
  viber?: { clientToken?: string; staffToken?: string };
  wechat?: { clientToken?: string; staffToken?: string };
  instagram?: { clientToken?: string; staffToken?: string };
  facebook?: { clientToken?: string; staffToken?: string };
  line?: { clientToken?: string; staffToken?: string };
}

/** Настройки заведения: язык для AI-переводчика (PRO) и др. */
export interface VenueSettings {
  language?: LocaleCode;
}

/** Модули Mini App / CRM, рубильники на уровне заведения (перекрывают только часть глобальных флагов). */
export interface VenueModuleConfig {
  preOrder?: {
    enabled?: boolean;
    /** Автоподтверждение предзаказа без участия персонала (платёжный шлюз / ЦУП); по умолчанию false. */
    autoConfirm?: boolean;
  };
}

/** Геозона заведения (Geo-Fencing): радиус в метрах */
export interface VenueGeo {
  lat: number;
  lng: number;
  radius: number;
}

/** Живая геопозиция сотрудника (коллекция staffLiveGeos). Источник правды для красного индикатора на графике. */
export interface StaffLiveGeo {
  staffId: string;
  venueId: string;
  lat: number;
  lng: number;
  isInside: boolean;
  lastUpdate: unknown;
}

/** Тип заведения: полный сервис (столы, официант) или фастфуд (заказ по номеру, выдача) */
export type VenueType = "full_service" | "fast_food";

/** Заведение */
export interface Venue {
  id: string;
  /** Публичный SOTA-ID (8 символов): поиск и QR startapp. */
  sotaId?: string;
  name: string;
  address?: string;
  tablesCount: number;
  /** Тип заведения: полный сервис или фастфуд (меняет логику Mini App и поток заказов) */
  venueType?: VenueType;
  messengerBindings?: MessengerBinding[];
  messages?: VenueMessages;
  botsConfig?: BotsConfig;
  settings?: VenueSettings;
  /** Рубильники модулей (предзаказ и др.); детали — в коде resolvePreOrderEnabled. */
  moduleConfig?: VenueModuleConfig;
  /** Координаты и радиус для Escape Alert (гость/сотрудник покинул зону) */
  geo?: VenueGeo;
  /** Счётчик для номера заказа (Fast Food); инкремент при создании заказа */
  lastOrderNumber?: number;
  /** Гибкое меню: если заполнено — в Mini App показывается кнопка «Меню» */
  config?: {
    menuLink?: string;
    menuPdfUrl?: string;
    menuItems?: string[];
    /** Локальный блок «Акции» заведения (не глобальные слоты super_ads_catalog). Глобальная реклама — только Супер-админ. */
    promos?: { text?: string; imageUrl?: string };
  };
  /** PRO: в CRM показывается рейтинг гостя (globalGuestScore) */
  isPro?: boolean;
  /** Глобальная реклама (super_ads): город/регион для таргетинга */
  adRegion?: string;
  /** Страна для глобального таргетинга баннеров (совпадает с объявлениями countries[]) */
  adCountry?: string;
  /** 1–5 — уровень заведения для подбора баннеров */
  adVenueLevel?: number;
  /** кафе | бар | ресторан — для таргетинга баннеров */
  adCategory?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

/** Статус заказа (Fast Food): в очереди → готов → выдан */
export type OrderStatus = "pending" | "ready" | "completed";

/** Заказ (коллекция orders). Привязка к платформе гостя для зеркального уведомления. */
export interface Order {
  id: string;
  orderNumber: number;
  venueId: string;
  tableId?: string;
  /** @deprecated Legacy delivery channel field. Use customerUid for ownership/billing. */
  guestChatId: string;
  guestPlatform: MessengerChannel;
  /** Split Bill anchor: who created this order/position. */
  customerUid?: string;
  status: OrderStatus;
  createdAt: unknown;
  updatedAt: unknown;
}

/** 4 категории оценки (опрос PRO-гостя) */
export interface ReviewStars {
  kitchen?: number;
  service?: number;
  cleanliness?: number;
  atmosphere?: number;
}

/** Отзыв гостя (коллекция reviews) */
export interface Review {
  id: string;
  venueId: string;
  tableId: string;
  /** Общий балл 1–5 или среднее по категориям */
  stars: number;
  /** Детализация по 4 категориям */
  starsCategories?: ReviewStars;
  text?: string;
  staffIds?: string[];
  sessionId?: string;
  createdAt: unknown;
}

/** Архив визита после закрытия activeSessions (коллекция archived_visits, id = sessionId). */
export interface ArchivedVisit {
  sessionId: string;
  venueId: string;
  tableId: string;
  tableNumber: number;
  masterId: string | null;
  participantUids: string[];
  assignedStaffId: string | null;
  sessionStatusAtArchive: string;
  createdAt: unknown;
  closedAt: unknown;
  archivedAt: unknown;
  closeSource: "guest_feedback_finalized" | "force_closed";
  ordersTotalRub: number;
  guestReviews: { reviewId: string; stars: number; text?: string }[];
  staffRatedGuestAt: unknown;
}

/** Тайм-слот смены (сетевые заведения: точка + время) */
export interface ShiftSlot {
  date: string;
  startTime: string;
  endTime: string;
  venueId: string;
}

/** Запись графика (план/факт). План = endTime−startTime, Факт = checkOut−checkIn из Staff Bot. */
export interface ScheduleEntry {
  id: string;
  venueId: string;
  staffId: string;
  /** Слот смены: дата, время начала/конца, точка */
  slot: ShiftSlot;
  /** План часов (вычисляется из slot.endTime − slot.startTime) */
  planHours?: number;
  /** Факт часов (checkOut − checkIn) */
  factHours?: number;
  /** Реальное время прихода (HH:mm или ISO) от Staff Bot */
  checkIn?: string;
  /** Реальное время ухода (HH:mm или ISO) от Staff Bot */
  checkOut?: string;
  /** Опоздание в минутах */
  lateMinutes?: number;
  /** Ранний уход в минутах */
  earlyLeaveMinutes?: number;
  role?: ServiceRole;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** Привязка двух ботов (Client + Staff) на канал — авто-настройка вебхуков */
export interface MessengerBinding {
  channel: MessengerChannel;
  /** Токен Client-бота (гости) */
  clientToken?: string;
  /** Токен Staff-бота (персонал) */
  staffToken?: string;
  config?: Record<string, string | boolean>;
  enabled: boolean;
  updatedAt: unknown;
}

/** Закрепление сотрудников по ролям за столом (assignedStaffId по роли) */
export type TableAssignments = Partial<Record<ServiceRole, string>>;

/** Стол */
export interface Table {
  id: string;
  venueId: string;
  number: number;
  status: "free" | "occupied" | "reserved";
  currentWaiterId?: string;
  /** Закреплённые сотрудники по ролям: сомелье, официант и т.д. */
  assignments?: TableAssignments;
  guestIdentity?: MessengerIdentity;
  occupiedAt?: unknown;
}

/** Причина увольнения (обязательный выбор ЛПР при увольнении) */
export type ExitReason =
  | "own_wish"
  | "professionalism"
  | "discipline"
  | "conflict"
  | "contract_terminated"
  | "other";

/** Запись в карьере сотрудника (Биржа труда) — данные перманентны */
export interface StaffCareerEntry {
  venueId: string;
  position: string;
  joinDate: unknown;
  exitDate: unknown;
  exitReason: ExitReason;
  rating?: number;
  /** Текстовая причина увольнения (от ЛПР) */
  comment?: string;
}

/** Unified ID V.2.0: все 8 соцсетей + phone для единого поиска (один сотрудник = один профиль). */
export interface UnifiedIdentities {
  tg?: string;
  wa?: string;
  vk?: string;
  viber?: string;
  wechat?: string;
  inst?: string;
  fb?: string;
  line?: string;
  phone?: string;
  email?: string;
}

/** Ключи identities для поиска (используются в where(`identities.${key}`, "==", value)). */
export const UNIFIED_IDENTITY_KEYS: (keyof UnifiedIdentities)[] = [
  "tg", "wa", "vk", "viber", "wechat", "inst", "fb", "line", "phone", "email",
];

/** Связь сотрудника с заведением (коллекция global_users). */
export type AffiliationStatus = "active" | "former";

export interface Affiliation {
  venueId: string;
  /** Должность (ключ: sommelier, waiter, …) */
  role: string;
  /** @deprecated Для определения «в штате» использовать только staff.active в коллекции staff (Единый Словарь V.2.0). */
  status: AffiliationStatus;
  position?: string;
  onShift?: boolean;
  assignedTableIds?: string[];
}

/** Медкнижка: часть «трудовой книжки», необязательные поля. */
export interface MedicalCard {
  /** Дата окончания действия медкнижки (ISO date YYYY-MM-DD) */
  expiryDate: string | null;
  /** Дата последней проверки (ISO date) */
  lastChecked: string | null;
  notes?: string;
}

/** Глобальный профиль сотрудника (коллекция global_users). Один документ на человека. */
export interface GlobalUser {
  id: string;
  /** Роль профиля в системе: единый реестр для staff/guest/admin. */
  systemRole?: "STAFF" | "GUEST" | "ADMIN";
  firstName?: string;
  lastName?: string;
  gender?: string;
  birthDate?: string;
  photoUrl?: string;
  phone?: string;
  identity?: MessengerIdentity;
  primaryChannel?: MessengerChannel;
  tgId?: string;
  /** Агрегация соцсетей/контактов для поиска по идентификаторам (избежание дубликатов, сквозной профиль). */
  identities?: UnifiedIdentities;
  /** Связи с заведениями */
  affiliations: Affiliation[];
  /** История работы (архив при увольнении) */
  careerHistory?: StaffCareerEntry[];
  /** Медкнижка (опционально) */
  medicalCard?: MedicalCard;
  globalScore?: number;
  guestRating?: number;
  venueRating?: number;
  updatedAt?: unknown;
  /** SOTA-ID сотрудника (S + подтип + 6 Base36), дублируется в staff при необходимости. */
  sotaId?: string;
}

/** Цифровой паспорт сотрудника (вид в контексте заведения). Для /admin/team собирается из global_users + staff. */
export interface Staff {
  id: string;
  /** SOTA-ID сотрудника (S + подтип + 6 Base36). */
  sotaId?: string;
  /** ID в global_users (при новой схеме). id может быть составным venueId_userId. */
  userId?: string;
  venueId: string;
  role: Role;
  /** Роль обслуживания для таргетированных уведомлений */
  serviceRole?: ServiceRole;
  primaryChannel: MessengerChannel;
  identity: MessengerIdentity;
  /** На смене: от этого зависит видимость кнопки вызова у гостя */
  onShift: boolean;
  zone?: string;
  tgId?: string;
  /** История карьеры: данные не удаляются при увольнении */
  careerHistory?: StaffCareerEntry[];
  /** Глобальный рейтинг 0–5 (из глобальной коллекции / пересчёт при увольнении) */
  globalScore?: number;
  skills?: string[];
  /** Текущая должность (техн. ключ роли: waiter, chef, …) */
  position?: string;
  /** Группа должности (lpr, hall, kitchen, service) для UI и маршрутизации */
  group?: StaffGroup;
  /** Тег маршрутизации вызовов из Telegram: order_call, service_call, kitchen_call, lpr_call */
  call_category?: CallCategory;
  /** Активен в заведении (false = уволен) */
  active?: boolean;
  /** HR-профиль: личные данные */
  firstName?: string;
  lastName?: string;
  gender?: string;
  birthDate?: string;
  photoUrl?: string;
  /** Связь */
  phone?: string;
  /** ID в соцсетях (для Staff-ботов): tgId, waId и т.д. хранятся в identity или здесь */
  /** Привязанные соцсети (Unified ID): из global_users.identities */
  identities?: UnifiedIdentities;
  /** Медкнижка (опционально), синхронизируется с global_users */
  medicalCard?: MedicalCard;
  /** Проф: закрепление за столами (ID столов) */
  assignedTableIds?: string[];
  /** Сеть: массив venueId — сотрудник закреплён за несколькими точками, в Staff Bot видит адрес на сегодня и «Маршрут» */
  venueIds?: string[];
  /** Системные (read-only): рейтинг от гостей, от ЛПР заведения */
  guestRating?: number;
  venueRating?: number;
  updatedAt: unknown;
}

/** Профиль гостя (CRM): constant=постоянный, шпаргалка только для owner/manager */
export type GuestType = "constant" | "regular" | "favorite" | "vip" | "blacklisted";

export interface GuestPreferences {
  favTable?: string;
  favDish?: string;
  favDrink?: string;
  notes?: string;
}

/** Уровень гостя: free = реклама после обслуживания, pro = опрос (кухня/сервис/чистота/атмосфера) */
export type GuestTier = "free" | "pro";

/** Цифровой профиль гостя — сквозной поиск по всем 7 ID (identifyGuest) */
export interface Guest {
  id: string;
  /** SOTA-ID профиля гостя (G + подтип + 6 Base36). */
  sotaId?: string;
  phone?: string;
  tgId?: string;
  waId?: string;
  vkId?: string;
  viberId?: string;
  wechatId?: string;
  instagramId?: string;
  facebookId?: string;
  lineId?: string;
  name?: string;
  nickname?: string;
  type: GuestType;
  /** free = рекламный блок после обслуживания; pro = опрос 4 пункта */
  tier?: GuestTier;
  preferences?: GuestPreferences;
  birthday?: string;
  gender?: string;
  venueId?: string;
  /** Последний визит (для TTL: не показывать «чужих» старше 7 дней) */
  lastVisitAt?: unknown;
  /** Примечание ЛПР (отображается в карточке и при выборе гостя в бронировании) */
  note?: string;
}

/** Бронь стола (проверка за 30 мин до текущего времени) */
export interface Reservation {
  id: string;
  venueId: string;
  tableId: string;
  /** Telegram ID гостя, владеющего броньью */
  tgId?: string;
  /** Время брони (гость ожидается к этому времени) */
  reservedAt: unknown;
  guestName?: string;
  guestPhone?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

/** Бронирование (редактор в /admin/bookings): ФИО, соцсеть, места, время С/ПО. Цифровой замок: при скане гостя — arrived. */
export interface Booking {
  id: string;
  venueId: string;
  tableId: string;
  /** ФИО гостя */
  guestName: string;
  /** Контакт: соцсеть (tg, wa, …) или телефон */
  guestContact: string;
  /** ID гостя в системе (для цифрового замка при check-in) */
  guestId?: string;
  /** Внешний ID мессенджера (например tgId) для сопоставления при скане */
  guestExternalId?: string;
  /** Количество мест */
  seats: number;
  /** Время начала (ISO или HH:mm в день date) */
  startTime: string;
  /** Время окончания */
  endTime: string;
  /** Дата брони (YYYY-MM-DD) */
  date: string;
  status: "pending" | "confirmed" | "arrived" | "cancelled" | "no_show";
  /** Гость отсканировал QR — сессия активирована */
  arrived?: boolean;
  /** Время начала (Timestamp) для запросов check-in ±30 мин */
  startAt?: unknown;
  /** Примечание к данной брони (разовое, например «свой торт») */
  bookingNote?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

/** Активная сессия гостя за столом. guestChannel + guestChatId — куда слать thankYou при закрытии. */
export type ActiveSessionParticipantStatus = "active" | "paid" | "exited";

export interface ActiveSessionParticipant {
  uid: string;
  status: ActiveSessionParticipantStatus;
  joinedAt: unknown;
  updatedAt?: unknown;
}

export interface ActiveSession {
  id: string;
  venueId: string;
  tableId: string;
  tableNumber: number;
  guestIdentity?: MessengerIdentity;
  /** @deprecated Legacy channel-level identity. Use masterId/participants/customerUid. */
  guestChannel?: MessengerChannel;
  /** @deprecated Legacy chat identifier. Use customerUid contract. */
  guestChatId?: string;
  /** @deprecated Legacy guest profile id. Use customerUid contract. */
  guestId?: string;
  waiterId?: string;
  waiterDisplayName?: string;
  /** Явное поле сессии: закреплённый staff id (swid) — при закрытии визита подставляется из стола. */
  assignedStaffId?: string;
  /** Агрегат для UI: swid из полей сессии (assignedStaffId | waiterId | assignments.waiter). */
  resolvedWaiterStaffId?: string;
  /** UID первого вошедшего гостя (Master). */
  masterId?: string;
  /** Участники стола (коллективная сессия). */
  participants?: ActiveSessionParticipant[];
  /** Приватность стола: true = подселение только с разрешения Master. */
  isPrivate?: boolean;
  /** Закреплённые сотрудники по ролям за этим столом (для Stealth Routing) */
  assignments?: TableAssignments;
  status:
    | "check_in_success"
    | "payment_confirmed"
    | "awaiting_guest_feedback"
    | "completed"
    | "table_conflict"
    | "closed";
  closedAt?: unknown;
  /** После оценки визита ЛПР в Дашборде — чтобы не показывать повторно */
  ratedAt?: unknown;
  /** Ghost GPS: если гость запретил геолокацию — логируем, интерфейс не блокируем */
  geoStatus?: "granted" | "denied";
  createdAt: unknown;
  updatedAt: unknown;
}

/** Вызов официанта; таймер 120s блокирует повторный вызов */
export interface ServiceCall {
  id: string;
  venueId: string;
  tableId: string;
  sessionId?: string;
  type: "waiter";
  status: "pending" | "accepted" | "completed";
  isEscalated: boolean;
  guestLanguage?: LocaleCode;
  acceptedAt?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

/** Уведомление персоналу (Stealth): видят только те, чей id в targetUids */
export interface StaffNotification {
  id: string;
  venueId: string;
  tableId: string;
  sessionId?: string;
  type: string;
  /** Роль вызова: sommelier, hookah, animator и т.д. */
  role?: ServiceRole;
  message: string;
  read: boolean;
  status?: "pending" | "processing" | "completed";
  amount?: number;
  guestName?: string;
  items?: string[];
  /** @deprecated Legacy actor field; prefer customerUid in payload for guest origin. */
  visitorId?: string;
  /** Только эти сотрудники видят уведомление в Staff-боте (изоляция) */
  targetUids: string[];
  createdAt: unknown;
}

/** Событие лога (посадка, вызов, закрытие стола и т.д.) */
export interface LogEntry {
  id: string;
  venueId: string;
  tableId?: string;
  staffId?: string;
  guestIdentity?: MessengerIdentity;
  type: "check_in" | "call_waiter" | "check_out" | "shift_start" | "shift_end" | "rating";
  payload?: Record<string, unknown>;
  createdAt: unknown;
}

/** Тексты для Language Free: ключ — LocaleCode, значение — строка для канала */
export type TranslatedString = Partial<Record<LocaleCode, string>>;

/** Ресурсы интерфейса с переводами */
export interface I18nResource {
  key: string;
  translations: TranslatedString;
}
