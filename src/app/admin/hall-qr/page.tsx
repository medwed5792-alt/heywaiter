"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HallQRPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/settings");
  }, [router]);
  return <p className="p-4 text-sm text-gray-500">Перенаправление в Настройки…</p>;
}
