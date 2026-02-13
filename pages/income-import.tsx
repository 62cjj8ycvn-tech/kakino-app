// pages/income-import.tsx
import React, { useMemo, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";

/**
* 収入CSVインポート（incomes コレクション）
*
* CSV列（ヘッダあり/なし両対応）:
* date, source, amount, memo
*
* Firestore保存形式:
* incomes: addDoc
* {
* registrant: string, // source と同じ（将哉/未有/その他）として保存（後で予算/表示とリンクしやすい）
* date: "YYYY-MM-DD",
* amount: number, // integer, >0
* source: string, // 将哉/未有/その他
* memo: string, // optional
* createdAt, updatedAt
* }
*/

// ✅ 収入の「収入元」(予算ページの「予定収入」とリンクさせる前提)
const INCOME_SOURCES = ["将哉", "未有", "その他"] as const;

type IncomeRowIn = {
date: string;
source: string;
amountRaw: string;
memo: string;
lineNo: number;
};

type IncomeRowOk = {
date: string;
source: string;
amount: number;
memo: string;
lineNo: number;
};

type RowErr = { lineNo: number; messages: string[] };

// ===== 文字の正規化 =====
function cleanCell(s: string) {
return (s ?? "")
.replace(/\u3000/g, " ") // 全角スペース
.replace(/\s+/g, " ")
.trim();
}
function stripQuotes(s: string) {
const t = cleanCell(s);
const u = t.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "").trim();
return u.replace(/"/g, "").replace(/'/g, "").trim();
}
function toNumberSafe(s: string) {
const t = stripQuotes(s).replace(/,/g, "");
const n = Number(t);
return Number.isFinite(n) ? n : NaN;
}

function isValidYMD(ymd: string) {
// YYYY-MM-DD（簡易）
if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
const parts = ymd.split("-");
if (parts.length !== 3) return false;

const y = Number(parts[0]);
const m = Number(parts[1]);
const d = Number(parts[2]);

if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;

const dt = new Date(y, m - 1, d);

return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function fmtYen(n: number) {
const r = Math.round(Number(n) || 0);
return `¥${r.toLocaleString("ja-JP")}`;
}

// ===== CSVパーサ（ダブルクォート対応） =====
function parseCSV(text: string): string[][] {
const rows: string[][] = [];
let row: string[] = [];
let cur = "";
let inQuotes = false;

const pushCell = () => {
row.push(cur);
cur = "";
};
const pushRow = () => {
rows.push(row);
row = [];
};

for (let i = 0; i < text.length; i++) {
const ch = text[i];

if (inQuotes) {
if (ch === '"') {
if (text[i + 1] === '"') {
cur += '"';
i++;
} else {
inQuotes = false;
}
} else {
cur += ch;
}
continue;
}

if (ch === '"') {
inQuotes = true;
continue;
}
if (ch === ",") {
pushCell();
continue;
}
if (ch === "\r") continue;
if (ch === "\n") {
pushCell();
pushRow();
continue;
}
cur += ch;
}

pushCell();
const allEmpty = row.every((c) => cleanCell(c) === "");
if (!allEmpty) pushRow();

return rows;
}

export default function IncomeImportPage() {
const [csvText, setCsvText] = useState("");
const [fileName, setFileName] = useState("");
const [busy, setBusy] = useState(false);
const [resultMsg, setResultMsg] = useState("");

const { okRows, errors, preview } = useMemo(() => {
if (!csvText.trim()) return { okRows: [] as IncomeRowOk[], errors: [] as RowErr[], preview: [] as IncomeRowOk[] };

const table = parseCSV(csvText);
if (table.length === 0) {
return { okRows: [] as IncomeRowOk[], errors: [{ lineNo: 1, messages: ["CSVが空です"] }], preview: [] as IncomeRowOk[] };
}

// ヘッダ検出（ゆるめ）
if (!table[0]) {
return {
okRows: [] as IncomeRowOk[],
errors: [{ lineNo: 1, messages: ["CSVの1行目が取得できません"] }],
preview: [] as IncomeRowOk[],
};
}

const header = table[0].map((h) => cleanCell(h).toLowerCase());
const hasHeader = header.includes("date") && header.includes("source") && header.includes("amount");

const startIdx = hasHeader ? 1 : 0;

// 列位置（ヘッダなしは固定）
const idx = (name: string) => header.indexOf(name);
const colDate = hasHeader ? idx("date") : 0;
const colSource = hasHeader ? idx("source") : 1;
const colAmount = hasHeader ? idx("amount") : 2;
const colMemo = hasHeader ? idx("memo") : 3; // 無ければ空になる

const inRows: IncomeRowIn[] = [];
for (let i = startIdx; i < table.length; i++) {
const lineNo = i + 1;
const row = table[i];
if (!row) continue; // ✅ undefined guard
if (row.every((c) => cleanCell(c) === "")) continue;

inRows.push({
date: row[colDate] ?? "",
source: row[colSource] ?? "",
amountRaw: row[colAmount] ?? "",
memo: row[colMemo] ?? "",
lineNo,
});

}

const errs: RowErr[] = [];
const oks: IncomeRowOk[] = [];

// 同一CSV内の重複を軽く排除（同日・同source・同amount・同memo）
const seen = new Set<string>();

for (const r of inRows) {
const messages: string[] = [];

const date = stripQuotes(r.date);
const source = stripQuotes(r.source);
const amountN = toNumberSafe(r.amountRaw);
const memo = stripQuotes(r.memo);

if (!isValidYMD(date)) messages.push(`dateが不正（${r.date} → ${date}） ※YYYY-MM-DD`);
if (!source) messages.push("sourceが空です");
if (source && !INCOME_SOURCES.includes(source as any)) {
messages.push(`sourceが不正（${source}） ※将哉/未有/その他 のみ`);
}

if (!Number.isFinite(amountN)) {
messages.push(`amountが数値じゃない（${r.amountRaw}）`);
} else {
const a = Math.trunc(amountN);
if (a <= 0) messages.push(`amountが不正（${a}） ※0不可/マイナス不可`);
if (a !== amountN) messages.push(`amountが整数じゃない（${amountN}）`);
}

const amount = Math.trunc(amountN);

const key = `${date}__${source}__${amount}__${memo}`;
if (messages.length === 0) {
if (seen.has(key)) {
// 重複はエラーにせずスキップ扱いにしたいならここを変更
messages.push("同一CSV内で重複行があります");
} else {
seen.add(key);
}
}

if (messages.length > 0) {
errs.push({ lineNo: r.lineNo, messages });
} else {
oks.push({ date, source, amount, memo, lineNo: r.lineNo });
}
}

return { okRows: oks, errors: errs, preview: oks.slice(0, 50) };
}, [csvText]);

const canImport = okRows.length > 0 && errors.length === 0 && !busy;

const totalAmount = useMemo(() => okRows.reduce((a, b) => a + (Number(b.amount) || 0), 0), [okRows]);

const onPickFile = async (file: File | null) => {
if (!file) return;
setFileName(file.name);
const text = await file.text();
setCsvText(text);
setResultMsg("");
};

const doImport = async () => {
if (!canImport) return;
setBusy(true);
setResultMsg("");

try {
// 一括追加（addDoc）
for (const r of okRows) {
await addDoc(collection(db, "incomes"), {
registrant: r.source, // ✅ “将哉/未有/その他” とリンクさせるため同値で保存
date: r.date,
amount: r.amount,
source: r.source,
memo: r.memo || "",
createdAt: serverTimestamp(),
updatedAt: serverTimestamp(),
});
}

setResultMsg(`OK：${okRows.length}件を incomes に保存しました（合計 ${fmtYen(totalAmount)}）`);
} catch (e: any) {
console.error(e);
setResultMsg(`失敗：${String(e?.message ?? e)}`);
} finally {
setBusy(false);
}
};

return (
<div style={{ padding: 14, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui, -apple-system" }}>
<h2 style={{ margin: 0, fontSize: 18 }}>収入CSVインポート</h2>
<div style={{ marginTop: 8, color: "#64748b", fontWeight: 700, fontSize: 13 }}>
CSV列：date, source, amount, memo（ヘッダあり/なし両対応）
</div>

{/* file */}
<div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
<label
style={{
display: "inline-flex",
alignItems: "center",
gap: 8,
padding: "8px 12px",
borderRadius: 10,
border: "1px solid #cbd5e1",
background: "#fff",
cursor: "pointer",
fontWeight: 900,
}}
>
<input
type="file"
accept=".csv,text/csv"
style={{ display: "none" }}
onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
/>
CSV選択
</label>
{fileName && <div style={{ fontWeight: 900, color: "#0f172a" }}>{fileName}</div>}

<button
onClick={() => {
setCsvText("");
setFileName("");
setResultMsg("");
}}
style={{
padding: "8px 12px",
borderRadius: 10,
border: "1px solid #cbd5e1",
background: "#fff",
cursor: "pointer",
fontWeight: 900,
}}
>
クリア
</button>

<button
onClick={doImport}
disabled={!canImport}
style={{
padding: "8px 12px",
borderRadius: 10,
border: "1px solid " + (canImport ? "#93c5fd" : "#e5e7eb"),
background: canImport ? "#dbeafe" : "#f1f5f9",
color: "#0b4aa2",
cursor: canImport ? "pointer" : "not-allowed",
fontWeight: 900,
}}
>
{busy ? "保存中…" : "Firestoreに保存"}
</button>
</div>

{/* textarea */}
<div style={{ marginTop: 12 }}>
<textarea
value={csvText}
onChange={(e) => {
setCsvText(e.target.value);
setResultMsg("");
}}
placeholder={`date,source,amount,memo
2026-02-01,将哉,300000,給与
2026-02-05,未有,50000,副業
2026-02-10,その他,12000,還付金`}
style={{
width: "100%",
height: 220,
borderRadius: 12,
border: "1px solid #cbd5e1",
padding: 10,
fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
fontSize: 12,
fontWeight: 700,
outline: "none",
}}
/>
</div>

{/* result */}
{resultMsg && (
<div style={{ marginTop: 10, fontWeight: 900, color: resultMsg.startsWith("OK") ? "#16a34a" : "#dc2626" }}>
{resultMsg}
</div>
)}

{/* errors */}
{errors.length > 0 && (
<div
style={{
marginTop: 14,
border: "1px solid #fecaca",
background: "#fff1f2",
borderRadius: 12,
padding: 10,
}}
>
<div style={{ fontWeight: 900, color: "#991b1b" }}>エラー（{errors.length}件）</div>
<div style={{ marginTop: 8, display: "grid", gap: 6 }}>
{errors.slice(0, 200).map((e, idx) => (
<div key={idx} style={{ fontWeight: 800, color: "#991b1b", fontSize: 12 }}>
行{e.lineNo}: {e.messages.join(" / ")}
</div>
))}
{errors.length > 200 && <div style={{ fontWeight: 900 }}>（表示は200件まで）</div>}
</div>
</div>
)}

{/* preview */}
<div style={{ marginTop: 14, border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "#fff" }}>
<div style={{ fontWeight: 900, color: "#0b4aa2" }}>プレビュー</div>
<div style={{ marginTop: 6, color: "#64748b", fontWeight: 800, fontSize: 12 }}>
OK行: {okRows.length} / エラー: {errors.length} / 合計: {fmtYen(totalAmount)}
</div>

{preview.length === 0 ? (
<div style={{ marginTop: 10, color: "#64748b", fontWeight: 900 }}>（プレビューなし）</div>
) : (
<div style={{ marginTop: 10, display: "grid", gap: 8 }}>
{preview.map((r) => (
<div key={`${r.lineNo}-${r.date}-${r.source}-${r.amount}`} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10 }}>
<div style={{ fontWeight: 900, color: "#0f172a" }}>
{r.date} / {r.source} / {fmtYen(r.amount)}
</div>
{r.memo && <div style={{ marginTop: 4, fontWeight: 800, color: "#64748b", fontSize: 12 }}>{r.memo}</div>}
</div>
))}
{okRows.length > 50 && <div style={{ fontWeight: 900, color: "#64748b" }}>（表示は先頭50件まで）</div>}
</div>
)}
</div>

<div style={{ marginTop: 14, color: "#64748b", fontWeight: 800, fontSize: 12, lineHeight: 1.5 }}>
メモ：
<br />・source は 将哉/未有/その他 のみ（予算ページの予定収入とリンクさせる前提）
<br />・amount は整数のみ、0不可、マイナス不可
<br />・registrant は source と同じ値で保存します（後から集計がラク）
</div>
</div>
);
}