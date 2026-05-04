import { StaffAdminLoginClient } from "@/components/auth/StaffAdminLoginClient";

export default function StaffLoginPage() {
  return <StaffAdminLoginClient title="Вход персонала (staff)" defaultNext="/mini-app/staff" />;
}
