// pages/import-expenses.tsx
import React, { useMemo, useState } from "react";
import { collection, doc, writeBatch, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";

type ExpenseRow = {
rowId: string;
date: string; // YYYY-MM-DD
month: string; // YYYY-MM
registrant: string;
amount: number;
category: string;
subCategory: string;
source: string;
memo: string;
};

const REQUIRED_FIELDS = ["rowId", "date", "month", "registrant", "amount", "category", "subCategory", "source"] as const;

function sleep(ms: number) {
return new Promise((res) => setTimeout(res, ms));
}

// 余分なダブルクォートを剥がす（ """"2022-10-06"""" みたいなの対策）
function cleanCell(v: string) {
let s = String(v ?? "").trim();

// 外側の " を剥がす（複数重なってても剥がす）
while (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
s = s.slice(1, -1);
}

// さらに中に """2022-...""" が残るケースを剥がす
s = s.replace(/^"+/, "").replace(/"+$/, "");

return s.trim();
}

function isValidYMD(s: string) {
// YYYY-MM-DD
if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
const [y, m, d] = s.split("-").map((x) => Number(x));
const dt = new Date(y, m - 1, d);
return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function toMonthFromDate(ymd: string) {
if (!ymd) return "";
return ymd.slice(0, 7);
}

function parseAmount(s: string) {
// "2,050" もOK
const raw = cleanCell(s).replace(/,/g, "").trim();
const n = Number(raw);
if (!Number.isFinite(n)) return NaN;
// 支出は0不可（仕様）
if (n === 0) return NaN;
return Math.trunc(n);
}

/**
* CSVを「行配列(string[])の配列」にする（クォート対応）
* - ざっくり堅牢版
*/
function parseCSVToMatrix(text: string): string[][] {
const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const rows: string[][] = [];
let row: string[] = [];
let cell = "";
let inQuotes = false;

for (let i = 0; i < src.length; i++) {
const ch = src[i];

if (ch === '"') {
// "" はエスケープ
const next = src[i + 1];
if (inQuotes && next === '"') {
cell += '"';
i++;
} else {
inQuotes = !inQuotes;
}
continue;
}

if (!inQuotes && ch === ",") {
row.push(cell);
cell = "";
continue;
}

if (!inQuotes && ch === "\n") {
row.push(cell);
const trimmed = row.map((c) => cleanCell(c));
// 空行除外（全部空なら捨てる）
if (trimmed.some((x) => x !== "")) rows.push(trimmed);
row = [];
cell = "";
continue;
}

cell += ch;
}

// last
if (cell.length > 0 || row.length > 0) {
row.push(cell);
const trimmed = row.map((c) => cleanCell(c));
if (trimmed.some((x) => x !== "")) rows.push(trimmed);
}

return rows;
}

/**
* 入力が「通常CSV(1行=1明細)」か「転置CSV(あなたのやつ)」かを自動判定して
* ExpenseRow[] を作る
*/
function parseExpenseRowsAuto(text: string): { rows: ExpenseRow[]; meta: { kind: "normal" | "transposed"; rawRows: number } } {
const matrix = parseCSVToMatrix(text);
if (matrix.length === 0) return { rows: [], meta: { kind: "normal", rawRows: 0 } };

// 判定
// 転置: 1列目が項目名で、rowId/date/month/...が縦に並ぶ
const firstCol = matrix.map((r) => (r[0] ?? "").trim());
const looksTransposed =
firstCol[0] === "rowId" &&
firstCol.includes("date") &&
firstCol.includes("month") &&
firstCol.includes("registrant") &&
firstCol.includes("amount") &&
firstCol.includes("category") &&
firstCol.includes("subCategory") &&
firstCol.includes("source");

// 通常: 1行目がヘッダで rowId,date,month,... が横に並ぶ
const headerRow = matrix[0].map((x) => x.trim());
const looksNormal =
headerRow.includes("rowId") &&
headerRow.includes("date") &&
headerRow.includes("month") &&
headerRow.includes("registrant") &&
headerRow.includes("amount") &&
headerRow.includes("category") &&
headerRow.includes("subCategory") &&
headerRow.includes("source");

if (!looksTransposed && !looksNormal) {
// どっちでもない → とりあえず通常扱いで返す（あとでバリデーションで落ちる）
const rows = parseNormal(matrix);
return { rows, meta: { kind: "normal", rawRows: matrix.length } };
}

if (looksTransposed) {
const rows = parseTransposed(matrix);
return { rows, meta: { kind: "transposed", rawRows: matrix.length } };
}

const rows = parseNormal(matrix);
return { rows, meta: { kind: "normal", rawRows: matrix.length } };

function parseNormal(mat: string[][]): ExpenseRow[] {
if (mat.length < 2) return [];
const headers = mat[0].map((h) => h.trim());

return mat.slice(1).map((line) => {
const obj: Record<string, string> = {};
headers.forEach((h, i) => {
obj[h] = cleanCell(line[i] ?? "");
});

const date = obj.date ?? "";
const month = obj.month ? obj.month : toMonthFromDate(date);

return {
rowId: (obj.rowId ?? "").trim(),
date,
month,
registrant: (obj.registrant ?? "").trim(),
amount: parseAmount(obj.amount ?? ""),
category: (obj.category ?? "").trim(),
subCategory: (obj.subCategory ?? "").trim(),
source: (obj.source ?? "").trim(),
memo: (obj.memo ?? "").trim(),
};
});
}

function parseTransposed(mat: string[][]): ExpenseRow[] {
// 例:
// rowId,1,2,3
// date,2022-10-06,...
// month,2022-10,...
// ...
const fieldToValues = new Map<string, string[]>();
for (const r of mat) {
const key = (r[0] ?? "").trim();
const values = r.slice(1).map((x) => cleanCell(x));
fieldToValues.set(key, values);
}

const rowIds = fieldToValues.get("rowId") ?? [];
const dates = fieldToValues.get("date") ?? [];
const months = fieldToValues.get("month") ?? [];
const registrants = fieldToValues.get("registrant") ?? [];
const amounts = fieldToValues.get("amount") ?? [];
const categories = fieldToValues.get("category") ?? [];
const subCategories = fieldToValues.get("subCategory") ?? [];
const sources = fieldToValues.get("source") ?? [];
const memos = fieldToValues.get("memo") ?? [];

const n = Math.max(
rowIds.length,
dates.length,
months.length,
registrants.length,
amounts.length,
categories.length,
subCategories.length,
sources.length,
memos.length
);

const out: ExpenseRow[] = [];
for (let i = 0; i < n; i++) {
const date = cleanCell(dates[i] ?? "");
const month = cleanCell(months[i] ?? "") || toMonthFromDate(date);

out.push({
rowId: cleanCell(rowIds[i] ?? "").trim(),
date,
month,
registrant: cleanCell(registrants[i] ?? "").trim(),
amount: parseAmount(amounts[i] ?? ""),
category: cleanCell(categories[i] ?? "").trim(),
subCategory: cleanCell(subCategories[i] ?? "").trim(),
source: cleanCell(sources[i] ?? "").trim(),
memo: cleanCell(memos[i] ?? "").trim(),
});
}
return out;
}
}

function validateRow(r: ExpenseRow) {
const reasons: string[] = [];

if (!r.rowId) reasons.push("rowId 空");
if (!isValidYMD(r.date)) reasons.push("date 不正");
if (!/^\d{4}-\d{2}$/.test(r.month)) reasons.push("month 不正");
if (!r.registrant) reasons.push("registrant 空");
if (!Number.isFinite(r.amount) || r.amount === 0) reasons.push("amount 不正(0/NaN)");
if (!r.category) reasons.push("category 空");
if (!r.subCategory) reasons.push("subCategory 空");
if (!r.source) reasons.push("source 空");

return reasons;
}

export default function ImportExpensesPage() {
const [log, setLog] = useState<string>("");
const [busy, setBusy] = useState(false);

// 本番設定（6000件）
const BATCH_SIZE = 400; // 500でもOKだけど、余裕見て400推奨
const SLEEP_MS = 800; // 500〜1000msくらい推奨

function addLog(s: string) {
setLog((prev) => (prev ? prev + "\n" + s : s));
}

async function handleFile(file: File) {
if (busy) return;
setBusy(true);
setLog("");

try {
addLog(`📄 読み込み: ${file.name}`);
const text = await file.text();

const parsed = parseExpenseRowsAuto(text);
const rowsRaw = parsed.rows;

addLog(`形式: ${parsed.meta.kind === "transposed" ? "転置CSV" : "通常CSV"}`);
addLog(`行数(解析後): ${rowsRaw.length}`);

// バリデーションしつつ整形（undefined撲滅）
const okRows: ExpenseRow[] = [];
const ng: { idx: number; reasons: string[] }[] = [];

rowsRaw.forEach((r, i) => {
const reasons = validateRow(r);
if (reasons.length === 0) okRows.push(r);
else ng.push({ idx: i + 2, reasons }); // Excel的に分かりやすく “行番号っぽく”
});

addLog(`✅ 有効: ${okRows.length} / ❌ 無効(スキップ): ${ng.length}`);

if (okRows.length === 0) {
addLog("⚠️ 有効データが0件なので中断。CSVの形を見直して。");
if (ng.length > 0) {
addLog("");
addLog("⚠️ スキップ詳細（先頭20件）:");
ng.slice(0, 20).forEach((x) => addLog(`- 行${x.idx}: ${x.reasons.join(", ")}`));
}
return;
}

// 本番登録（分割バッチ）
let added = 0;

for (let index = 0; index < okRows.length; index += BATCH_SIZE) {
const batch = writeBatch(db);
const chunk = okRows.slice(index, index + BATCH_SIZE);

for (const r of chunk) {
// 安全なdoc id（rowIdがユニーク前提）
const id = `${r.month}__${r.rowId}`;

batch.set(
doc(collection(db, "expenses"), id),
{
registrant: r.registrant,
date: r.date,
month: r.month,
amount: r.amount,
category: r.category,
subCategory: r.subCategory,
source: r.source,
memo: r.memo || "",
updatedAt: serverTimestamp(),
createdAt: serverTimestamp(),
},
{ merge: false }
);
}

await batch.commit();
added += chunk.length;

addLog(`✅ ${index + 1}〜${index + chunk.length} 件 登録完了（累計 ${added}）`);

// Firestore休憩（重要）
await sleep(SLEEP_MS);
}

addLog("");
addLog(`🎉 完了: 登録 ${added} / スキップ ${ng.length}`);

if (ng.length > 0) {
addLog("");
addLog("⚠️ スキップ詳細（先頭20件）:");
ng.slice(0, 20).forEach((x) => addLog(`- 行${x.idx}: ${x.reasons.join(", ")}`));
}
} catch (e: any) {
console.error(e);
addLog("");
addLog("❌ エラーで停止:");
addLog(String(e?.message ?? e));
} finally {
setBusy(false);
}
}

const boxStyle = useMemo<React.CSSProperties>(
() => ({
padding: 16,
maxWidth: 900,
margin: "0 auto",
fontFamily:
'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Arial',
color: "#0f172a",
}),
[]
);

return (
<div style={boxStyle}>
<h1 style={{ fontSize: 18, fontWeight: 900, color: "#0b4aa2" }}>支出CSV一括登録（本番）</h1>

<div
style={{
marginTop: 10,
padding: 12,
border: "1px solid #e5e7eb",
borderRadius: 12,
background: "#fff",
}}
>
<div style={{ fontSize: 12, fontWeight: 900, color: "#334155", marginBottom: 8 }}>
CSVを選択してアップロード（6000件OK / 転置CSVもOK）
</div>

<input
type="file"
accept=".csv"
disabled={busy}
onChange={(e) => {
const f = e.target.files?.[0];
if (f) handleFile(f);
}}
/>

{busy && (
<div style={{ marginTop: 10, fontWeight: 900, color: "#0b4aa2" }}>
登録中…（画面を閉じないで）
</div>
)}
</div>

<pre
style={{
marginTop: 14,
padding: 12,
border: "1px solid #e2e8f0",
borderRadius: 12,
background: "#0b1220",
color: "#e2e8f0",
whiteSpace: "pre-wrap",
fontSize: 12,
lineHeight: 1.5,
}}
>
{log}
</pre>
</div>
);
}