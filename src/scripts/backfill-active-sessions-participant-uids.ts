/* eslint-disable no-console */
/**
 * Backfill activeSessions.participantUids из masterId и participants[].uid
 * для Staff-Lock и консистентных запросов array-contains.
 *
 * Запуск: npx tsx src/scripts/backfill-active-sessions-participant-uids.ts
 * Запись: npx tsx src/scripts/backfill-active-sessions-participant-uids.ts --write
 */
import { config as loadEnv } from "dotenv";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";

loadEnv();

function participantUidListFromData(data: Record<string, unknown>): string[] {
  const set = new Set<string>();
  const master = typeof data.masterId === "string" ? data.masterId.trim() : "";
  if (master) set.add(master);
  const raw = Array.isArray(data.participants) ? data.participants : [];
  for (const item of raw) {
    const d = (item ?? {}) as Record<string, unknown>;
    const uid = typeof d.uid === "string" ? d.uid.trim() : "";
    if (uid) set.add(uid);
  }
  return [...set];
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

async function main() {
  const write = process.argv.includes("--write");
  const fs = getAdminFirestore();
  const snap = await fs.collection("activeSessions").get();
  let scanned = 0;
  let wouldUpdate = 0;
  let updated = 0;

  for (const doc of snap.docs) {
    scanned++;
    const data = doc.data() as Record<string, unknown>;
    const next = participantUidListFromData(data);
    const prevRaw = data.participantUids;
    const prev = Array.isArray(prevRaw)
      ? prevRaw.map((x) => String(x).trim()).filter(Boolean)
      : [];

    if (next.length > 0 && (prev.length === 0 || !setsEqual(prev, next))) {
      wouldUpdate++;
      console.log(
        `[plan] ${doc.ref.path} participantUids: ${JSON.stringify(prev)} -> ${JSON.stringify(next)}`
      );
      if (write) {
        await doc.ref.update({
          participantUids: next,
          updatedAt: FieldValue.serverTimestamp(),
        });
        updated++;
      }
    }
  }

  console.log(
    JSON.stringify(
      { scanned, planned: wouldUpdate, updated: write ? updated : 0, mode: write ? "write" : "dry-run" },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
