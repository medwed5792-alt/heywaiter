"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { User } from "lucide-react";

function getTelegramUserIdFromWindow(): string | null {
  if (typeof window === "undefined") return null;
  const id = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: number } } } } })
    .Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return id != null ? String(id) : null;
}

function platformKeyFromUrl(raw: string | null): string | null {
  const v = raw?.trim().toLowerCase();
  if (!v) return null;
  switch (v) {
    case "tg":
    case "telegram":
      return "tg";
    case "wa":
    case "whatsapp":
      return "wa";
    case "vk":
    case "vkontakte":
      return "vk";
    case "viber":
      return "viber";
    case "wechat":
      return "wechat";
    case "inst":
    case "instagram":
      return "inst";
    case "fb":
    case "facebook":
      return "fb";
    case "line":
      return "line";
    default:
      return v;
  }
}

interface ProfileData {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  birthDate: string | null;
  photoUrl: string | null;
  isFreeAgent: boolean;
  identities?: Record<string, string | null>;
}

interface PendingOffer {
  staffId: string;
  venueId: string;
  venueName: string;
}

export default function StaffCabinetPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [pendingOffers, setPendingOffers] = useState<PendingOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [offerActionLoading, setOfferActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const telegramId = getTelegramUserIdFromWindow();
  const urlPlatformKey = platformKeyFromUrl(searchParams.get("platform") ?? searchParams.get("channel"));
  const urlPlatformId = searchParams.get("platformId") ?? searchParams.get("chatId") ?? searchParams.get("telegramId");

  const platformKey = urlPlatformKey ?? "tg";
  const platformId = (urlPlatformId ?? telegramId ?? "").trim();

  const [identitiesDraft, setIdentitiesDraft] = useState<Record<string, string>>({
    tg: "",
    wa: "",
    vk: "",
    viber: "",
    wechat: "",
    inst: "",
    fb: "",
    line: "",
  });

  useEffect(() => {
    if (!platformId) {
      setError("Откройте приложение из нужного мессенджера");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [profileRes, offersRes] = await Promise.all([
        fetch(
          `/api/staff/profile?channel=${encodeURIComponent(platformKey)}&platformId=${encodeURIComponent(platformId)}`
        ),
        fetch(
          platformKey === "tg" && telegramId ? `/api/staff/pending-offers?telegramId=${encodeURIComponent(telegramId)}` : "/api/staff/pending-offers?telegramId=" + encodeURIComponent("")
        ),
      ]);
      if (cancelled) return;
      if (profileRes.status === 404) {
        router.replace(
          `/mini-app/staff?platform=${encodeURIComponent(platformKey)}&platformId=${encodeURIComponent(platformId)}`
        );
        return;
      }
      if (!profileRes.ok) {
        setError("Не удалось загрузить профиль");
        setLoading(false);
        return;
      }
      const data = await profileRes.json();
      setProfile(data);
      setPhone(data.phone ?? "");
      setBirthDate(data.birthDate ?? "");
      setPhotoUrl(data.photoUrl ?? "");

      const ids = data.identities ?? {};
      setIdentitiesDraft({
        tg: (ids.tg ?? "") as string,
        wa: (ids.wa ?? "") as string,
        vk: (ids.vk ?? "") as string,
        viber: (ids.viber ?? "") as string,
        wechat: (ids.wechat ?? "") as string,
        inst: (ids.inst ?? "") as string,
        fb: (ids.fb ?? "") as string,
        line: (ids.line ?? "") as string,
      });

      if (offersRes.ok) {
        const offersData = await offersRes.json();
        setPendingOffers(offersData.offers ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [platformId, platformKey, telegramId, router]);

  const handleAcceptOffer = async (staffId: string) => {
    if (!telegramId) return;
    setOfferActionLoading(staffId);
    try {
      const res = await fetch("/api/staff/accept-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, telegramId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setPendingOffers((prev) => prev.filter((o) => o.staffId !== staffId));
      await router.refresh();
      router.replace(
        `/mini-app/staff?platform=${encodeURIComponent(platformKey)}&platformId=${encodeURIComponent(platformId)}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setOfferActionLoading(null);
    }
  };

  const handleDeclineOffer = async (staffId: string) => {
    if (!telegramId) return;
    setOfferActionLoading(staffId);
    try {
      const res = await fetch("/api/staff/decline-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, telegramId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Ошибка");
      }
      setPendingOffers((prev) => prev.filter((o) => o.staffId !== staffId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setOfferActionLoading(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platformId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: platformKey,
          platformId,
          phone: phone.trim() || undefined,
          birthDate: birthDate.trim() || undefined,
          photoUrl: photoUrl.trim() || undefined,
          identities: {
            tg: identitiesDraft.tg.trim(),
            wa: identitiesDraft.wa.trim(),
            vk: identitiesDraft.vk.trim(),
            viber: identitiesDraft.viber.trim(),
            wechat: identitiesDraft.wechat.trim(),
            inst: identitiesDraft.inst.trim(),
            fb: identitiesDraft.fb.trim(),
            line: identitiesDraft.line.trim(),
          },
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
              identities: {
                ...(prev.identities ?? {}),
                tg: identitiesDraft.tg || null,
                wa: identitiesDraft.wa || null,
                vk: identitiesDraft.vk || null,
                viber: identitiesDraft.viber || null,
                wechat: identitiesDraft.wechat || null,
                inst: identitiesDraft.inst || null,
                fb: identitiesDraft.fb || null,
                line: identitiesDraft.line || null,
              },
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
          onClick={() =>
            router.replace(
              `/mini-app/staff?platform=${encodeURIComponent(platformKey)}&platformId=${encodeURIComponent(platformId)}`
            )
          }
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
          onClick={() =>
            router.replace(
              `/mini-app/staff?platform=${encodeURIComponent(platformKey)}&platformId=${encodeURIComponent(platformId)}`
            )
          }
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          Назад
        </button>
      </div>

      {pendingOffers.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-sm font-medium text-amber-900">У вас есть новое предложение о работе</p>
          {pendingOffers.map((offer) => (
            <div key={offer.staffId} className="mt-3 rounded-lg border border-amber-100 bg-white p-3">
              <p className="text-sm text-slate-700">
                От заведения: <span className="font-medium">{offer.venueName}</span>
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={offerActionLoading === offer.staffId}
                  onClick={() => handleAcceptOffer(offer.staffId)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {offerActionLoading === offer.staffId ? (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : null}
                  Принять
                </button>
                <button
                  type="button"
                  disabled={offerActionLoading === offer.staffId}
                  onClick={() => handleDeclineOffer(offer.staffId)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-800">Мои ID мессенджеров</p>
            <p className="mt-1 text-xs text-slate-500">Заполните 8 каналов и сохраните.</p>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-slate-600">Telegram ID</span>
                <input
                  type="text"
                  value={identitiesDraft.tg}
                  onChange={(e) => setIdentitiesDraft((p) => ({ ...p, tg: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="tgId"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600">WhatsApp ID</span>
                <input
                  type="text"
                  value={identitiesDraft.wa}
                  onChange={(e) => setIdentitiesDraft((p) => ({ ...p, wa: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="waId"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600">Viber ID</span>
                <input
                  type="text"
                  value={identitiesDraft.viber}
                  onChange={(e) => setIdentitiesDraft((p) => ({ ...p, viber: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="viberId"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600">VK ID</span>
                <input
                  type="text"
                  value={identitiesDraft.vk}
                  onChange={(e) => setIdentitiesDraft((p) => ({ ...p, vk: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="vkId"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600">WeChat ID</span>
                <input
                  type="text"
                  value={identitiesDraft.wechat}
                  onChange={(e) => setIdentitiesDraft((p) => ({ ...p, wechat: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="wechatId"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600">Instagram ID</span>
                <input
                  type="text"
                  value={identitiesDraft.inst}
                  onChange={(e) => setIdentitiesDraft((p) => ({ ...p, inst: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="instagramId"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600">Facebook ID</span>
                <input
                  type="text"
                  value={identitiesDraft.fb}
                  onChange={(e) => setIdentitiesDraft((p) => ({ ...p, fb: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="facebookId"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600">Line ID</span>
                <input
                  type="text"
                  value={identitiesDraft.line}
                  onChange={(e) => setIdentitiesDraft((p) => ({ ...p, line: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="lineId"
                />
              </label>
            </div>
          </div>
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
