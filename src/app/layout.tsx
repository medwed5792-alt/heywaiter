import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HeyWaiter",
  description: "Omnichannel CRM для ресторанов и заведений",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
