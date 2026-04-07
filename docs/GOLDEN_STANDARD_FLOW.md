# Golden Standard Flow: закрытие стола (новая архитектура)

## Целевая модель

Закрытие стола теперь двухэтапное:

1. **Операционный этап (админ/мастер):**
   - сессия переводится из `check_in_success` в `awaiting_guest_feedback`;
   - стол сразу освобождается (`venues/{venueId}/tables/{tableId}.status = "free"`).

2. **Гостевой финал:**
   - после экрана отзыва (и при необходимости чаевых) сессия переводится в `closed`;
   - индекс `active_sessions` переводится в `visit_ended`.

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
- валидирует, что сессия принадлежит `venueId/tableId` и в допустимом статусе (`check_in_success`, `awaiting_guest_feedback`, `completed`);
- обновляет сессию:
  - `status = "awaiting_guest_feedback"`
  - `feedbackRequestedAt = serverTimestamp`
  - `updatedAt = serverTimestamp`
  - при наличии официанта на столе проставляет `assignedStaffId`
  - опционально сохраняет `participants` (для мастер-сценария split bill);
- освобождает стол:
  - `status = "free"`
  - `currentGuest = null`
  - сохраняет `assignments` (merge);
- обновляет индекс `active_sessions` для Telegram-участников сессии:
  - `order_status = "AWAITING_FEEDBACK"`
  - `vr_id`, `table_id`, `last_seen`.

Итог шага:
- стол свободен для новых гостей сразу после операционного закрытия;
- текущий гость (или участники) остаётся в фазе пост-визита для отзыва.

## Шаг 2. Финал после отзыва гостя

Точка входа:
- `POST /api/guest/feedback-session-done`

Как работает:
- роут верифицирует `initData` Telegram Mini App;
- читает `active_sessions/tg_{telegramUserId}`;
- если `order_status !== "AWAITING_FEEDBACK"` -> идемпотентно возвращает `already: true`;
- иначе ищет сессию `activeSessions` по `venueId + tableId` в статусах `awaiting_guest_feedback|completed`.

Use-case:
- `finalizeGuestSessionClosedAfterFeedback(...)` из `src/domain/usecases/session/closeTableSession.ts`

Что делает use-case одним `batch.commit()`:
- если найдена целевая сессия в нужной фазе:
  - `status = "closed"`
  - `closedAt = serverTimestamp`
  - `updatedAt = serverTimestamp`;
- всегда обновляет индекс `active_sessions`:
  - `order_status = "visit_ended"`
  - `last_seen = serverTimestamp`.

## Роль мастер-закрытия (split bill)

Точка входа:
- `POST /api/session/close-table`

Use-case:
- `closeTableByMaster(...)` из `src/domain/usecases/session/masterSplitBill.ts`

Поведение:
- проверяет, что закрывает именно `masterId`;
- завершает открытые заказы (`pending|ready -> completed`);
- нормализует `participants` (активные -> `paid`);
- затем вызывает общий `closeSessionAwaitingGuestFeedback(...)`.

Итог: и админ-сценарий, и мастер-сценарий сходятся в одном стандарте перехода сессии и освобождения стола.

## Важные инварианты

- Нормальный путь закрытия:  
  `check_in_success -> awaiting_guest_feedback -> closed`.
- `closed + free` в один шаг допустим только для force-операций (зависшие кейсы).
- Состояние стола и сессии обновляется атомарно в batch, чтобы не было окна рассинхрона.
- `active_sessions` — источник для recover/follow-up в Mini App, а не признак "стол занят/свободен".
