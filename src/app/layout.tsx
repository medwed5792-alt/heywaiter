import type { Metadata } from "next";
import Script from "next/script";
import { Toaster } from "react-hot-toast";
import { VisitorProvider } from "@/components/providers/VisitorProvider";
import "./globals.css";
import {
  MiniAppBotRoleDispatcher,
  MiniAppIdentifyingFallback,
} from "@/components/mini-app/MiniAppBotRoleDispatcher";
import { Suspense } from "react";

/** Смените значение или задайте NEXT_PUBLIC_SOTA_OG_REVISION при деплое — новый og:image URL сбрасывает кеш превью. */
const SOTA_GATEWAY_OG_REVISION =
  process.env.NEXT_PUBLIC_SOTA_OG_REVISION?.trim() || "2.0";

function gatewayMetadataBase(): URL {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "https://heywaiter.vercel.app";
  const normalized = raw.replace(/\/$/, "");
  if (/^https?:\/\//i.test(normalized)) {
    return new URL(normalized);
  }
  return new URL(`https://${normalized.replace(/^https?:\/\//, "")}`);
}

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = gatewayMetadataBase();
  const v = encodeURIComponent(SOTA_GATEWAY_OG_REVISION);
  const imagePath = `/opengraph-image?v=${v}`;

  return {
    metadataBase,
    title: "HeyWaiter",
    description: "Omnichannel CRM для ресторанов и заведений",
    openGraph: {
      type: "website",
      locale: "ru_RU",
      siteName: "HeyWaiter",
      title: "HeyWaiter",
      description: "Omnichannel CRM для ресторанов и заведений",
      url: `${metadataBase.origin}/?og=${v}`,
      images: [
        {
          url: imagePath,
          width: 1200,
          height: 630,
          alt: "HeyWaiter — SOTA",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "HeyWaiter",
      description: "Omnichannel CRM для ресторанов и заведений",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="min-h-screen">
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        <VisitorProvider>
          <Suspense fallback={<MiniAppIdentifyingFallback />}>
            <MiniAppBotRoleDispatcher>{children}</MiniAppBotRoleDispatcher>
          </Suspense>
          <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
        </VisitorProvider>
      </body>
    </html>
  );
}
