# HeyWaiter

Omnichannel CRM для ресторанов и заведений. Мультиязычность (Language Free), мессенджеры как интерфейсы: Telegram, WhatsApp, Viber, Instagram, Facebook, WeChat.

## Стек

- **Next.js 14** (App Router)
- **Tailwind CSS**
- **Firebase** (Firestore, Auth, Hosting)
- Масштаб интерфейса: **75%** (`src/app/globals.css`)

## Структура

```
src/
  app/           # App Router: страницы и layout
  app/admin/     # Панель администратора (боты, данные заведений)
  app/api/       # API / webhooks для мессенджеров
  components/    # UI-компоненты
  hooks/         # React-хуки
  lib/           # types.ts, firebase, утилиты
public/
```

## Запуск

```bash
npm install
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000). Админка: `/admin`.

## Переменные окружения

Создайте `.env.local` и добавьте ключи Firebase:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- и остальные из консоли Firebase.
