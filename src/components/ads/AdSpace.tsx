"use client";

import { useEffect, useState, useCallback } from "react";
import type { SuperAdCatalogItem } from "@/lib/super-ads";
import { pickRotatedAdIndex } from "@/lib/super-ads";

type AdSpaceProps = {
  /** Ключ слота из SUPER_AD_PLACEMENTS / каталога */
  placement: string;
  className?: string;
  /** Контекст таргетинга: заведение (API подтянет adRegion / adVenueLevel / adCategory из venues/{venueId}) */
  venueId?: string;
  /** Город/регион гостя; перекрывает venues.adRegion, если задан */
  location?: string;
};

function buildSuperAdsUrl(placement: string, venueId?: string, location?: string): string {
  const params = new URLSearchParams();
  params.set("placement", placement);
  if (venueId?.trim()) params.set("venueId", venueId.trim());
  if (location?.trim()) params.set("location", location.trim());
  return `/api/public/super-ads?${params.toString()}`;
}

async function trackAdEvent(adId: string, event: "impression" | "click"): Promise<void> {
  try {
    await fetch("/api/public/super-ads/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adId, event }),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Глобальный рекламный слот: данные только из `super_ads_catalog` (Супер-админ → /super/catalog → Реклама).
 * Передайте venueId и при необходимости location — подберётся таргетированный баннер, иначе глобальный резерв.
 */
export function AdSpace({ placement, className = "", venueId, location }: AdSpaceProps) {
  const [ad, setAd] = useState<SuperAdCatalogItem | null>(null);
  const impressionTracked = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(buildSuperAdsUrl(placement, venueId, location));
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
  }, [placement, venueId, location]);

  useEffect(() => {
    if (!ad?.id || typeof sessionStorage === "undefined") return;
    const key = `heywaiter_super_ad_imp_${placement}_${ad.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    void trackAdEvent(ad.id, "impression");
  }, [ad?.id, placement]);

  const handleClick = useCallback(() => {
    if (ad?.id) void trackAdEvent(ad.id, "click");
  }, [ad?.id]);

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
        onClick={handleClick}
      >
        {inner}
      </a>
    );
  }

  return <div className={boxClass}>{inner}</div>;
}
