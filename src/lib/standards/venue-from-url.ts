import type { ReadonlyURLSearchParams } from "next/navigation";
import { DEFAULT_VENUE_ID } from "./venue-default";

/** Параметр `v` в URL админки / гостевых экранов; иначе дефолтное заведение. */
export function getVenueIdFromSearchParams(
  searchParams: ReadonlyURLSearchParams | { get: (key: string) => string | null }
): string {
  const v = searchParams.get("v")?.trim();
  return v || DEFAULT_VENUE_ID;
}
