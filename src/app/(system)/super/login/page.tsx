"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SUPERADMIN_ROLE_KEY = "heywaiter_admin_role";
const ROLE_COOKIE = "heywaiter_role";
const VALID_LOGIN = "admin777";
const VALID_PASSWORD = "heywaiter2026";

/** Установка куки роли для Middleware (path=/, 7 дней). */
function setRoleCookie(value: string) {
  if (typeof document === "undefined") return;
  const maxAge = 60 * 60 * 24 * 7;
  document.cookie = `${ROLE_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

/**
 * Страница входа в Интерфейс №4 (Кабинет Супер-Админа).
 * Временное решение для этапа разработки. Стиль "System Gate", тёмная тема.
 */
export default function SuperLoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (login.trim() === VALID_LOGIN && password === VALID_PASSWORD) {
      if (typeof window !== "undefined") {
        localStorage.setItem(SUPERADMIN_ROLE_KEY, "superadmin");
        setRoleCookie("super");
      }
      router.push("/super/dashboard");
    } else {
      setError("Доступ запрещен. Обратитесь к главному администратору.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <h1 className="text-center text-lg font-semibold text-slate-100">
          Вход в систему
        </h1>
        <p className="mt-1 text-center text-xs text-slate-400">
          Кабинет Супер-Админа
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Логин</span>
            <input
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              placeholder="Логин"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              placeholder="Пароль"
            />
          </label>
          {error && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg bg-zinc-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          >
            ВОЙТИ В СИСТЕМУ
          </button>
        </form>
      </div>
    </div>
  );
}
