"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "lucide-react";

function getTelegramUserIdFromWindow(): string | null {
  if (typeof window === "undefined") return null;
  const id = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: number } } } } })
    .Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return id != null ? String(id) : null;
}

interface ProfileData {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  birthDate: string | null;
  photoUrl: string | null;
  isFreeAgent: boolean;
}

export default function StaffCabinetPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const telegramId = getTelegramUserIdFromWindow();

  useEffect(() => {
    if (!telegramId) {
      setError("Откройте приложение из Telegram");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/staff/profile?telegramId=${encodeURIComponent(telegramId)}`);
      if (cancelled) return;
      if (res.status === 404) {
        router.replace("/mini-app/staff");
        return;
      }
      if (!res.ok) {
        setError("Не удалось загрузить профиль");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setProfile(data);
      setPhone(data.phone ?? "");
      setBirthDate(data.birthDate ?? "");
      setPhotoUrl(data.photoUrl ?? "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [telegramId, router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!telegramId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramId,
          phone: phone.trim() || undefined,
          birthDate: birthDate.trim() || undefined,
          photoUrl: photoUrl.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Ошибка сохранения");
      }
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              phone: phone.trim() || null,
              birthDate: birthDate.trim() || null,
              photoUrl: photoUrl.trim() || null,
            }
          : null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500">Загрузка…</p>
      </main>
    );
  }

  if (error && !profile) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <p className="text-red-600">{error}</p>
        <button
          type="button"
          onClick={() => router.replace("/mini-app/staff")}
          className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
        >
          Назад
        </button>
      </main>
    );
  }

  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "—";

  return (
    <main className="min-h-screen bg-slate-50 p-4 pb-8 md:mx-auto md:max-w-lg md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Личный кабинет</h1>
        <button
          type="button"
          onClick={() => router.replace("/mini-app/staff")}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          Назад
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-4">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200 flex items-center justify-center">
            {profile?.photoUrl ? (
              <img src={profile.photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <User className="h-8 w-8 text-slate-500" />
            )}
          </div>
          <div>
            <p className="font-medium text-slate-900">{fullName}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              Статус: <span className="font-medium text-amber-700">Свободный агент</span>
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <label className="block">
            <span className="block text-xs font-medium text-slate-600">Телефон</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="+7 900 123-45-67"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-600">Дата рождения</span>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-600">Фото (URL)</span>
            <input
              type="url"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="https://..."
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-slate-800 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-slate-500">
        Имя и фамилия задаются при регистрации. Когда заведение отправит вам предложение о работе, вы сможете принять его в боте и получить доступ к сменам.
      </p>
    </main>
  );
}
