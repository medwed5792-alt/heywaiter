"use client";

import { useEffect, useState } from "react";
import type { SuperAdCatalogItem } from "@/lib/super-ads";
import { pickRotatedAdIndex } from "@/lib/super-ads";

type AdSpaceProps = {
  /** Ключ слота из SUPER_AD_PLACEMENTS / каталога */
  placement: string;
  className?: string;
};

/**
 * Глобальный рекламный слот: данные только из `super_ads_catalog` (Супер-админ → /super/catalog → Реклама).
 * Локальные админы заведений не управляют этим контентом.
 */
export function AdSpace({ placement, className = "" }: AdSpaceProps) {
  const [ad, setAd] = useState<SuperAdCatalogItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/public/super-ads?placement=${encodeURIComponent(placement)}`
        );
        const data = (await res.json()) as { ads?: SuperAdCatalogItem[] };
        const list = data.ads ?? [];
        if (cancelled || list.length === 0) {
          if (!cancelled) setAd(null);
          return;
        }
        const idx = pickRotatedAdIndex(placement, list.length);
        setAd(list[idx] ?? null);
      } catch {
        if (!cancelled) setAd(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [placement]);

  if (!ad) return null;

  const hasContent =
    Boolean(ad.title?.trim()) ||
    Boolean(ad.body?.trim()) ||
    Boolean(ad.imageUrl?.trim());

  if (!hasContent) return null;

  const inner = (
    <>
      {ad.imageUrl ? (
        <img
          src={ad.imageUrl}
          alt=""
          className="max-h-36 w-full rounded-lg object-cover"
        />
      ) : null}
      {ad.title ? (
        <p className={`text-sm font-semibold text-slate-900 ${ad.imageUrl ? "mt-2" : ""}`}>
          {ad.title}
        </p>
      ) : null}
      {ad.body ? <p className="mt-1 text-xs text-slate-600 leading-snug">{ad.body}</p> : null}
    </>
  );

  const boxClass = `rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${className}`;

  if (ad.href?.trim()) {
    return (
      <a
        href={ad.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`block ${boxClass} transition-opacity hover:opacity-95`}
      >
        {inner}
      </a>
    );
  }

  return <div className={boxClass}>{inner}</div>;
}
