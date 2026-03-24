/**
 * Разрешение компактного startapp (SOTA) в пары venueId / tableId для Firestore.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { normalizeSotaId } from "@/lib/sota-id";

export type SotaResolveResult = {
  venueId: string;
  /** Пусто — только заведение (хаб без стола). */
  tableId: string;
};

/**
 * Находит venue по полю `sotaId`, стол по `sotaTableCode` (предпочтительно) или по `number`.
 */
export async function resolveSotaStartappToVenueTable(
  db: Firestore,
  venueSotaId: string,
  tableRef: string | null
): Promise<SotaResolveResult | null> {
  const sid = normalizeSotaId(venueSotaId);
  const vq = query(collection(db, "venues"), where("sotaId", "==", sid), limit(1));
  const vs = await getDocs(vq);
  if (vs.empty) return null;
  const venueId = vs.docs[0]!.id;

  if (tableRef == null || tableRef === "") {
    return { venueId, tableId: "" };
  }

  const ref = normalizeSotaId(tableRef);
  const tablesCol = collection(db, "venues", venueId, "tables");
  const byCode = query(tablesCol, where("sotaTableCode", "==", ref), limit(5));
  const snapCode = await getDocs(byCode);
  if (!snapCode.empty) {
    return { venueId, tableId: snapCode.docs[0]!.id };
  }

  const num = Number(ref);
  if (Number.isFinite(num)) {
    const byNum = query(tablesCol, where("number", "==", num), limit(5));
    const snapNum = await getDocs(byNum);
    if (!snapNum.empty) {
      return { venueId, tableId: snapNum.docs[0]!.id };
    }
  }

  const direct = await getDoc(doc(db, "venues", venueId, "tables", ref));
  if (direct.exists()) {
    return { venueId, tableId: direct.id };
  }

  return null;
}
