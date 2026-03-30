"use client";

import { Suspense } from "react";
import Link from "next/link";
import { SettingsMenuSection } from "../SettingsMenuSection";

export default function AdminSettingsMenuPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Загрузка…</p>}>
      <div className="max-w-4xl">
        <div className="mb-4 flex items-center gap-3 text-sm text-gray-600">
          <Link href="/admin/settings" className="font-medium text-gray-900 underline-offset-2 hover:underline">
            ← Настройки
          </Link>
          <span aria-hidden>/</span>
          <span>Меню заведения</span>
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Меню заведения</h2>
        <p className="mt-1 text-sm text-gray-600">
          PDF-ссылка и графический каталог настраиваются независимо; гость может пользоваться одним или обоими.
        </p>
        <div className="mt-6">
          <SettingsMenuSection />
        </div>
      </div>
    </Suspense>
  );
}
