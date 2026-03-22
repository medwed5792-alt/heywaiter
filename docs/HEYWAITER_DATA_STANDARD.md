# Единый стандарт данных HeyWaiter (SOTA)

Цель: один источник правды по заведению, столу и закреплению официанта — без дублирования строк и расходящейся логики.

## 1. Заведение (`venueId`)

| Что | Где |
|-----|-----|
| Дефолт одной «опорной» площадки | `src/lib/standards/venue-default.ts` → `DEFAULT_VENUE_ID` |
| Переопределение без кода | `NEXT_PUBLIC_DEFAULT_VENUE_ID` в `.env` (тот же id, что в Firestore `venues/{id}`) |
| Явный id или дефолт | `resolveVenueId(override?)` |
| URL админки / Mini App staff | `?v=<venueId>`; если нет — `getVenueIdFromSearchParams` → дефолт |

**Правило:** не вставлять литерал `venue_andrey_alt` в бизнес-логику — только импорт из `@/lib/standards/venue-default` или хелперы выше.

## 2. Закрепление официанта за столом

Документ: `venues/{venueId}/tables/{tableId}`.

Порядок полей (единый для дашборда, Mini App, `createGuestEvent`, `push-call-waiter`):

1. `currentWaiterId`
2. `waiterId`
3. `assignments.waiter`
4. `assignedStaffId`

Реализация: `getWaiterIdFromTablePayload` в `src/lib/standards/table-waiter.ts`.  
Клиентский алиас: `getWaiterIdFromTableDoc` в `guest-events.ts` (обёртка без второй логики).

## 3. Профиль сотрудника для пушей и UI

- Карточка смены/роли в контексте заведения: корневая коллекция `staff/{staffDocId}` (и при необходимости `venues/{venueId}/staff/...` по продуктовым правилам).
- Глобальный человек: `global_users/{userId}`.

## 4. Deep link / `start_param`

Формат по умолчанию: `v:{venueId}:t:{tableId}`; опционально `:vid:{visitorId}`.  
Легаси с `_t_` поддерживается парсером `parseStartParamPayload` (`src/lib/parse-start-param.ts`).  
Генерация ссылок: `src/lib/deep-links.ts`.

## 5. API

- Тело запроса с опциональным `venueId`: fallback через `resolveVenueId(body.venueId)`.
- GET с `?venueId=`: то же.

---

При добавлении нового экрана или API: подключить `@/lib/standards` вместо локальных строк.
