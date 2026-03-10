import type { Metadata } from "next";
import { Toaster } from "react-hot-toast";
import { VisitorProvider } from "@/components/providers/VisitorProvider";
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
      <body className="min-h-screen">
        <VisitorProvider>
          {children}
          <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
        </VisitorProvider>
      </body>
    </html>
  );
}
