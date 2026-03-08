/**
 * HeyWaiter — типы для мультиязычности (Language Free) и мессенджеров.
 * ID мессенджера = паспорт/идентификация в системе.
 */

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

/** Роли обслуживания: вызов из мини-приложения гостя (кнопки по смене) */
export type ServiceRole =
  | "waiter"
  | "sommelier"
  | "hookah"
  | "bartender"
  | "runner"
  | "animator"
  | "chef"
  | "sous_chef"
  | "cook"
  | "cleaner"
  | "dishwasher"
  | "security"
  | "owner"
  | "director"
  | "manager"
  | "administrator";

/** Группы персонала (RBAC): ЛПР, Обслуживание, Кухня, Вспомогательный, Спец */
export type StaffGroup = "lpr" | "service" | "kitchen" | "aux" | "spec";

export const SERVICE_ROLE_GROUP: Record<ServiceRole, StaffGroup> = {
  owner: "lpr",
  director: "lpr",
  manager: "lpr",
  administrator: "lpr",
  waiter: "service",
  sommelier: "service",
  hookah: "service",
  bartender: "service",
  runner: "service",
  animator: "spec",
  security: "spec",
  chef: "kitchen",
  sous_chef: "kitchen",
  cook: "kitchen",
  cleaner: "aux",
  dishwasher: "aux",
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
  name: string;
  address?: string;
  tablesCount: number;
  /** Тип заведения: полный сервис или фастфуд (меняет логику Mini App и поток заказов) */
  venueType?: VenueType;
  messengerBindings?: MessengerBinding[];
  messages?: VenueMessages;
  botsConfig?: BotsConfig;
  settings?: VenueSettings;
  /** Координаты и радиус для Escape Alert (гость/сотрудник покинул зону) */
  geo?: VenueGeo;
  /** Счётчик для номера заказа (Fast Food); инкремент при создании заказа */
  lastOrderNumber?: number;
  /** Гибкое меню: если заполнено — в Mini App показывается кнопка «Меню» */
  config?: {
    menuLink?: string;
    menuPdfUrl?: string;
    menuItems?: string[];
  };
  /** PRO: в CRM показывается рейтинг гостя (globalGuestScore) */
  isPro?: boolean;
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
  guestChatId: string;
  guestPlatform: MessengerChannel;
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
  | "other";

/** Запись в карьере сотрудника (Биржа труда) — данные перманентны */
export interface StaffCareerEntry {
  venueId: string;
  position: string;
  joinDate: unknown;
  exitDate: unknown;
  exitReason: ExitReason;
  rating?: number;
}

/** Цифровой паспорт сотрудника (Биржа труда). Синхронизируется с global_staff для Супер-Админа. */
export interface Staff {
  id: string;
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
  /** Текущая должность */
  position?: string;
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

/** Активная сессия гостя за столом. guestChannel + guestChatId — куда слать thankYou при закрытии. */
export interface ActiveSession {
  id: string;
  venueId: string;
  tableId: string;
  tableNumber: number;
  guestIdentity?: MessengerIdentity;
  guestChannel?: MessengerChannel;
  guestChatId?: string;
  guestId?: string;
  waiterId?: string;
  waiterDisplayName?: string;
  /** Закреплённые сотрудники по ролям за этим столом (для Stealth Routing) */
  assignments?: TableAssignments;
  status: "check_in_success" | "table_conflict" | "closed";
  closedAt?: unknown;
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
