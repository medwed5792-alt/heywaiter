"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { logAdClick, logAdImpression } from "@/lib/ad-campaigns";
import { useOptionalGuestContext } from "@/components/mini-app/GuestMiniAppStateProvider";

export type AdSpaceProps = {
  placementId: string;
  className?: string;
};

type AdCampaignDoc = {
  id: string;
  title?: string;
  imageUrl?: string;
  targetUrl?: string;
  venueId?: string | null;
  priority?: number;
};

function getCampaignVenueMatch(campaignVenueId: string | null | undefined, currentVenueId: string | null) {
  // Global campaigns (no venueId) are shown when we don't have a venue context.
  if (!currentVenueId) return !campaignVenueId;
  if (!campaignVenueId) return true;
  return String(campaignVenueId) === currentVenueId;
}

export function AdSpace({ placementId, className }: AdSpaceProps) {
  const guest = useOptionalGuestContext();
  const currentVenueId = guest?.currentLocation.venueId ?? null;
  const adsNetworkEnabled = guest?.systemConfig?.adsNetworkEnabled ?? true;

  const [campaign, setCampaign] = useState<AdCampaignDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!adsNetworkEnabled) {
      setLoading(false);
      setCampaign(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setCampaign(null);

    const run = async () => {
      try {
        if (!placementId) {
          if (!cancelled) setCampaign(null);
          return;
        }

        const q = query(
          collection(db, "ad_campaigns"),
          where("status", "==", "active"),
          where("placementId", "array-contains", placementId),
          orderBy("priority", "desc"),
          limit(20)
        );

        const snap = await getDocs(q);
        if (cancelled) return;

        const list: AdCampaignDoc[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            title: typeof x.title === "string" ? x.title : undefined,
            imageUrl: typeof x.imageUrl === "string" ? x.imageUrl : undefined,
            targetUrl: typeof x.targetUrl === "string" ? x.targetUrl : undefined,
            venueId: typeof x.venueId === "string" ? x.venueId : null,
            priority: typeof x.priority === "number" ? x.priority : 0,
          };
        });

        const venueMatched = list.filter((c) => getCampaignVenueMatch(c.venueId, currentVenueId));
        venueMatched.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

        setCampaign(venueMatched[0] ?? null);
      } catch {
        if (!cancelled) setCampaign(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [placementId, currentVenueId, adsNetworkEnabled]);

  const adId = campaign?.id ?? "";
  const impKey = useMemo(() => (adId ? `ad_imp_${placementId}_${adId}` : ""), [placementId, adId]);

  useEffect(() => {
    if (!adId || loading) return;
    if (typeof sessionStorage === "undefined") return;
    if (!impKey) return;
    if (sessionStorage.getItem(impKey)) return;

    sessionStorage.setItem(impKey, "1");
    void logAdImpression(adId);
  }, [adId, impKey, loading]);

  const skeleton = (
    <div
      className={`h-24 w-full animate-pulse rounded-xl bg-slate-200 ${className ?? ""}`.trim()}
      aria-hidden
    />
  );

  if (!adsNetworkEnabled) return null;
  if (loading) return skeleton;
  if (!campaign) return null;

  const boxClass = `rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${className ?? ""}`.trim();
  const hasImage = Boolean(campaign.imageUrl?.trim());
  const hasTitle = Boolean(campaign.title?.trim());
  const inner = (
    <>
      {hasImage ? (
        <img
          src={campaign.imageUrl}
          alt={campaign.title ?? ""}
          className="max-h-28 w-full rounded-lg object-contain"
        />
      ) : null}
      {hasTitle ? <p className="mt-2 text-sm font-semibold text-slate-900">{campaign.title}</p> : null}
    </>
  );

  const handleClick = () => {
    void logAdClick(adId);
  };

  if (campaign.targetUrl?.trim()) {
    return (
      <a href={campaign.targetUrl} target="_blank" rel="noopener noreferrer" className={boxClass} onClick={handleClick}>
        {inner}
      </a>
    );
  }

  return <div className={boxClass}>{inner}</div>;
}

