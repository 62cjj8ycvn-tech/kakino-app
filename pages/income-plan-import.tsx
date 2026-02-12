import React, { useMemo, useState } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";

/**
* 予定収入 CSV インポートページ
*
* CSV列:
* month, registrant, amount
*
* 保存先:
* budgets/{month}__{(全員)}
* incomePlans.{registrant} = amount
*/

type CsvRow = {
month: string;
registrant: string;
amount: string;
lineNo: number;
};

type RowError = {
lineNo: number;
messages: string[];
};

const VALID_REGISTRANTS = ["将哉", "未有", "その他"];
const BUDGET_REG = "(全員)";

// ---------------- utils ----------------
function clean(s: string) {
return (s ?? "")
.replace(/\u3000/g, " ")
.replace(/"/g, "")
.trim();
}

function isValidMonth(ym: string) {
return /^\d{4}-\d{2}$/.test(ym);
}

function toNumberSafe(s: string) {
const n = Number(clean(s).replace(/,/g, ""));
return Number.isFinite(n) ? n : NaN;
}

function parseCSV(text: string): string[][] {
return text
.split("\n")
.map((l) => l.trim())
.filter(Boolean)
.map((l) => l.split(","));
}

function fmtYen(n: number) {
return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

// ---------------- page ----------------
export default function IncomePlanImportPage() {
const [csvText, setCsvText] = useState("");
const [fileName, setFileName] = useState("");
const [busy, setBusy] = useState(false);
const [result, setResult] = useState("");

const { okRows, errors, preview } = useMemo(() => {
if (!csvText.trim()) {
return { okRows: [], errors: [], preview: {} as any };
}

const table = parseCSV(csvText);
const header = table[0]?.map((h) => clean(h).toLowerCase()) ?? [];

const hasHeader =
header.includes("month") &&
header.includes("registrant") &&
header.includes("amount");

const start = hasHeader ? 1 : 0;
const col = (name: string) => header.indexOf(name);

const rows: CsvRow[] = [];
for (let i = start; i < table.length; i++) {
const r = table[i];
rows.push({
month: r[col("month")] ?? "",
registrant: r[col("registrant")] ?? "",
amount: r[col("amount")] ?? "",
lineNo: i + 1,
});
}

const errs: RowError[] = [];
const oks: CsvRow[] = [];

for (const r of rows) {
const msgs: string[] = [];
const month = clean(r.month);
const registrant = clean(r.registrant);
const amount = toNumberSafe(r.amount);

if (!isValidMonth(month)) msgs.push(`month不正 (${r.month})`);
if (!VALID_REGISTRANTS.includes(registrant))
msgs.push(`registrant不正 (${r.registrant})`);
if (!Number.isFinite(amount) || amount < 0)
msgs.push(`amount不正 (${r.amount})`);

if (msgs.length > 0) {
errs.push({ lineNo: r.lineNo, messages: msgs });
} else {
oks.push({
...r,
month,
registrant,
amount: String(amount),
});
}
}

// プレビュー用にまとめる
const pv: Record<string, any> = {};
for (const r of oks) {
const docId = `${r.month}__${BUDGET_REG}`;
pv[docId] ??= { month: r.month, incomePlans: {} };
pv[docId].incomePlans[r.registrant] = Number(r.amount);
}

return { okRows: oks, errors: errs, preview: pv };
}, [csvText]);

const canImport = okRows.length > 0 && errors.length === 0 && !busy;

const onPick = async (f: File | null) => {
if (!f) return;
setFileName(f.name);
setCsvText(await f.text());
setResult("");
};

const doImport = async () => {
if (!canImport) return;
setBusy(true);
setResult("");

try {
for (const [docId, data] of Object.entries(preview)) {
await setDoc(
doc(db, "budgets", docId),
{
month: data.month,
registrant: BUDGET_REG,
incomePlans: data.incomePlans,
updatedAt: serverTimestamp(),
createdAt: serverTimestamp(),
},
{ merge: true }
);
}
setResult(`OK: ${Object.keys(preview).length} 件保存しました`);
} catch (e: any) {
console.error(e);
setResult(`失敗: ${String(e?.message ?? e)}`);
} finally {
setBusy(false);
}
};

return (
<div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
<h2>予定収入 CSV インポート</h2>

<label style={{ fontWeight: 900 }}>
CSV選択
<input
type="file"
accept=".csv"
onChange={(e) => onPick(e.target.files?.[0] ?? null)}
/>
</label>

{fileName && <div>📄 {fileName}</div>}

<textarea
value={csvText}
onChange={(e) => setCsvText(e.target.value)}
placeholder={`month,registrant,amount
2026-03,将哉,330000
2026-03,未有,120000`}
style={{
width: "100%",
height: 200,
marginTop: 12,
fontFamily: "monospace",
}}
/>

{errors.length > 0 && (
<div style={{ color: "red", marginTop: 12 }}>
{errors.map((e) => (
<div key={e.lineNo}>
行{e.lineNo}: {e.messages.join(" / ")}
</div>
))}
</div>
)}

<button
disabled={!canImport}
onClick={doImport}
style={{ marginTop: 12 }}
>
{busy ? "保存中..." : "Firestoreに保存"}
</button>

{result && <div style={{ marginTop: 12 }}>{result}</div>}

{/* preview */}
<div style={{ marginTop: 20 }}>
<h4>プレビュー</h4>
{Object.entries(preview).map(([id, d]: any) => (
<div key={id}>
<b>{id}</b>：
{Object.entries(d.incomePlans).map(([k, v]) => (
<span key={k} style={{ marginLeft: 8 }}>
{k}:{fmtYen(v as number)}
</span>
))}
</div>
))}
</div>
</div>
);
}