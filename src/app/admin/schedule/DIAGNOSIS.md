# Диагностика страницы /admin/schedule

## 1. Источник данных для Select "Сотрудник (Команда)"

**Переменная:** `staffList` (state, строка 106). В модалку передаётся как проп: `staffList={staffList}` (строка 355).

**Код JSX (AddShiftModal, строки 566–572):**
```jsx
{staffList.map((s) => (
  <option key={s.id} value={s.id}>
    {(s as { displayName?: string }).displayName ?? (s as { name?: string }).name ?? ((s.firstName ?? s.lastName) ? [s.firstName, s.lastName].filter(Boolean).join(" ") : (s.identity?.displayName ?? s.id))}
  </option>
))}
```
То есть в выпадающий список попадает **весь** `staffList` без дополнительной фильтрации в компоненте.

---

## 2. Наполнение массива (onSnapshot)

**Где:** `useEffect` с подпиской на коллекцию `staff` (строки 155–170).

**Код:**
```js
const unsub = onSnapshot(q, (snap) => {
  const allStaff = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Staff));
  setStaffList(
    allStaff
      .filter((s) => (s as { status?: string }).status === "active" || (s as { active?: boolean }).active === true)
      .filter((s) => (s as { status?: string }).status !== "inactive")
  );
});
```

Фильтрация по `status === 'active'` и `active === true` есть, но:
- В Firestore у части сотрудников (о1, гури, с1 и т.д.) может быть `status: 'active'` или `active: true`, поэтому они проходят фильтр и попадают в `staffList`.
- Исключаются только те, у кого явно `status === 'inactive'`. Значения вроде `dismissed` или отсутствие `status` при `active: true` не отсекаются.

Итог: в стейт попадают все, кого Firestore отдаёт с `status === 'active'` или `active === true`, поэтому в списке видны и уволенные, если у них не проставлен `status: 'inactive'`.

---

## 3. Дубликаты "АндрейОф"

В списке используется **уникальный ключ** `key={s.id}` (id документа Firestore).

Если "АндрейОф" отображается дважды, значит в коллекции `staff` есть **два разных документа** с одинаковым отображаемым именем (например, одинаковые `firstName`/`lastName` или `displayName`), но разными `id`. Это не ошибка маппинга ключей, а дублирование записей в БД (два документа на одного человека или две роли).

---

## 4. Таблица ФОТ: почему видны с1 и о2

**Переменная, по которой рендерятся строки:** `rows` внутри `FOTReport` (строки 646–674). Она считается из:
- `entries` — в страницу передаётся как `cleanEntries` (строка 374);
- `cleanEntries = entries.filter((e) => activeStaffIds.includes(e.staffId))` (строки 203–206);
- `activeStaffIds = staffList.map((s) => s.id)` (строка 201).

То есть в таблицу ФОТ попадают только смены, чей `staffId` есть в **текущем** `staffList`. Если с1 и о2 есть в `staffList` (они прошли фильтр в onSnapshot), то их смены попадают в `cleanEntries` и отображаются в таблице.

**Вывод:** таблица ФОТ показывает ровно тех, кто есть в `staffList`. Проблема не в логике таблицы, а в том, что в `staffList` попадают уволенные из‑за мягкой/неполной фильтрации в onSnapshot и отсутствия единого отфильтрованного массива `activeStaff` для всего UI.

---

## Исправление (в коде)

- Ввести единый массив **activeStaff** на странице:
  `activeStaff = staffList.filter(s => s.status === 'active' || s.active === true)` (и при необходимости исключать `status === 'inactive'` / `'dismissed'`).
- Для Select и таблицы ФОТ использовать **только** этот массив:
  - в Select: рендер опций из `activeStaff`;
  - в ФОТ: передавать в отчёт только смены, чей `staffId` входит в `activeStaff`, и подставлять имена только из `activeStaff`.
- Должности подтягивать из профиля сотрудника (role/position) при выборе в Select и при отображении в ФОТ.

После этого источник данных для Select и для таблицы ФОТ будет одним и тем же отфильтрованным списком активных сотрудников.
