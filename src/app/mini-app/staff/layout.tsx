import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SOTA — Панель персонала",
  description: "Рабочая панель персонала SOTA",
};

export default function MiniAppStaffLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
