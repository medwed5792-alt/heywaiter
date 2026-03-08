import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "HeyWaiter — Пульт",
  description: "Mini App для вызова официанта",
};

export default function MiniAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
      {children}
    </>
  );
}
