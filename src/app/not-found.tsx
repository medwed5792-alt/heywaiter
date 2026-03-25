import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Страница не найдена</h1>
        <p className="mt-2 text-sm text-slate-600">
          Возможно, ссылка устарела или страница была перемещена.
        </p>
        <div className="mt-5 flex gap-2">
          <Link
            href="/"
            className="flex-1 rounded-xl bg-slate-900 py-2.5 text-center text-sm font-medium text-white hover:bg-slate-800"
          >
            На главную
          </Link>
          <Link
            href="/mini-app"
            className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Mini App
          </Link>
        </div>
      </div>
    </main>
  );
}

