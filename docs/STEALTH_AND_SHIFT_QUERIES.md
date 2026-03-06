# Stealth-уведомления и запросы Firestore

## 1. Найти закреплённого сомелье (или любую роль) для стола

**Цель:** по `venueId`, `tableId` и роли (например `sommelier`) получить `staffId` сотрудника, закреплённого за этим столом.

**Структура данных:** в документе активной сессии хранится поле `assignments` — объект «роль → staffId»:

```ts
activeSessions/{sessionId}: {
  venueId: string,
  tableId: string,
  status: 'check_in_success',
  assignments: {
    sommelier: 'staffId_123',
    waiter: 'staffId_456'
  },
  ...
}
```

**Запрос к Firestore:**

1. Найти активную сессию по столу:

```ts
collection('activeSessions')
  .where('venueId', '==', venueId)
  .where('tableId', '==', tableId)
  .where('status', '==', 'check_in_success')
  .limit(1)
```

2. В единственном документе взять `assignments[role]`:

```ts
const session = snapshot.docs[0]?.data();
const assignedStaffId = session?.assignments?.[role] ?? null;
```

**Альтернатива:** если закрепления хранятся в коллекции `tables` (документ на стол):

```ts
// tables/{venueId}_{tableId} или подколлекция assignments
doc('tables', `${venueId}_${tableId}`)
  .get()
  .then(d => d.data()?.assignments?.[role])
```

Используется в `getAssignedStaffForTable(venueId, tableId, role)` в `src/lib/stealth-notifications.ts`.

---

## 2. Таргетированная маршрутизация (кто получает уведомление)

- **Есть закреплённый за столом сотрудник этой роли**  
  → Уведомление получают: этот сотрудник + все ЛПР (owner, director, manager, administrator) на смене.

- **Нет закреплённого**  
  → Уведомление получают: все сотрудники этой роли на смене + ЛПР (каскад).

В `staffNotifications` записывается массив **`targetUids`** — список `staffId`, которым показывается уведомление. Остальные роли (официанты, кальянщики, другие сомелье не с этого стола) это уведомление не видят.

---

## 3. Выдача уведомлений в Staff-боте (фильтр по targetUids)

В рабочем боте сотрудник видит только свои уведомления:

```ts
collection('staffNotifications')
  .where('targetUids', 'array-contains', currentStaffId)
  .where('read', '==', false)
  .orderBy('createdAt', 'desc')
  .limit(50)
```

В Firestore нужен составной индекс: `targetUids` (array-contains), `read`, `createdAt` (desc).

---

## 4. Shift-Aware UI: какие кнопки показать гостю

Кнопка вызова роли (Сомелье, Кальянщик и т.д.) показывается только если есть хотя бы один сотрудник этой роли на смене.

**Запрос (подписка onSnapshot):**

```ts
collection('staff')
  .where('venueId', '==', venueId)
  .where('onShift', '==', true)
  .where('active', '==', true)
```

Из документов собираются уникальные `serviceRole` (только из списка ролей, доступных гостю: waiter, sommelier, hookah, bartender, runner, animator, security). При уходе сотрудника со смены (`onShift` → false) документ выпадает из выборки — соответствующая кнопка у гостя исчезает без перезагрузки.

Реализация: `subscribeRolesOnShift(venueId, callback)` в `src/lib/shift-aware-roles.ts`, использование в `GuestCallPanel` через хук `useRolesOnShift`.
