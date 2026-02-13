// pages/expense-bulk.tsx
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
addDoc,
collection,
getDocs,
query,
where,
serverTimestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import {
CATEGORIES,
SUBCATEGORIES,
EXPENSE_SOURCES,
REGISTRANTS,
} from "../lib/masterData";
import type { BulkTemplateRow } from "../lib/templates";
import { loadBulkTemplate, saveBulkTemplate } from "../lib/templates";

/* ================= util ================= */

const pad2 = (n: number) => String(n).padStart(2, "0");

const todayYYYYMM = () => {
const d = new Date();
return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

const clampInt = (n: any) => {
const x = Number(String(n ?? "").replace(/[^\d-]/g, ""));
if (!Number.isFinite(x)) return 0;
return Math.trunc(x);
};

const yen = (n: number) => {
const v = Math.round(Number(n) || 0);
const sign = v < 0 ? "▲" : "";
return `${sign}¥${Math.abs(v).toLocaleString("ja-JP")}`;
};

// 入力中も「¥ + カンマ」表示（数字以外は除去）
const parseYenInput = (s: string) => {
const digits = s.replace(/[^\d]/g, "");
return digits ? Math.trunc(Number(digits)) : 0;
};

const FREE_VALUE = "__FREE__";
const FREE_LABEL = "自由入力";

/* ================= types ================= */

type Row = BulkTemplateRow & {
freeText?: string; // 自由入力のテキスト（選択時のみ）
negative?: boolean; // マイナス切替
};

const normalizeRow = (r: any): Row => {
const category = String(r?.category ?? CATEGORIES[0]);
const subs = (SUBCATEGORIES as any)?.[category] ?? [];
const subCategoryRaw = String(r?.subCategory ?? (subs?.[0] ?? ""));
const source = String(r?.source ?? EXPENSE_SOURCES[0]);

// subCategory が公式リストに無い＝自由入力扱い
const isCustom = subCategoryRaw && !subs.includes(subCategoryRaw);

const amountRaw = clampInt(r?.amount ?? 0);
const negative = Boolean(r?.negative) || amountRaw < 0;

return {
enabled: Boolean(r?.enabled ?? true),
category,
subCategory: subCategoryRaw,
freeText: isCustom ? subCategoryRaw : String(r?.freeText ?? ""),
amount: negative ? -Math.abs(amountRaw) : Math.abs(amountRaw),
source,
negative,
};
};

/* ================= page ================= */

export default function ExpenseBulkPage() {

const [targetMonth, setTargetMonth] = useState(todayYYYYMM());
const [registrant, setRegistrant] =
useState<(typeof REGISTRANTS)[number]>("将哉");
const [rows, setRows] = useState<Row[]>([]);
const [loading, setLoading] = useState(false);

// 初回：テンプレ読み込み（最大10件）
useEffect(() => {
(async () => {
const doc = await loadBulkTemplate();
const loaded = (doc?.rows || []).slice(0, 10).map(normalizeRow);
setRows(loaded);
})();
}, []);

const addRow = () => {
if (rows.length >= 10) {
alert("テンプレは10件までです");
return;
}
const c = CATEGORIES[0];
const subs = (SUBCATEGORIES as any)?.[c] ?? [];
setRows((p) => [
...p,
normalizeRow({
enabled: true,
category: c,
subCategory: subs?.[0] ?? "",
amount: 0,
source: EXPENSE_SOURCES[0],
negative: false,
}),
]);
};

const updateRow = (i: number, patch: Partial<Row>) => {
setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
};

const removeRow = (i: number) => {
if (!confirm("このテンプレ行を削除しますか？")) return;
setRows((p) => p.filter((_, idx) => idx !== i));
};

const toggleAll = (on: boolean) => {
setRows((p) => p.map((r) => ({ ...r, enabled: on })));
};

const saveTemplate = async () => {
await saveBulkTemplate(rows.slice(0, 10));
alert("テンプレを保存しました");
};

// 表示用：行のカテゴリに応じた内訳リスト（自由入力を追加）
const subsFor = (cat: string) => {
const base = ((SUBCATEGORIES as any)?.[cat] ?? []) as string[];
const uniq = Array.from(new Set(base.filter(Boolean)));
return [...uniq, FREE_LABEL];
};

const registerSelected = async () => {
const selected = rows.filter((r) => r.enabled);

if (!selected.length) {
alert("チェックされた明細がありません");
return;
}

// 自由入力のバリデーション
for (const r of selected) {
const subs = (SUBCATEGORIES as any)?.[r.category] ?? [];
const isFree = !subs.includes(r.subCategory) || r.subCategory === FREE_LABEL;
const freeText = (r.freeText || "").trim();

if (isFree && !freeText) {
alert(`「${r.category}」の自由入力が空です。内容を入力してください。`);
return;
}
}

setLoading(true);
try {
// ✅ 今の仕様：expenses は month(YYYY-MM) を必ず持つ → month で取得して重複チェック
const snap = await getDocs(
query(collection(db, "expenses"), where("month", "==", targetMonth))
);
const existing = snap.docs.map((d) => d.data() as any);

for (const r of selected) {
const date = `${targetMonth}-01`; // ✅ 仕様：登録日1日固定
const subs = (SUBCATEGORIES as any)?.[r.category] ?? [];
const isFree = !subs.includes(r.subCategory) || r.subCategory === FREE_LABEL;

const subCategory = isFree ? (r.freeText || "").trim() : r.subCategory;

const amountAbs = Math.abs(clampInt(r.amount));
const amount = r.negative ? -amountAbs : amountAbs;

// ✅ 重複判定（仕様：重複時は確認）
const duplicated = existing.some(
(e: any) =>
e.month === targetMonth &&
e.date === date &&
e.registrant === registrant &&
e.category === r.category &&
String(e.subCategory || "") === String(subCategory || "") &&
Number(e.amount) === Number(amount) &&
String(e.source || "") === String(r.source || "")
);

if (duplicated) {
const ok = confirm(
`同じ内容の登録が見つかりました。\n\n${date}\n${registrant}\n${r.category} / ${subCategory}\n${yen(
amount
)}\n${r.source}\n\nそれでも登録しますか？`
);
if (!ok) continue;
}

// ✅ 今の必須仕様に合わせて保存（month 追加、命名統一）
await addDoc(collection(db, "expenses"), {
registrant,
date, // YYYY-MM-DD
month: targetMonth, // ✅ 必須
amount: Number(amount),
category: r.category,
subCategory,
source: r.source,
// memo はテンプレに無いので入れない（任意）
createdAt: serverTimestamp(),
updatedAt: serverTimestamp(),
});
}

alert("登録しました");
} finally {
setLoading(false);
}
};

const selectedCount = useMemo(
() => rows.filter((r) => r.enabled).length,
[rows]
);

return (
<div className="page">
<header className="top">
<div className="titleWrap">
<div className="badge">EXPENSE</div>
<h1 className="title">固定費一括登録</h1>
</div>
<Link href="/expense" className="back">
← 支出へ
</Link>
</header>

{/* Controls */}
<section className="card">
<div className="cardHead">
<div className="cardTitle">登録設定</div>
<div className="hint">
登録日：<b>毎月1日固定</b> / テンプレ：最大<b>10件</b>
</div>
</div>

<div className="controls">
<div className="field">
<div className="label">対象月</div>
<input
type="month"
value={targetMonth}
onChange={(e) => setTargetMonth(e.target.value)}
/>
</div>

<div className="field">
<div className="label">登録者</div>
<select
value={registrant}
onChange={(e) => setRegistrant(e.target.value as any)}
>
{REGISTRANTS.map((r) => (
<option key={r} value={r}>
{r}
</option>
))}
</select>
</div>

<div className="btnRow">
<button className="btn ghost" onClick={() => toggleAll(true)}>
全選択
</button>
<button className="btn ghost" onClick={() => toggleAll(false)}>
全解除
</button>
<button className="btn" onClick={addRow}>
＋ 追加
</button>
</div>
</div>
</section>

{/* Rows */}
<section className="card">
<div className="cardHead">
<div className="cardTitle">テンプレ明細</div>
<div className="hint">
チェックON：<b>{selectedCount}</b> 件
</div>
</div>

{rows.length === 0 ? (
<div className="empty">
テンプレがありません。<b>＋追加</b>で作成できます。
</div>
) : (
<div className="list">
{rows.map((r, i) => {
const subs = subsFor(r.category);
const baseSubs = (SUBCATEGORIES as any)?.[r.category] ?? [];
const isFree = !baseSubs.includes(r.subCategory);

const selectValue = isFree ? FREE_VALUE : r.subCategory;

return (
<div className="rowCard" key={i}>
<div className="rowTop">
<label className="check">
<input
type="checkbox"
checked={r.enabled}
onChange={(e) =>
updateRow(i, { enabled: e.target.checked })
}
/>
<span>登録</span>
</label>

<select
className="cat"
value={r.category}
onChange={(e) => {
const c = e.target.value;
const s = ((SUBCATEGORIES as any)?.[c] ?? [])[0] ?? "";
updateRow(i, {
category: c,
subCategory: s,
freeText: "",
});
}}
>
{CATEGORIES.map((c) => (
<option key={c} value={c}>
{c}
</option>
))}
</select>

<select
className="sub"
value={selectValue}
onChange={(e) => {
const v = e.target.value;
if (v === FREE_VALUE) {
updateRow(i, { subCategory: FREE_LABEL, freeText: "" });
} else {
updateRow(i, { subCategory: v, freeText: "" });
}
}}
>
{subs
.filter((s) => s !== FREE_LABEL)
.map((s) => (
<option key={s} value={s}>
{s}
</option>
))}
<option value={FREE_VALUE}>{FREE_LABEL}</option>
</select>
</div>

{/* 自由入力 */}
{selectValue === FREE_VALUE && (
<div className="freeRow">
<div className="labelMini">自由入力</div>
<input
value={r.freeText || ""}
onChange={(e) =>
updateRow(i, { freeText: e.target.value })
}
placeholder="例：クリーニング / 学校用品 / など"
/>
</div>
)}

<div className="rowBottom">
<div className="moneyWrap">
<button
type="button"
className={`minusBtn ${r.negative ? "on" : ""}`}
onClick={() => {
const abs = Math.abs(clampInt(r.amount));
updateRow(i, {
negative: !r.negative,
amount: !r.negative ? -abs : abs,
});
}}
aria-label="minus-toggle"
title="マイナス切替"
>
－
</button>

<input
className="money"
inputMode="numeric"
value={yen(r.amount)}
onChange={(e) => {
const abs = parseYenInput(e.target.value);
updateRow(i, {
amount: r.negative ? -abs : abs,
});
}}
/>
</div>

<select
className="source"
value={r.source}
onChange={(e) =>
updateRow(i, { source: e.target.value })
}
>
{EXPENSE_SOURCES.map((s) => (
<option key={s} value={s}>
{s}
</option>
))}
</select>

<button className="xBtn" onClick={() => removeRow(i)}>
×
</button>
</div>
</div>
);
})}
</div>
)}
</section>

{/* Actions */}
<section className="actions">
<button className="btn ghost" onClick={saveTemplate} disabled={loading}>
テンプレ保存
</button>
<button
className="btn primary"
onClick={registerSelected}
disabled={loading}
>
{loading ? "登録中…" : "チェックONを登録"}
</button>
</section>

<style jsx>{`
:global(html, body) {
background: #f6f9ff;
}

.page {
max-width: 980px;
margin: 0 auto;
padding: 12px;
color: #0f172a;
font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI",
Roboto, "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic",
Arial;
}

.top {
display: flex;
justify-content: space-between;
align-items: center;
gap: 12px;
padding: 4px 2px 10px;
}

.titleWrap {
display: flex;
align-items: center;
gap: 10px;
min-width: 0;
}

.badge {
font-size: 10px;
font-weight: 900;
color: #0b4aa2;
background: #e7f0ff;
border: 1px solid #cfe3ff;
border-radius: 999px;
padding: 4px 10px;
white-space: nowrap;
}

.title {
font-size: 16px;
font-weight: 900;
margin: 0;
color: #0b4aa2;
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
}

.back {
font-size: 12px;
font-weight: 900;
color: #0b4aa2;
text-decoration: none;
background: #ffffff;
border: 1px solid #cbd5e1;
padding: 8px 10px;
border-radius: 12px;
white-space: nowrap;
}

.card {
background: #ffffff;
border: 1px solid #e5e7eb;
border-radius: 16px;
padding: 12px;
margin-top: 10px;
box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
}

.cardHead {
display: flex;
justify-content: space-between;
align-items: baseline;
gap: 10px;
margin-bottom: 10px;
}

.cardTitle {
font-size: 13px;
font-weight: 900;
color: #0b4aa2;
}

.hint {
font-size: 11px;
font-weight: 800;
color: #64748b;
text-align: right;
}

.controls {
display: grid;
grid-template-columns: 1fr;
gap: 10px;
}

.field {
display: grid;
grid-template-columns: 90px 1fr;
gap: 8px;
align-items: center;
}

.label {
font-size: 11px;
font-weight: 900;
color: #334155;
text-align: left;
}

input,
select,
button {
font-size: 12px;
font-weight: 900;
border-radius: 12px;
border: 1px solid #cbd5e1;
padding: 10px 10px;
outline: none;
background: #fff;
color: #0f172a;
font-variant-numeric: tabular-nums;
width: 100%;
box-sizing: border-box;
}

input:focus,
select:focus {
border-color: #93c5fd;
box-shadow: 0 0 0 3px rgba(147, 197, 253, 0.35);
}

.btnRow {
display: grid;
grid-template-columns: 1fr 1fr 1fr;
gap: 8px;
}

.btn {
cursor: pointer;
background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%);
color: #0b4aa2;
border: 1px solid #cfe3ff;
}

.btn:hover {
filter: brightness(0.98);
}

.btn.ghost {
background: #ffffff;
border: 1px solid #cbd5e1;
color: #0b4aa2;
}

.btn.primary {
background: linear-gradient(180deg, #0b4aa2 0%, #0a3f8b 100%);
color: #ffffff;
border: 1px solid #0a3f8b;
}

.btn:disabled {
opacity: 0.6;
cursor: not-allowed;
}

.empty {
padding: 14px;
text-align: center;
color: #64748b;
font-weight: 900;
background: #f8fbff;
border: 1px dashed #cbd5e1;
border-radius: 14px;
}

.list {
display: grid;
gap: 10px;
}

.rowCard {
border: 1px solid #e5e7eb;
border-radius: 16px;
padding: 10px;
background: linear-gradient(180deg, #fbfdff 0%, #ffffff 100%);
}

.rowTop {
display: grid;
grid-template-columns: 92px 1fr 1fr;
gap: 8px;
align-items: center;
}

.check {
display: flex;
align-items: center;
gap: 8px;
justify-content: center;
background: #ffffff;
border: 1px solid #cbd5e1;
border-radius: 12px;
padding: 10px 8px;
user-select: none;
}

.check input {
width: 18px;
height: 18px;
padding: 0;
margin: 0;
box-shadow: none;
}

.check span {
font-size: 12px;
font-weight: 900;
color: #0b4aa2;
white-space: nowrap;
}

.freeRow {
margin-top: 8px;
display: grid;
grid-template-columns: 92px 1fr;
gap: 8px;
align-items: center;
}

.labelMini {
font-size: 11px;
font-weight: 900;
color: #64748b;
text-align: center;
border: 1px dashed #cbd5e1;
border-radius: 12px;
padding: 10px 6px;
background: #ffffff;
}

.rowBottom {
margin-top: 8px;
display: grid;
grid-template-columns: 1fr 1fr 44px;
gap: 8px;
align-items: center;
}

.moneyWrap {
display: grid;
grid-template-columns: 44px 1fr;
gap: 8px;
align-items: center;
}

.minusBtn {
height: 44px;
padding: 0;
border-radius: 14px;
background: #ffffff;
border: 1px solid #cbd5e1;
color: #0b4aa2;
}

.minusBtn.on {
background: #fee2e2;
border-color: #fecaca;
color: #dc2626;
}

.money {
text-align: center;
}

.xBtn {
height: 44px;
padding: 0;
border-radius: 14px;
background: #ffffff;
border: 1px solid #e5e7eb;
color: #334155;
cursor: pointer;
}

.xBtn:hover {
background: #f8fafc;
}

.actions {
display: grid;
grid-template-columns: 1fr 1fr;
gap: 10px;
margin-top: 12px;
padding-bottom: 6px;
}

/* iPad/PC：2カラム寄りに */
@media (min-width: 768px) {
.controls {
grid-template-columns: 1fr 1fr;
gap: 12px;
}
.btnRow {
grid-column: 1 / -1;
grid-template-columns: 140px 140px 1fr;
justify-content: end;
}
.field {
grid-template-columns: 110px 1fr;
}
}

/* iPhone14 幅でも横スクロールしない */
:global(*) {
max-width: 100%;
}
`}</style>
</div>
);
}