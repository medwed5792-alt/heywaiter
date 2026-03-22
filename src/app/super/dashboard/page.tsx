"use client";

/**
 * Dashboard Super Admin — главная страница после входа в Кабинет Супер-Админа.
 */
export default function SuperDashboardPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-slate-900">Dashboard Super Admin</h2>
      <p className="text-slate-600">
        Добро пожаловать в центр управления. Используйте боковое меню для перехода к разделам: каталог персонала, боты, система, инфраструктура.
      </p>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-medium text-slate-700">Быстрый доступ</h3>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-600">
          <li>
            <a href="/super/catalog" className="text-zinc-600 underline hover:text-zinc-800">
              Каталог персонала (global_users)
            </a>
          </li>
          <li>
            <a href="/super/system" className="text-zinc-600 underline hover:text-zinc-800">
              Система: реклама Mini App (super_ads_catalog)
            </a>
          </li>
          <li>
            <a href="/super/bots" className="text-zinc-600 underline hover:text-zinc-800">
              Настройки ботов
            </a>
          </li>
          <li>
            <a href="/super/infrastructure" className="text-zinc-600 underline hover:text-zinc-800">
              Инфраструктура
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
