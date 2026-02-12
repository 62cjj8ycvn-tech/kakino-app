import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

export type BulkTemplateRow = {
enabled: boolean;
category: string;
subCategory: string;
amount: number; // integer (can be negative)
source: string;
};

export type MissingTemplateRow = {
category: string;
subCategory: string;
expectedAmount: number; // integer, judge with ±10%
};

export type BulkTemplateDoc = {
rows: BulkTemplateRow[]; // max 10
updatedAt?: any;
createdAt?: any;
};

export type MissingTemplateDoc = {
rows: MissingTemplateRow[]; // max 15
updatedAt?: any;
createdAt?: any;
};

const TEMPLATES_COL = "templates";
const BULK_ID = "bulkExpense";
const MISSING_ID = "missingCheck";

export async function loadBulkTemplate(): Promise<BulkTemplateDoc> {
const ref = doc(db, TEMPLATES_COL, BULK_ID);
const snap = await getDoc(ref);
if (!snap.exists()) return { rows: [] };
const data = snap.data() as any;
return { rows: Array.isArray(data.rows) ? data.rows : [] };
}

export async function saveBulkTemplate(rows: BulkTemplateRow[]) {
const ref = doc(db, TEMPLATES_COL, BULK_ID);
const now = serverTimestamp();
const snap = await getDoc(ref);
await setDoc(
ref,
{ rows, updatedAt: now, ...(snap.exists() ? {} : { createdAt: now }) },
{ merge: true }
);
}

export async function loadMissingTemplate(): Promise<MissingTemplateDoc> {
const ref = doc(db, TEMPLATES_COL, MISSING_ID);
const snap = await getDoc(ref);
if (!snap.exists()) return { rows: [] };
const data = snap.data() as any;
return { rows: Array.isArray(data.rows) ? data.rows : [] };
}

export async function saveMissingTemplate(rows: MissingTemplateRow[]) {
const ref = doc(db, TEMPLATES_COL, MISSING_ID);
const now = serverTimestamp();
const snap = await getDoc(ref);
await setDoc(
ref,
{ rows, updatedAt: now, ...(snap.exists() ? {} : { createdAt: now }) },
{ merge: true }
);
}