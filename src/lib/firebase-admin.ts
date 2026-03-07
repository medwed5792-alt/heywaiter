/**
 * Firebase Admin — только для сервера (API routes, Server Actions).
 * Инициализация по требованию; credentials из env или default (GCP).
 */
import type { Firestore } from "firebase-admin/firestore";

let adminFirestore: Firestore | null = null;

function getFirebaseAdmin(): { firestore: Firestore } {
  if (typeof window !== "undefined") {
    throw new Error("firebase-admin must not be used in the browser");
  }
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      credential: process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? undefined
        : undefined,
    });
  }
  if (!adminFirestore) {
    adminFirestore = admin.firestore();
  }
  return { firestore: adminFirestore! };
}

export function getAdminFirestore(): Firestore {
  return getFirebaseAdmin().firestore;
}
