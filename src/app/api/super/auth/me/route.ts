export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/superadmin-guard";

export async function GET(request: NextRequest) {
  const res = await requireSuperAdmin(request);
  if (!res.ok) return res.response;
  return NextResponse.json({ ok: true, uid: res.uid });
}

