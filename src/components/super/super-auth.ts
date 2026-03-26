"use client";

import { auth, signInAnonymously } from "@/lib/firebase";
import { getIdToken } from "firebase/auth";

export async function getSuperAdminBearerToken(): Promise<string> {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  if (!auth.currentUser) return "";
  return await getIdToken(auth.currentUser, true);
}

export async function withSuperAdminAuthHeaders(init?: RequestInit): Promise<RequestInit> {
  const token = await getSuperAdminBearerToken();
  const headers = new Headers(init?.headers ?? undefined);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

