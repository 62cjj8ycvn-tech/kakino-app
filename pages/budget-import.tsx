// pages/budget-import.tsx
import React, { useMemo, useState } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { CATEGORIES, SUBCATEGORIES } from "../lib/masterData";

/**
* 予算CSVインポート（budgetsコレクション）
*
* CSV列:
* month, registrant, category, subCategory, budget
*
* 保存形式:
* docId: `${month}__${registrant}`
* {
* month: "YYYY-MM",
* registrant: "(全員)" | "将哉" | "未有" ...,
* categoryBudgets: { [category]: number },
* subBudgets: { [category]: { [subCategory]: number } },
* createdAt, updatedAt
* }
*/

type BudgetDoc = {
month: string;
registrant: string;
categoryBudgets: Record<string, number>;
subBudgets: Record<string, Record<string, number>>;
createdAt?: any;
updatedAt?: any;
};

const ALL_REG = "(全員)";
const FREE_SUB = "自由入力";

// ====== 文字の正規化（ここが超重要： ""2022-11"" を確実に 2022-11 にする） ======
function cleanCell(s: string) {
return (s ?? "")
.replace(/\u3000/g, " ") // 全角スペース
.replace(/\s+/g, " ") // 連続空白潰し
.trim();
}
function stripQuotes(s: string) {
const t = cleanCell(s);
// 両端の " を何重でも剥がす → 残ってる引用符も全消し
const u = t.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "").trim();
return u.replace(/"/g, "").replace(/'/g, "").trim();
}
function isBlankSubCategory(s: string) {
return cleanCell(s) === "";
}
function isValidYM(ym: string) {
return /^\d{4}-\d{2}$/.test(ym);
}
function toNumberSafe(s: string) {
const t = stripQuotes(s).replace(/,/g, "");
const n = Number(t);
return Number.isFinite(n) ? n : NaN;
}
function budgetDocId(month: string, registrant: string) {
return `${month}__${registrant}`;
}

// ====== CSVパーサ（ダブルクォート対応） ======
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
// "" はエスケープされた "
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
if (ch === "\r") {
continue;
}
if (ch === "\n") {
pushCell();
pushRow();
continue;
}
cur += ch;
}

// last
pushCell();
// 空行対策：最後の行が空セルだけなら入れない
const allEmpty = row.every((c) => cleanCell(c) === "");
if (!allEmpty) pushRow();

return rows;
}

// ====== バリデーション & 正規化 ======
type RowIn = {
month: string;
registrant: string;
category: string;
subCategory: string;
budgetRaw: string;
lineNo: number; // 2 start (ヘッダ除く)
};

type RowOk = {
month: string;
registrant: string;
category: string;
subCategory: string; // "" (カテゴリ予算) or 正規化済み内訳名
budget: number;
lineNo: number;
};

type RowErr = {
lineNo: number;
messages: string[];
};

function normalizeCategory(catRaw: string) {
const cat = cleanCell(catRaw);
return cat;
}

function normalizeSubCategory(cat: string, subRaw: string) {
const sub = cleanCell(subRaw);

// 空は「カテゴリ予算」
if (sub === "") return "";

// 娯楽費は 将哉/未有 のみ許容（合計行はカテゴリ予算として空にしてもらうのが正）
if (cat === "娯楽費") {
if (sub === "将哉" || sub === "未有") return sub;
// それ以外（娯楽費合計 等）は弾く
return "__INVALID_ENT_SUB__";
}

const official = (SUBCATEGORIES as any)?.[cat] as string[] | undefined;
if (!official || official.length === 0) {
// マスタにないカテゴリはそのまま通す（ただし後段でカテゴリ検証される）
return sub;
}

// マスタに「自由入力」がある前提で、マスタ外は自由入力に寄せる
// ※ CSVに「その他」や「合計」などが来ても破綻しない
const freeKey = official.includes(FREE_SUB) ? FREE_SUB : FREE_SUB;
return official.includes(sub) ? sub : freeKey;
}

function buildDocsFromRows(rows: RowOk[]) {
const docs: Record<string, BudgetDoc> = {};

for (const r of rows) {
const docId = budgetDocId(r.month, r.registrant);
if (!docs[docId]) {
docs[docId] = {
month: r.month,
registrant: r.registrant,
categoryBudgets: {},
subBudgets: {},
};
}

// ✅ subCategory が空ならカテゴリ予算
if (r.subCategory === "") {
docs[docId].categoryBudgets[r.category] = r.budget;
continue;
}

// ✅ 内訳予算
docs[docId].subBudgets[r.category] ??= {};
docs[docId].subBudgets[r.category][r.subCategory] = r.budget;
}

return docs;
}

function fmtYen(n: number) {
const r = Math.round(Number(n) || 0);
return `¥${r.toLocaleString("ja-JP")}`;
}

export default function BudgetImportPage() {
const [csvText, setCsvText] = useState<string>("");
const [fileName, setFileName] = useState<string>("");
const [busy, setBusy] = useState(false);
const [resultMsg, setResultMsg] = useState<string>("");

const { okRows, errors, docsPreview } = useMemo(() => {
if (!csvText.trim()) {
return { okRows: [] as RowOk[], errors: [] as RowErr[], docsPreview: {} as Record<string, BudgetDoc> };
}

const table = parseCSV(csvText);
if (table.length === 0) {
return { okRows: [] as RowOk[], errors: [{ lineNo: 1, messages: ["CSVが空です"] }], docsPreview: {} as any };
}

// ヘッダ検出（厳密にしすぎない）
const header = table[0].map((h) => cleanCell(h).toLowerCase());
const hasHeader =
header.includes("month") &&
header.includes("registrant") &&
header.includes("category") &&
header.includes("subcategory") &&
header.includes("budget");

const startIdx = hasHeader ? 1 : 0;

// 列インデックス（ヘッダがない場合は固定順）
const idx = (name: string) => header.indexOf(name);
const colMonth = hasHeader ? idx("month") : 0;
const colReg = hasHeader ? idx("registrant") : 1;
const colCat = hasHeader ? idx("category") : 2;
const colSub = hasHeader ? idx("subcategory") : 3;
const colBud = hasHeader ? idx("budget") : 4;

const inRows: RowIn[] = [];
for (let i = startIdx; i < table.length; i++) {
const lineNo = i + 1; // 表示用（1始まり）
const row = table[i];

// 空行スキップ
if (row.every((c) => cleanCell(c) === "")) continue;

inRows.push({
month: row[colMonth] ?? "",
registrant: row[colReg] ?? "",
category: row[colCat] ?? "",
subCategory: row[colSub] ?? "",
budgetRaw: row[colBud] ?? "",
lineNo,
});
}

const errs: RowErr[] = [];
const oks: RowOk[] = [];

for (const r of inRows) {
const messages: string[] = [];

const month = stripQuotes(r.month);
const registrant = stripQuotes(r.registrant) || ALL_REG;
const category = normalizeCategory(stripQuotes(r.category));
const subRaw = stripQuotes(r.subCategory);
const budget = toNumberSafe(r.budgetRaw);

// month
if (!isValidYM(month)) {
messages.push(`monthが不正（${r.month} → ${month}） ※YYYY-MMのみ`);
}

// category
if (!CATEGORIES.includes(category)) {
messages.push(`categoryが不正（${category}）`);
}

// budget
if (!Number.isFinite(budget)) {
messages.push(`budgetが数値じゃない（${r.budgetRaw}）`);
} else if (budget < 0) {
messages.push(`budgetがマイナス（${budget}）`);
}

// subCategory（カテゴリが正しいときだけチェック）
let subCategory = "";
if (CATEGORIES.includes(category)) {
const normalizedSub = normalizeSubCategory(category, subRaw);

if (normalizedSub === "__INVALID_ENT_SUB__") {
messages.push(`娯楽費のsubCategoryは 将哉/未有 のみ（${subRaw}） ※娯楽費合計はカテゴリ行にして subCategory空にして`);
} else {
subCategory = normalizedSub; // "" or 正規化済み

// 空じゃないときだけ “マスタ外→自由入力” になってるかを確認
if (subCategory !== "") {
const official = (SUBCATEGORIES as any)?.[category] as string[] | undefined;
if (official && official.length > 0) {
// normalizeSubCategory が自由入力に寄せるので、ここは基本OK
// ただし official に自由入力が無いケースもあるので一応チェック
const ok = official.includes(subCategory) || subCategory === FREE_SUB;
if (!ok) messages.push(`subCategoryが不正（${category}/${subCategory}）`);
}
}
}
}

if (messages.length > 0) {
errs.push({ lineNo: r.lineNo, messages });
} else {
oks.push({ month, registrant, category, subCategory, budget: Math.round(budget), lineNo: r.lineNo });
}
}

const preview = buildDocsFromRows(oks);
return { okRows: oks, errors: errs, docsPreview: preview };
}, [csvText]);

const previewList = useMemo(() => {
const keys = Object.keys(docsPreview).sort();
return keys.map((docId) => ({ docId, doc: docsPreview[docId] }));
}, [docsPreview]);

const canImport = okRows.length > 0 && errors.length === 0 && !busy;

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
const entries = Object.entries(docsPreview);

for (const [docId, docData] of entries) {
const ref = doc(db, "budgets", docId);

// createdAt を保持したいなら merge で createdAt が無い時だけ入れる、みたいな工夫もできるけど
// 今回はシンプルに「上書き（createdAt/updatedAt更新）」にしてる
await setDoc(
ref,
{
month: docData.month,
registrant: docData.registrant,
categoryBudgets: docData.categoryBudgets,
subBudgets: docData.subBudgets,
createdAt: serverTimestamp(),
updatedAt: serverTimestamp(),
},
{ merge: true }
);
}

setResultMsg(`OK：${entries.length} 件のdocを budgets に保存しました`);
} catch (e: any) {
console.error(e);
setResultMsg(`失敗：${String(e?.message ?? e)}`);
} finally {
setBusy(false);
}
};

return (
<div style={{ padding: 14, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui, -apple-system" }}>
<h2 style={{ margin: 0, fontSize: 18 }}>予算CSVインポート</h2>
<div style={{ marginTop: 8, color: "#64748b", fontWeight: 700, fontSize: 13 }}>
CSV列：month, registrant, category, subCategory, budget（ヘッダあり/なし両対応）
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
placeholder={`month,registrant,category,subCategory,budget
2022-11,(全員),食費,,45000
2022-11,(全員),食費,食材,25000
...`}
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
<div style={{ fontWeight: 900, color: "#0b4aa2" }}>プレビュー（month__registrant 単位）</div>
<div style={{ marginTop: 6, color: "#64748b", fontWeight: 800, fontSize: 12 }}>
OK行: {okRows.length} / エラー: {errors.length}
</div>

{previewList.length === 0 ? (
<div style={{ marginTop: 10, color: "#64748b", fontWeight: 900 }}>（プレビューなし）</div>
) : (
<div style={{ marginTop: 10, display: "grid", gap: 10 }}>
{previewList.map(({ docId, doc }) => (
<div key={docId} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10 }}>
<div style={{ fontWeight: 900, color: "#0f172a" }}>{docId}</div>
<div style={{ marginTop: 6, display: "grid", gap: 6 }}>
<div style={{ fontWeight: 900, fontSize: 12 }}>month: {doc.month}</div>
<div style={{ fontWeight: 900, fontSize: 12 }}>registrant: {doc.registrant}</div>

<div style={{ fontWeight: 900, fontSize: 12, marginTop: 6 }}>categoryBudgets</div>
<div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 800 }}>
{Object.keys(doc.categoryBudgets).length === 0
? "（なし）"
: Object.entries(doc.categoryBudgets)
.map(([k, v]) => `${k}:${fmtYen(v)}`)
.join(", ")}
</div>

<div style={{ fontWeight: 900, fontSize: 12, marginTop: 6 }}>subBudgets</div>
<div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 800 }}>
{Object.keys(doc.subBudgets).length === 0
? "（なし）"
: Object.entries(doc.subBudgets)
.map(([cat, subs]) => {
const inner = Object.entries(subs)
.map(([s, v]) => `${s}:${fmtYen(v)}`)
.join(" / ");
return `${cat}(${inner})`;
})
.join(", ")}
</div>
</div>
</div>
))}
</div>
)}
</div>

<div style={{ marginTop: 14, color: "#64748b", fontWeight: 800, fontSize: 12, lineHeight: 1.5 }}>
メモ：
<br />・subCategory が空（空白/全角スペース含む）＝カテゴリ予算として categoryBudgets に入ります
<br />・subCategory がマスタ外（例：食費/その他、固定費/固定費合計 等）は 自由入力 に寄せます
<br />・娯楽費の subCategory は 将哉/未有 のみ許可（娯楽費合計行は subCategory を空にしてカテゴリ予算として入れてください）
</div>
</div>
);
}