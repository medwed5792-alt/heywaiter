# Аудит данных Firestore для модуля Графики

## 1. Где прописана фильтрация по статусу

**Файл:** `src/app/admin/schedule/page.tsx`  
**Функция:** колбэк `onSnapshot` в `useEffect` (строки ~158–169), подписка на коллекцию `staff`:

```js
const unsub = onSnapshot(q, (snap) => {
  const allStaff = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Staff));
  const activeStaffOnly = allStaff.filter((s) => (s as { status?: string }).status === "active");
  setStaffList(activeStaffOnly);
});
```

---

## 2. Какие поля проверяются в коде

В коде проверяется **только** поле `status`:

- `(s as { status?: string }).status === "active"`

Поля **`active`**, **`is_active`**, **`state`** в этой фильтрации **не используются**. Тип `Staff` в `@/lib/types` не объявляет поле `status` на корневом документе staff.

---

## 3. Что реально пишется в коллекцию `staff`

По коду API:

- **Создание сотрудника** (`/api/admin/staff/upsert`, без `staffId`): в корневую коллекцию `staff` пишется документ с полями в т.ч. **`active: true`**. Поле **`status` в документ `staff` не записывается** — оно есть только в `global_users.affiliations[].status` и в подколлекции `venues/{venueId}/staff/{staffId}`.
- **Обновление сотрудника** (upsert с `staffId`): в документ `staff` может передаваться только **`active`** (`...(body.active != null && { active: body.active })`). **`status` в корень `staff` не пишется.**
- **Увольнение** (`/api/admin/staff/dismiss`): в документ `staff` обновляется **`active: false`**. В корневом документе `staff` поле `status` по-прежнему не выставляется; `status: 'inactive'` пишется в **`venues/{venueId}/staff/{staffId}`**.

**Вывод:** в корневой коллекции `staff` у активных сотрудников обычно есть **`active: true`**, а поля **`status` может не быть** (оно не проставляется при создании/обновлении через API). Поэтому фильтр «только `status === 'active'`» отсекает всех, у кого `status` отсутствует.

---

## 4. Решение (реализовано в коде)

Считать сотрудника **активным**, если:

- явно **`status === 'active'`**,  
  **или**
- поле **`status` не задано** (undefined/null), но **`active === true`**.

Исключать из списка тех, у кого явно неактивный статус: **`status === 'inactive'`** или **`active === false`** (чтобы не показывать уволенных).

Фрагмент фильтра в `page.tsx`:

```js
const activeStaffOnly = allStaff.filter((s) => {
  const status = (s as { status?: string }).status;
  const active = (s as { active?: boolean }).active;
  if (status === "inactive" || active === false) return false;
  return status === "active" || active === true;
});
setStaffList(activeStaffOnly);
```

Так список в Графиках и таблице ФОТ будет опираться на реальные поля в базе: и на `status`, и на `active`.
