# Схема Firestore — HeyWaiter (Omnichannel SaaS CRM)

Глобальный масштаб UI: 75%. Инфраструктура: 8 каналов × 2 бота (Client + Staff): Telegram, WhatsApp, VK, Viber, WeChat, Instagram, Facebook, Line.

---

## 1. Авторизация и регистрация

### `users` (Firebase Auth + профиль)
- Используется для ЛПР: регистрация по Email/Google через Web.
- Дополнительные поля хранятся в документе по `uid` (подколлекция или отдельная коллекция `userProfiles`).

### `venues`
| Поле | Тип | Описание |
|------|-----|----------|
| id | string | Doc ID |
| name | string | Название заведения |
| address | string | Адрес |
| ownerId | string | UID владельца (ЛПР) |
| tablesCount | number | Количество столов |
| messengerBindings | array | Привязки ботов: `{ channel, clientToken, staffToken, enabled }` |
| messages | map | Конструктор сценариев ЛПР: `{ checkIn, booking, thankYou }` |
| botsConfig | map | Токены по каналам (в т.ч. vk: clientToken, staffToken) для авто-вебхуков |
| geo | map | Geo-Fencing: `{ lat, lng, radius }` (метры). Escape Alert при выходе гостя/сотрудника. |
| subscription | string | `free` \| `pro` |
| createdAt | timestamp | |
| updatedAt | timestamp | |

---

## 2. Персонал (команда)

### `staff`
Связка platformId с ролью после ввода 6-значного кода от ЛПР.

| Поле | Тип | Описание |
|------|-----|----------|
| id | string | Doc ID |
| venueId | string | Заведение |
| tgId, waId, vkId, viberId, ... | string | ID в канале (по одному на канал) |
| role | string | `waiter` \| `manager` \| `security` |
| adminRole | string | Для админки: `owner` \| `manager` \| `waiter` \| `security` |
| onShift | boolean | На смене |
| zone | string | Зона зала |
| position | string | Должность |
| active | boolean | true = в штате, false = уволен (данные не удаляются) |
| careerHistory | array | Биржа труда: `{ venueId, position, joinDate, exitDate, exitReason, rating }` |
| globalScore | number | 0–5, глобальный рейтинг |
| skills | string[] | Навыки |
| invitedAt | timestamp | Когда сгенерирован код / принят |
| updatedAt | timestamp | |

---

## 3. Цифровой профиль гостя (CRM Engine)

### `guests`
Сквозной поиск по всем 8 ID: `identifyGuest(platformId, platform)`.

| Поле | Тип | Описание |
|------|-----|----------|
| id | string | Doc ID |
| phone | string | Телефон |
| tgId, waId, vkId, viberId, wechatId, instagramId, facebookId, lineId | string | ID в каналах |
| name | string | Имя |
| nickname | string | Ник/псевдоним |
| type | string | `constant` \| `regular` \| `favorite` \| `vip` \| `blacklisted` |
| tier | string | `free` \| `pro` — после обслуживания: free = реклама, pro = опрос 4 пункта |
| preferences | map | favTable, favDish, favDrink, notes (шпаргалка для owner/manager) |
| birthday | string | |
| gender | string | |
| venueId | string | Привязка к заведению (опционально) |
| createdAt | timestamp | |
| updatedAt | timestamp | |

**Шпаргалка:** полные preferences и заметки ЛПР видны только owner/manager; официант видит только статус (type).

---

## 4. Правила посадки (30-min Rule)

### `reservations`
| Поле | Тип | Описание |
|------|-----|----------|
| id | string | Doc ID |
| venueId | string | |
| tableId | string | Номер/ID стола |
| tgId | string | Telegram ID гостя — владелец брони (сверка при QR-входе) |
| reservedAt | timestamp | Время брони (окно ±30 мин) |
| guestName | string | |
| guestPhone | string | |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### `activeSessions`
Активная сессия гостя за столом после успешного check-in.

| Поле | Тип | Описание |
|------|-----|----------|
| id | string | Doc ID |
| venueId | string | |
| tableId | string | |
| tableNumber | string/number | |
| guestId | string | Ссылка на guests (если OWN) |
| guestChannel | string | Канал гостя (telegram, vk, …) — куда слать thankYou при закрытии |
| guestChatId | string | ID чата гостя в этом канале |
| guestTgId, guestWaId, ... | string | ID гостя в канале |
| waiterId | string | Закреплённый официант |
| status | string | `check_in_success` \| `table_conflict` \| `closed` |
| closedAt | timestamp | Время закрытия стола |
| createdAt | timestamp | |
| updatedAt | timestamp | |

---

## 5. Уведомления и вызовы

### `staffNotifications`
Уведомления персоналу (новый гость, конфликт брони, предпочтения).

| Поле | Тип | Описание |
|------|-----|----------|
| id | string | Doc ID |
| venueId | string | |
| tableId | string | |
| type | string | `new_guest` \| `table_conflict` \| `sos` |
| message | string | Текст уведомления |
| read | boolean | Прочитано (до нажатия «ПРИНЯТЬ») |
| guestId | string | Для «своего» гостя |
| preferences | map | favDish, favDrink, notes (для официанта) |
| createdAt | timestamp | |

### `serviceCalls`
Вызов официанта (кнопка «ВЫЗВАТЬ ОФИЦИАНТА»). Таймер 120 с.

| Поле | Тип | Описание |
|------|-----|----------|
| id | string | Doc ID |
| venueId | string | |
| tableId | string/number | |
| status | string | `pending` \| `accepted` \| `completed` |
| guestTelegramId | string | ID в канале |
| isEscalated | boolean | Эскалация ЛПР при отсутствии ответа 60 с |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### `staffActions`
Действия персонала из Staff-бота (закрытие стола по номеру, SOS).

| Поле | Тип | Описание |
|------|-----|----------|
| id | string | Doc ID |
| type | string | `close_table` \| `sos` |
| tableId | string | Номер стола |
| staffChatId | string | ID чата сотрудника |
| venueId | string | Опционально |
| createdAt | timestamp | |

---

## 6. Отзывы и график

### `reviews`
| Поле | Тип | Описание |
|------|-----|----------|
| venueId | string | |
| tableId | string | |
| stars | number | 1–5 (общий или среднее по категориям) |
| starsCategories | map | kitchen, service, cleanliness, atmosphere (4 категории) |
| text | string | Текст отзыва |
| staffIds | array | Кто обслуживал |
| sessionId | string | |
| createdAt | timestamp | |

### `scheduleEntries`
| Поле | Тип | Описание |
|------|-----|----------|
| venueId | string | |
| staffId | string | |
| date | string | YYYY-MM-DD |
| planHours | number | |
| factHours | number | Факт в реальном времени |
| role | string | ServiceRole |
| createdAt | timestamp | |
| updatedAt | timestamp | |

---

## 7. Тарифы и аналитика

### `subscriptions` (или поле в `venues`)
| Поле | Тип | Описание |
|------|-----|----------|
| venueId | string | |
| plan | string | `free` \| `pro` |
| guestPlan | string | Для гостя: без рекламы, кастомизация (Pro) |
| expiresAt | timestamp | |

### `analytics` / `logs`
События для глобальной аналитики (SuperAdmin): посещения, рейтинги, конверсии.

---

## Stealth-уведомления

- `staffNotifications`: поле **targetUids** (массив staffId). В Staff-боте запрос: `where('targetUids', 'array-contains', currentStaffId)`, чтобы сотрудник видел только свои вызовы.
- `activeSessions`: поле **assignments** (map роль → staffId) — закрепление сотрудников за столом. Запрос «закреплённый сомелье для стола»: найти сессию по (venueId, tableId), взять `assignments.sommelier`.
- `staff`: поле **serviceRole** (sommelier, hookah, waiter, …) и **onShift** — для Shift-Aware UI и каскада уведомлений.

## Индексы (примеры)

- `reservations`: (venueId, tableId, reservedAt) — правило 30 мин.
- `guests`: по каждому полю ID (tgId, waId, …) для `identifyGuest`.
- `staffNotifications`: (venueId, read); составной для бота: (targetUids array-contains, read, createdAt desc).
- `activeSessions`: (venueId, status).
- `staff`: (venueId, onShift, active); (venueId, onShift, active, serviceRole) для каскада по роли.
- `reviews`: (venueId, createdAt desc).
- `scheduleEntries`: (venueId), (venueId, date), (venueId, staffId).

---

## Роутинг вебхуков

- **16 эндпоинтов:** `POST /api/webhook/{channel}/{botType}`  
  `channel`: telegram, whatsapp, vk, viber, wechat, instagram, facebook, line.  
  `botType`: client, staff.
- Обратная совместимость: `POST /api/webhook/telegram` → обрабатывается как Telegram Client Bot.
