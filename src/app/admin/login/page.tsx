import { StaffAdminLoginClient } from "@/components/auth/StaffAdminLoginClient";

export default function AdminLoginPage() {
  return <StaffAdminLoginClient title="Вход в админку" defaultNext="/admin" />;
}
