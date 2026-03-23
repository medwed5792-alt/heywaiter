/**
 * Firebase Admin — только для сервера (API routes, Server Actions).
 * Инициализация по требованию; credentials из env или default (GCP).
 */
require("dotenv").config({ path: ".env.local" });

import type { Firestore } from "firebase-admin/firestore";

let adminFirestore: Firestore | null = null;

function isEdgeRuntime(): boolean {
  return typeof (globalThis as unknown as { EdgeRuntime?: string }).EdgeRuntime === "string" ||
    process.env.NEXT_RUNTIME === "edge";
}

let _warnedMissingCredential = false;

function buildCredentialFromEnv(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !rawKey) {
    if (!_warnedMissingCredential && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      _warnedMissingCredential = true;
      console.warn(
        "[Firebase Admin] Запись в Firestore требует FIREBASE_CLIENT_EMAIL и FIREBASE_PRIVATE_KEY в .env.local (или GOOGLE_APPLICATION_CREDENTIALS)."
      );
    }
    return null;
  }
  const privateKey = rawKey.replace(/\\n/g, "\n");
  return { projectId, clientEmail, privateKey };
}

function getFirebaseAdmin(): { firestore: Firestore } {
  if (typeof window !== "undefined") {
    throw new Error("firebase-admin must not be used in the browser");
  }
  const admin = require("firebase-admin");
  console.log(
    "Available Env Keys:",
    Object.keys(process.env).filter((key) => key.includes("FIREBASE"))
  );
  const existingApps = admin.apps?.length ?? 0;
  if (existingApps === 0) {
    const projectId =
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID;
    const opts: { projectId?: string; credential?: unknown } = {};
    if (projectId) opts.projectId = projectId;

    const envCredential = buildCredentialFromEnv();
    if (envCredential) {
      opts.credential = admin.credential.cert(envCredential);
    } else if (isEdgeRuntime()) {
      throw new Error(
        "Edge Runtime: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in env"
      );
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // ADC: не передаём credential, используется путь из env
    }
    // Иначе инициализация с projectId или по умолчанию (ADC)
    console.log("Firebase ID check:", projectId);
    if (Object.keys(opts).length > 0) {
      admin.initializeApp(opts);
    } else {
      admin.initializeApp();
    }
  }
  if (!adminFirestore) {
    const firestore = admin.firestore() as Firestore;
    firestore.settings({ ignoreUndefinedProperties: true });
    adminFirestore = firestore;
  }
  return { firestore: adminFirestore! };
}

export function getAdminFirestore(): Firestore {
  return getFirebaseAdmin().firestore;
}
