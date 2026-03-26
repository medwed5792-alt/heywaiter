import { collection, doc, increment, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type AdCampaignStatus = "active" | "paused";

/**
 * ad_campaigns/{adId} expected fields:
 * - impressions: number
 * - clicks: number
 * (optional) - lastImpressionAt / lastClickAt timestamps
 */
export async function logAdImpression(adId: string): Promise<void> {
  const id = adId.trim();
  if (!id) return;

  try {
    const ref = doc(db, "ad_campaigns", id);
    await setDoc(
      ref,
      {
        impressions: increment(1),
        lastImpressionAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch {
    // best-effort
  }
}

export async function logAdClick(adId: string): Promise<void> {
  const id = adId.trim();
  if (!id) return;

  try {
    const ref = doc(db, "ad_campaigns", id);
    await setDoc(
      ref,
      {
        clicks: increment(1),
        lastClickAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch {
    // best-effort
  }
}

