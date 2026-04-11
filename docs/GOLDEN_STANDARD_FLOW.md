# Golden Standard Flow: закрытие стола (новая архитектура)

## Целевая модель

Закрытие стола теперь двухэтапное:

1. **Операционный этап (только сотрудник в Дашборде):**
   - сессия переводится из `check_in_success` или `payment_confirmed` в `awaiting_guest_feedback`;
   - стол сразу освобождается (`venues/{venueId}/tables/{tableId}.status = "free"`).

2. **Гостевой финал:**
   - после экрана отзыва (и при необходимости чаевых) сессия переводится в `closed`;
   - единственная коллекция жизненного цикла визита — `activeSessions` (отдельный индекс не используется).

Это убирает старый поток "цифра в Staff-боте -> thankYou-сообщение гостю" как источник истины для закрытия.

## Шаг 1. Закрытие в фазу ожидания отзыва

Точка входа:
- `POST /api/admin/close-table-for-feedback`

Payload:
- `venueId`
- `tableId`
- `sessionId`

Use-case:
- `closeSessionAwaitingGuestFeedback(...)` из `src/domain/usecases/session/closeTableSession.ts`

Что делает use-case одним `batch.commit()`:
- валидирует, что сессия принадлежит `venueId/tableId` и в допустимом статусе (`check_in_success`, `payment_confirmed`, `awaiting_guest_feedback`, `completed`);
- обновляет сессию:
  - `status = "awaiting_guest_feedback"`
  - `feedbackRequestedAt = serverTimestamp`
  - `updatedAt = serverTimestamp`
  - при наличии официанта на столе проставляет `assignedStaffId`
  - опционально сохраняет `participants`;
- освобождает стол:
  - `status = "free"`
  - `currentGuest = null`
  - сохраняет `assignments` (merge).

Итог шага:
- стол свободен для новых гостей сразу после операционного закрытия;
- текущий гость (или участники) остаётся в фазе пост-визита для отзыва; Mini App находит сессию по `activeSessions` (подписка по столу / глобальный uid).

## Шаг 2. Финал после отзыва гостя

Точка входа:
- `POST /api/guest/feedback-session-done`

Как работает:
- роут верифицирует `initData` Telegram Mini App;
- по `telegram user id` резолвит профиль `global_users` (поле `identities.tg`) и канонический `tg:<id>`;
- ищет документ в `activeSessions` со статусом `awaiting_guest_feedback` или `completed`, где `masterId` или `participantUids` совпадает с этими идентификаторами (см. `src/lib/active-session-feedback-phase.ts`);
- если сессия не найдена — идемпотентно `{ ok: true, already: true }`.

Use-case:
- `finalizeGuestSessionClosedAfterFeedback(...)` из `src/domain/usecases/session/closeTableSession.ts`

Что делает use-case одним `batch.commit()` при подходящей сессии:
- `status = "closed"`
- `closedAt = serverTimestamp`
- `updatedAt = serverTimestamp`
- при необходимости — запись в `archived_visits`.

**Индексы Firestore** для запросов финала (добавить через консоль или `firestore.indexes.json`):
- `activeSessions`: `masterId` + `status`
- `activeSessions`: `participantUids` (array-contains) + `status`

## Роль мастера стола (split bill)

Точка входа:
- `POST /api/session/close-table`

Use-case:
- `closeTableByMaster(...)` из `src/domain/usecases/session/masterSplitBill.ts`

Поведение:
- проверяет, что закрывает именно `masterId`;
- завершает открытые заказы (`pending|ready -> completed`);
- нормализует `participants` (активные -> `paid`);
- переводит сессию в `payment_confirmed` (`paymentConfirmedAt`, `updatedAt`).

Итог:
- мастер не освобождает стол;
- мастер не переводит сессию в `closed`;
- стол остаётся занятым до явного действия сотрудника в Дашборде;
- в `free` и `awaiting_guest_feedback` переводит только `POST /api/admin/close-table-for-feedback`.

## Важные инварианты

- Нормальный путь закрытия:  
  `check_in_success -> payment_confirmed (опционально) -> awaiting_guest_feedback -> closed`.
- Мастер стола (гость) не имеет права переводить стол в `free`.
- `closed + free` в один шаг допустим только для force-операций (зависшие кейсы).
- Состояние стола и сессии обновляется атомарно в batch, чтобы не было окна рассинхрона.
- Все сценарии гостя после закрытия стола опираются только на `activeSessions` и привязку Telegram ↔ `global_users`.
