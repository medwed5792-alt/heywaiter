# Аудит: соответствие «Единому Словарю Состояний V.2.0»

## Стандарты полей (база знаний)

| Состояние | Поле | Коллекция | Описание |
|-----------|------|-----------|----------|
| В штате (Active) | `active: true` | staff | Только это поле определяет, что сотрудник в штате. |
| Уволен (Inactive) | `active: false` | staff | **Запрещено использовать поле `status` для определения активности в штате.** |
| На смене (OnShift) | `onShift: true/false` | staff | Готовность принимать вызовы. |
| Роль (Position) | `role` | staff | Должность. |

---

## 1. Файлы с устаревшей логикой (проверки по `status` для штата)

| Файл | Строки | Старая логика | Новая логика по Словарю |
|------|--------|----------------|--------------------------|
| **src/app/admin/schedule/page.tsx** | 207–211, 583, 663, 666, 748, 754 | `(s as { status?: string }).status === "active" \|\| (s as { active?: boolean }).active === true` и двойная проверка `s.active === true && (s as { status?: string }).status === "active"` | Только `s.active === true`. Не использовать `status`. |
| **src/app/api/admin/team/route.ts** | 47 | `const isActive = (data.active !== false) && (aff?.status === "active" ?? true);` | `const isActive = data.active === true;` (определение «в штате» только по полю `active` документа staff). |
| **src/app/admin/team/page.tsx** | 255 | То же: `(data.active !== false) && (aff?.status === "active" ?? true)` | `data.active === true` |
| **src/app/api/staff/venues/route.ts** | 38 | `affiliations.filter((a) => a.status !== "former")` | Контекст: global_users.affiliations. По Словарю для **коллекции staff** используется только `active`. Для списка заведений сотрудника допустимо оставить фильтр по affiliations (отдельная сущность) или синхронизировать с записью в staff по venueId. |

---

## 2. Типы (src/lib/types.ts)

- **Staff**: поля `active?: boolean`, `onShift: boolean`, `role`. Поля `status` в интерфейсе **нет** — соответствует Словарю.
- **Affiliation** (global_users.affiliations): поле `status: AffiliationStatus` («active» | «former») используется в другой коллекции. По Словарю **для определения «в штате»** используется только документ в коллекции **staff** и поле **`active`**. Рекомендация: в типах пометить, что для проверки «сотрудник в штате» используется только `staff.active`; при необходимости пометить `Affiliation.status` как `@deprecated` для сценариев определения активности в штате (см. ниже).

Предлагаемое уточнение в типах:

```ts
// Staff — без изменений: только active, onShift, role.

/** Связь сотрудника с заведением (коллекция global_users). */
export type AffiliationStatus = "active" | "former";

export interface Affiliation {
  venueId: string;
  role: string;
  /** @deprecated Для определения «в штате» использовать только staff.active в коллекции staff. */
  status: AffiliationStatus;
  // ...
}
```

---

## 3. Запись данных (API)

- **src/app/api/admin/staff/upsert/route.ts**: в документ **staff** пишется `active: true`; в **global_users.affiliations** пишется `status: "active"`. По Словарю потребители должны смотреть только **staff.active**; запись в affiliations может остаться для обратной совместимости.
- **src/app/api/admin/staff/dismiss/route.ts**: в **staff** пишется `active: false` (верно). В **venues/[id]/staff** пишется `status: "inactive"` — подколлекция; для отображения «в штате» в приложении использовать только корневой документ **staff** и поле **active**.

---

## 4. План рефакторинга

1. **schedule/page.tsx**  
   - Удалить все проверки `(s as { status?: string }).status === "active"`.  
   - Везде использовать только `s.active === true` (onSnapshot уже фильтрует по `active === true`; activeStaffList, Select, FOTReport — только `active`).

2. **api/admin/team/route.ts**  
   - Заменить `isActive = (data.active !== false) && (aff?.status === "active" ?? true)` на `isActive = data.active === true`.

3. **admin/team/page.tsx**  
   - То же: `isActive = data.active === true`.

4. **api/staff/venues/route.ts**  
   - Оставить как есть или позже заменить фильтр по affiliations на проверку по документам staff по каждому venueId; текущая логика не относится к полю **staff.status**, только к affiliations.

5. **types.ts**  
   - Добавить в JSDoc к `Affiliation.status` пометку `@deprecated` для использования при определении «в штате»; указать, что для этого используется только `staff.active`.

---

## 5. Сводная таблица: [Файл] → [Старая логика] → [Новая логика]

| Файл | Старая логика | Новая логика по Словарю |
|------|----------------|--------------------------|
| **src/app/admin/schedule/page.tsx** (onSnapshot уже только active) | activeStaffList и UI: фильтры с `status === 'active'` и двойная проверка | Только `staffList.filter(s => s.active === true)`. Никаких проверок `status`. |
| **src/app/api/admin/team/route.ts** | `isActive = (data.active !== false) && (aff?.status === "active" ?? true)` | `isActive = data.active === true` |
| **src/app/admin/team/page.tsx** | То же | `isActive = data.active === true` |
| **src/app/api/staff/venues/route.ts** | `a.status !== "former"` в affiliations | Без изменений (контекст global_users) или позже — опора на staff.active по venue. |
| **src/lib/types.ts** | Affiliation.status без пометки | Добавить в JSDoc: для определения «в штате» использовать только staff.active; при необходимости @deprecated для Affiliation.status. |

После внедрения этих правок определение «в штате» будет соответствовать Словарю: только `active: true` в коллекции **staff**, без использования `status`.
