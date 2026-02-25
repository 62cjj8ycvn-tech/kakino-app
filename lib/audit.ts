// lib/audit.ts
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db, auth } from "./firebase";

export async function writeAuditLog(
action: string,
page: string,
entity?: string,
docId?: string,
payload?: any
) {
try {
const user = auth.currentUser;
if (!user) return;

await addDoc(collection(db, "auditLogs"), {
householdId: "default",
uid: user.uid,
email: user.email ?? "",
action,
page,
entity: entity ?? "",
docId: docId ?? "",
payload: payload ?? null,
ts: serverTimestamp(),
});
} catch (e) {
console.error("audit error", e);
}
}