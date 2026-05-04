import type { ReactNode } from "react";
import { StaffLayoutChrome } from "@/components/staff/StaffLayoutChrome";

export default function StaffLayout({ children }: { children: ReactNode }) {
  return <StaffLayoutChrome>{children}</StaffLayoutChrome>;
}
