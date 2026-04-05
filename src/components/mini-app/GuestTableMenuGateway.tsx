"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useGuestContext } from "@/components/mini-app/GuestMiniAppStateProvider";
import {
  isNowInMenuGroupInterval,
  type VenueMenuItem,
  type VenueMenuVenueBlock,
} from "@/lib/system-configs/venue-menu-config";

function CatalogReadOnly({
  block,
  timeZone,
  nowMs,
}: {
  block: VenueMenuVenueBlock;
  timeZone: string;
  nowMs: number;
}) {
  const tz = timeZone.trim() || "Europe/Moscow";

  const visibleCategories = useMemo(() => {
    const now = new Date(nowMs);
    const cats = block.categories ?? [];
    return cats
      .filter(
        (c) =>
          c.isActive === true &&
          isNowInMenuGroupInterval({
            now,
            timeZone: tz,
            availableFrom: c.availableFrom,
            availableTo: c.availableTo,
          })
      )
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [block.categories, nowMs, tz]);

  const itemsByCat = useMemo(() => {
    const items = (block.items ?? []).filter((i) => i.isActive === true);
    const m = new Map<string, VenueMenuItem[]>();
    for (const i of items) {
      const list = m.get(i.categoryId) ?? [];
      list.push(i);
      m.set(i.categoryId, list);
    }
    for (const [, list] of m) {
      list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }
    return m;
  }, [block.items]);

  if (!visibleCategories.length) {
    return <p className="text-center text-sm text-slate-500">Сейчас нет доступных групп меню по времени.</p>;
  }

  return (
    <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
      {visibleCategories.map((cat) => {
        const items = itemsByCat.get(cat.id) ?? [];
        if (!items.length) return null;
        return (
          <div key={cat.id}>
            <p className="text-sm font-bold text-slate-900">{cat.name}</p>
            <ul className="mt-2 space-y-2">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="text-slate-800">
                    {it.name}
                    {it.description ? (
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">{it.description}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-semibold text-slate-900">{Math.round(it.price)} ₽</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

type Props = {
  venueFirestoreId: string;
  disabled?: boolean;
};

/**
 * Меню за столом: ветка PDF и/или электронный каталог (конструктор админки), без корзины предзаказа.
 */
export function GuestTableMenuGateway({ venueFirestoreId, disabled }: Props) {
  const { getVenueMenuCatalog, getVenueMenuPdfUrl, getVenueTimeZone } = useGuestContext();
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const id = venueFirestoreId.trim();
  const catalog = id ? getVenueMenuCatalog(id) : null;
  const pdfUrl = id ? getVenueMenuPdfUrl(id)?.trim() ?? "" : "";
  const timeZone = id ? getVenueTimeZone(id) : "";
  const hasCatalog = Boolean(catalog?.categories?.length && catalog?.items?.length);
  const hasPdf = Boolean(pdfUrl);

  const openPdf = () => {
    if (!pdfUrl) return;
    try {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Не удалось открыть PDF");
    }
  };

  const onOpenMenu = () => {
    if (disabled) {
      toast.error("Сначала подтвердите приветствие на столе");
      return;
    }
    if (!hasPdf && !hasCatalog) {
      toast.error("Меню заведения не настроено в админке");
      return;
    }
    if (hasPdf && hasCatalog) {
      setGatewayOpen(true);
      return;
    }
    if (hasPdf) openPdf();
    else setBrowseOpen(true);
  };

  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Меню</p>
        <p className="mt-1 text-xs text-slate-600">PDF или электронный каталог из конструктора заведения</p>
        <button
          type="button"
          disabled={!id || Boolean(disabled)}
          onClick={onOpenMenu}
          className="mt-3 w-full rounded-xl border border-slate-900 bg-white py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
        >
          Открыть меню
        </button>
      </section>

      {gatewayOpen ? (
        <div className="fixed inset-0 z-[60] bg-slate-950/95 p-4">
          <div className="mx-auto flex h-full w-full max-w-md flex-col justify-center">
            <p className="text-center text-base font-semibold text-white">Как открыть меню?</p>
            <div className="mt-4 grid gap-3">
              {hasPdf ? (
                <button
                  type="button"
                  onClick={() => {
                    openPdf();
                    setGatewayOpen(false);
                  }}
                  className="rounded-2xl border border-slate-600 bg-slate-900 py-4 text-center text-base font-bold text-white"
                >
                  PDF / картинка
                </button>
              ) : null}
              {hasCatalog ? (
                <button
                  type="button"
                  onClick={() => {
                    setGatewayOpen(false);
                    setBrowseOpen(true);
                  }}
                  className="rounded-2xl border border-emerald-400 bg-emerald-600 py-4 text-center text-base font-bold text-white"
                >
                  Электронное меню
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setGatewayOpen(false)}
              className="mt-6 text-center text-sm font-medium text-slate-300"
            >
              Закрыть
            </button>
          </div>
        </div>
      ) : null}

      {browseOpen && catalog ? (
        <div className="fixed inset-0 z-[60] bg-white p-4">
          <div className="mx-auto flex h-full max-w-md flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <p className="text-sm font-bold text-slate-900">Электронное меню</p>
              <button
                type="button"
                onClick={() => setBrowseOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                Закрыть
              </button>
            </div>
            <div className="mt-4 flex-1 overflow-hidden">
              <CatalogReadOnly block={catalog} timeZone={timeZone} nowMs={nowMs} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
