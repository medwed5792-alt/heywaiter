import type { Metadata } from "next";
import MiniAppGuestPageClient from "./MiniAppGuestPageClient";

/** searchParams в generateMetadata должны вычисляться на запрос, а не при prerender. */
export const dynamic = "force-dynamic";

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const t = typeof raw === "string" ? raw.trim() : "";
  return t.length > 0 ? t : undefined;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}): Promise<Metadata> {
  const venueId = firstSearchParam(searchParams.venueId);
  const tableId = firstSearchParam(searchParams.tableId);

  if (venueId || tableId) {
    return {
      title: "Добро пожаловать в SOTA",
      description: "Ваш персональный сервис",
    };
  }

  return {
    title: "HeyWaiter — Пульт",
    description: "Omnichannel CRM система",
  };
}

export default function MiniAppPage() {
  return <MiniAppGuestPageClient />;
}
