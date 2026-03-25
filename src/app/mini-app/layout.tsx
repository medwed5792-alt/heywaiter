import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HeyWaiter — Пульт",
  description: "Mini App для вызова официанта",
};

export default function MiniAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
