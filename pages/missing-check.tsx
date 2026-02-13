import React, { useEffect, useMemo, useState } from "react";
import {
collection,
doc,
getDoc,
getDocs,
query,
serverTimestamp,
setDoc,
where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { CATEGORIES, SUBCATEGORIES } from "../lib/masterData";
type Category = (typeof CATEGORIES)[number];

function isCategory(x: any): x is Category {
return (CATEGORIES as readonly string[]).includes(String(x));
}

/**
* 漏れチェック（/missing-check）
*
* 必須仕様（最新版）
* - 基準額は「予算」から自動入力
* - カテゴリ＋内訳を選ぶと、金額欄に予算額を自動入力
* - 内訳予算が無い(0/未設定)場合はカテゴリ予算を適用
* - 判定は「判定」ボタンを押した時にだけ行う
* - チェックONのテンプレのみ判定＆展開
* - 判定結果はテンプレの2段目に表示
* - テンプレの3段目以降に該当明細を全部表示
* - メモ欄は不要
* - 上部UI
* - 1段目：← / 月ホイール / →
* - 2段目：判定ボタン / 保存ボタン
* - 余白は最小（iPhone14で横スクロールなし）
*
* ✅ Budgetsの現状構造に合わせた対応
* - categoryBudgets[カテゴリ] を優先
* - items[カテゴリ] をフォールバック
* - subBudgets[カテゴリ][内訳] を使用
* - 予算の自由枠は「自由入力」を選択肢に出す
*/

type ExpenseDoc = {
id: string;
date: string; // YYYY-MM-DD
month: string; // YYYY-MM
amount: number;
category: string;
subCategory: string;
source: string;
registrant: string;
};

type BudgetDoc = {
month: string;
registrant: string; // "(全員)" or name
categoryBudgets?: Record<string, number>;
items?: Record<string, number>; // あなたのデータに存在するためフォールバックで使用
subBudgets?: Record<string, Record<string, number>>; // category -> subCategory -> amount
};

type TemplateRow = {
id: string;
enabled: boolean;
category: string;
subCategorySelect: string;
baseAmountText: string; // 予算から自動入力（手修正も可）
};

type EvalResult = {
ok: boolean | null; // base<=0などはnull
base: number;
actual: number;
lower: number;
upper: number;
diff: number; // base - actual
matched: ExpenseDoc[];
};

const TEMPLATE_DOC_ID = "missingCheck";
const MAX_ITEMS = 15;

const ALL_REG = "(全員)";
const BUDGET_FREE_LABEL = "自由入力"; // ✅ budgets.subBudgets に入っているラベルに合わせる

// --- utils ---
function ymToday() {
const d = new Date();
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
return `${y}-${m}`;
}
function addMonths(ym: string, delta: number) {
const parts = (ym ?? "").split("-");
const yy = Number(parts[0] ?? 1970);
const mm = Number(parts[1] ?? 1);

const y0 = Number.isFinite(yy) ? yy : 1970;
const m0 = Number.isFinite(mm) ? mm : 1;

const d = new Date(y0, (m0 - 1) + delta, 1);
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
return `${y}-${m}`;
}
function digitsOnly(s: string) {
return (s || "").replace(/[^\d]/g, "");
}
function formatWithCommaDigits(s: string) {
const d = digitsOnly(s);
if (!d) return "";
return new Intl.NumberFormat("ja-JP").format(Number(d));
}
function parseYenTextToNumber(s: string) {
const d = digitsOnly(s);
if (!d) return NaN;
const n = Number(d);
return Number.isFinite(n) ? n : NaN;
}
function fmtYen(n: number) {
const r = Math.round(Number(n) || 0);
const sign = r < 0 ? "▲" : "";
const abs = Math.abs(r);
return `${sign}¥${new Intl.NumberFormat("ja-JP").format(abs)}`;
}
function keyOf(cat: string, sub: string) {
return `${cat}||${sub}`;
}
function diffStyleAndText(baseMinusActual: number) {
const r = Math.round(Number(baseMinusActual) || 0);
if (r < 0) {
return {
color: "#dc2626",
text: `▲¥${new Intl.NumberFormat("ja-JP").format(Math.abs(r))}`,
};
}
return {
color: "#16a34a",
text: `¥${new Intl.NumberFormat("ja-JP").format(r)}`,
};
}

function budgetDocId(month: string, registrant: string) {
return `${month}__${registrant}`;
}

async function fetchBudgetDoc(month: string): Promise<BudgetDoc | null> {
const tryRegs = [ALL_REG, "将哉", "未有"]; // 必要なら "その他" も追加
for (const r of tryRegs) {
const snap = await getDoc(doc(db, "budgets", budgetDocId(month, r)));
if (snap.exists()) return snap.data() as BudgetDoc;
}
return null;
}

// ✅ あなたの budgets 構造に合わせてカテゴリ予算の取得元を2段構えに
function getCategoryBudget(budget: BudgetDoc | null, category: string) {
const a = Number(budget?.categoryBudgets?.[category] ?? 0);
if (Number.isFinite(a) && a > 0) return a;

const b = Number(budget?.items?.[category] ?? 0);
if (Number.isFinite(b) && b > 0) return b;

// 0 も許容（振替/積立など）
return Number.isFinite(a) ? a : Number.isFinite(b) ? b : 0;
}

// ✅ 内訳予算が0/未設定ならカテゴリ予算
function getBudgetAmount(budget: BudgetDoc | null, category: string, subCategory: string) {
const catB = getCategoryBudget(budget, category);

const subMap = budget?.subBudgets?.[category] ?? {};
const subB = Number(subMap?.[subCategory] ?? 0);

if (Number.isFinite(subB) && subB > 0) return subB;
return catB;
}

function makeDefaultRow(i: number): TemplateRow {
return {
id: `row_${i}_${Math.random().toString(16).slice(2)}`,
enabled: true,
category: "",
subCategorySelect: "",
baseAmountText: "",
};
}

export default function MissingCheckPage() {
// responsive
const [wide, setWide] = useState(false);
useEffect(() => {
const on = () => setWide(window.innerWidth >= 768);
on();
window.addEventListener("resize", on);
return () => window.removeEventListener("resize", on);
}, []);

// month
const [month, setMonth] = useState(ymToday());

// template rows
const [rows, setRows] = useState<TemplateRow[]>(
Array.from({ length: MAX_ITEMS }).map((_, i) => makeDefaultRow(i))
);

// budget
const [budgetDoc, setBudgetDoc] = useState<BudgetDoc | null>(null);
const [budgetLoading, setBudgetLoading] = useState(true);

// expenses (month)
const [expensesMonth, setExpensesMonth] = useState<ExpenseDoc[]>([]);
const [expLoading, setExpLoading] = useState(true);

// template loading/saving
const [tplLoading, setTplLoading] = useState(true);
const [saving, setSaving] = useState(false);

// evaluation
const [evaluated, setEvaluated] = useState(false);
const [evalMap, setEvalMap] = useState<Record<string, EvalResult>>({});

const updateRow = (idx: number, patch: Partial<TemplateRow>) => {
setRows((prev) => {
const next = prev.slice();
const cur = next[idx];
if (!cur) return prev; // 念のため

next[idx] = { ...cur, ...patch } as TemplateRow;
return next;
});
};

const subOptionsFor = (category: string) => {
if (!category) return [];

const list = isCategory(category) ? (SUBCATEGORIES[category] ?? []) : [];
// ✅ 予算と一致させるため「自由入力」を入れる
return [...list, BUDGET_FREE_LABEL];
};

// --- load template (once) ---
useEffect(() => {
let alive = true;
(async () => {
setTplLoading(true);
try {
const snap = await getDoc(doc(db, "templates", TEMPLATE_DOC_ID));
if (!alive) return;

if (snap.exists()) {
const data = snap.data() as any;
const items: any[] = Array.isArray(data?.items) ? data.items : [];

const normalized = Array.from({ length: MAX_ITEMS }).map((_, i) => {
const it = items[i] ?? {};
const r: TemplateRow = {
id: String(it.id ?? `row_${i}_${Math.random().toString(16).slice(2)}`),
enabled: Boolean(it.enabled ?? true),
category: String(it.category ?? ""),
subCategorySelect: String(it.subCategorySelect ?? ""),
baseAmountText: String(it.baseAmountText ?? ""),
};
return r;
});
setRows(normalized);
} else {
setRows(Array.from({ length: MAX_ITEMS }).map((_, i) => makeDefaultRow(i)));
}
} catch (e) {
console.error(e);
setRows(Array.from({ length: MAX_ITEMS }).map((_, i) => makeDefaultRow(i)));
} finally {
if (!alive) return;
setTplLoading(false);
}
})();
return () => {
alive = false;
};
}, []);

// --- load budget when month changes ---
useEffect(() => {
let alive = true;
(async () => {
setBudgetLoading(true);
try {
const b = await fetchBudgetDoc(month);
if (!alive) return;
setBudgetDoc(b);
} catch (e) {
console.error(e);
if (!alive) return;
setBudgetDoc(null);
} finally {
if (!alive) return;
setBudgetLoading(false);
}
})();
return () => {
alive = false;
};
}, [month]);

// --- load expenses (month) ---
useEffect(() => {
let alive = true;
(async () => {
setExpLoading(true);
try {
const qExp = query(collection(db, "expenses"), where("month", "==", month));
const snap = await getDocs(qExp);
const list: ExpenseDoc[] = snap.docs
.map((d) => {
const x = d.data() as any;
return {
id: d.id,
date: String(x.date ?? ""),
month: String(x.month ?? ""),
amount: Number(x.amount ?? 0),
category: String(x.category ?? ""),
subCategory: String(x.subCategory ?? ""),
source: String(x.source ?? ""),
registrant: String(x.registrant ?? ""),
};
})
.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
if (!alive) return;
setExpensesMonth(list);
} catch (e) {
console.error(e);
if (!alive) return;
setExpensesMonth([]);
} finally {
if (!alive) return;
setExpLoading(false);
}
})();
return () => {
alive = false;
};
}, [month]);

// --- budget autofill when category/sub changes OR budget loaded ---
useEffect(() => {
setRows((prev) => {
const next = prev.map((r) => {
if (!r.category || !r.subCategorySelect) return r;

const b = getBudgetAmount(budgetDoc, r.category, r.subCategorySelect);
const want = b > 0 ? new Intl.NumberFormat("ja-JP").format(Math.round(b)) : "";

if ((r.baseAmountText || "") === want) return r;
return { ...r, baseAmountText: want };
});
return next;
});
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [budgetDoc]);

const saveTemplate = async () => {
setSaving(true);
try {
const ref = doc(db, "templates", TEMPLATE_DOC_ID);
await setDoc(
ref,
{
items: rows.map((r) => ({
id: r.id,
enabled: Boolean(r.enabled),
category: r.category ?? "",
subCategorySelect: r.subCategorySelect ?? "",
baseAmountText: r.baseAmountText ?? "",
})),
updatedAt: serverTimestamp(),
createdAt: serverTimestamp(),
} as any,
{ merge: true }
);
alert("テンプレを保存しました。");
} catch (e) {
console.error(e);
alert("保存に失敗しました。");
} finally {
setSaving(false);
}
};

// aggregate expenses by category+subCategory（支出元は無視）
const monthAgg = useMemo(() => {
const m = new Map<string, number>();
for (const e of expensesMonth) {
const cat = e.category || "";
const sub = e.subCategory || "";
if (!cat || !sub) continue;
const k = keyOf(cat, sub);
m.set(k, (m.get(k) ?? 0) + (Number(e.amount) || 0));
}
return m;
}, [expensesMonth]);

const judge = () => {
const next: Record<string, EvalResult> = {};

for (const r of rows) {
if (!r.enabled) continue;

const base = parseYenTextToNumber(r.baseAmountText);
const actual =
r.category && r.subCategorySelect
? Number(monthAgg.get(keyOf(r.category, r.subCategorySelect)) ?? 0)
: 0;

const baseOk = Number.isFinite(base) && base > 0;
const lower = baseOk ? Math.round(base * 0.9) : 0;
const upper = baseOk ? Math.round(base * 1.1) : 0;

let ok: boolean | null = null;
if (r.category && r.subCategorySelect && baseOk) ok = actual >= lower && actual <= upper;
else ok = null;

const matched =
r.category && r.subCategorySelect
? expensesMonth.filter(
(x) => x.category === r.category && x.subCategory === r.subCategorySelect
)
: [];

next[r.id] = {
ok,
base: baseOk ? base : 0,
actual,
lower,
upper,
diff: (baseOk ? base : 0) - actual,
matched,
};
}

setEvalMap(next);
setEvaluated(true);
};

const anyLoading = tplLoading || budgetLoading || expLoading;

// --- styles ---
const styles = useMemo(() => {
const baseInput: React.CSSProperties = {
width: "100%",
height: 32,
borderRadius: 10,
border: "1px solid #cbd5e1",
padding: "0 8px",
fontSize: 12,
fontWeight: 900,
background: "#fff",
outline: "none",
color: "#0f172a",
};

const btnBase: React.CSSProperties = {
height: 34,
padding: "0 12px",
borderRadius: 12,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
fontSize: 12,
whiteSpace: "nowrap",
};

return {
page: {
padding: 12,
maxWidth: 1100,
margin: "0 auto",
fontFamily:
'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Arial',
color: "#0f172a",
} as React.CSSProperties,

card: {
background: "#fff",
border: "1px solid #e5e7eb",
borderRadius: 14,
padding: 10,
boxShadow: "0 6px 18px rgba(15, 23, 42, 0.06)",
marginBottom: 10,
} as React.CSSProperties,

topBar: {
display: "grid",
gridTemplateColumns: "40px 1fr 40px",
gap: 6,
alignItems: "center",
} as React.CSSProperties,

navBtn: {
height: 34,
width: 40,
borderRadius: 12,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
fontSize: 14,
display: "flex",
alignItems: "center",
justifyContent: "center",
} as React.CSSProperties,

monthInput: {
height: 34,
width: "100%",
padding: "0 4px",
fontSize: 12,
fontWeight: 900,
borderRadius: 12,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#0f172a",
} as React.CSSProperties,

actionRow: {
display: "grid",
gridTemplateColumns: "1fr 1fr",
gap: 6,
marginTop: 6,
} as React.CSSProperties,

btnJudge: (disabled: boolean): React.CSSProperties => ({
...btnBase,
border: "1px solid #93c5fd",
background: disabled ? "#f8fafc" : "#1d4ed8",
color: disabled ? "#94a3b8" : "#fff",
cursor: disabled ? "not-allowed" : "pointer",
}),

btnSave: (disabled: boolean): React.CSSProperties => ({
...btnBase,
border: "1px solid #cbd5e1",
background: disabled ? "#f8fafc" : "#fff",
color: disabled ? "#94a3b8" : "#0b4aa2",
cursor: disabled ? "not-allowed" : "pointer",
}),

tplLine: {
display: "grid",
gridTemplateColumns: wide ? "34px 110px 1fr 110px" : "30px 86px 1fr 96px",
gap: 6,
alignItems: "center",
padding: "8px 8px",
borderRadius: 14,
border: "1px solid #e2e8f0",
background: "#fff",
marginBottom: 8,
} as React.CSSProperties,

checkboxWrap: { display: "flex", justifyContent: "center" } as React.CSSProperties,
select: baseInput,
input: baseInput,

resultLine: {
marginTop: -4,
marginBottom: 8,
padding: "0 8px 8px",
} as React.CSSProperties,

resultChip: (ok: boolean | null): React.CSSProperties => {
if (ok === true)
return {
display: "inline-block",
padding: "6px 10px",
borderRadius: 999,
fontSize: 12,
fontWeight: 900,
border: "1px solid #bbf7d0",
background: "#dcfce7",
color: "#166534",
whiteSpace: "nowrap",
};
if (ok === false)
return {
display: "inline-block",
padding: "6px 10px",
borderRadius: 999,
fontSize: 12,
fontWeight: 900,
border: "1px solid #fecaca",
background: "#fee2e2",
color: "#991b1b",
whiteSpace: "nowrap",
};
return {
display: "inline-block",
padding: "6px 10px",
borderRadius: 999,
fontSize: 12,
fontWeight: 900,
border: "1px solid #e2e8f0",
background: "#f8fafc",
color: "#334155",
whiteSpace: "nowrap",
};
},

resultText: {
marginLeft: 10,
fontSize: 12,
fontWeight: 900,
color: "#334155",
fontVariantNumeric: "tabular-nums",
whiteSpace: "nowrap",
} as React.CSSProperties,

detailsBox: {
marginTop: -6,
marginBottom: 12,
padding: "0 8px 10px",
} as React.CSSProperties,

detailHead: {
display: "grid",
gridTemplateColumns: wide ? "70px 110px 1fr" : "62px 98px 1fr",
gap: 6,
padding: "6px 8px",
borderRadius: 12,
background: "#eff6ff",
border: "1px solid #dbeafe",
fontSize: 11,
fontWeight: 900,
color: "#334155",
} as React.CSSProperties,

detailRow: {
display: "grid",
gridTemplateColumns: wide ? "70px 110px 1fr" : "62px 98px 1fr",
gap: 6,
padding: "6px 8px",
borderRadius: 12,
border: "1px solid #e2e8f0",
background: "#fff",
marginTop: 6,
fontSize: 11,
fontWeight: 900,
color: "#0f172a",
fontVariantNumeric: "tabular-nums",
overflow: "hidden",
} as React.CSSProperties,

center: { textAlign: "center", whiteSpace: "nowrap" } as React.CSSProperties,
leftEllipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as React.CSSProperties,

loadingBox: {
padding: 12,
borderRadius: 14,
border: "1px solid #e2e8f0",
background: "#fff",
textAlign: "center",
color: "#0b4aa2",
fontWeight: 900,
} as React.CSSProperties,
};
}, [wide]);

return (
<div style={styles.page}>
<div style={styles.card}>
<div style={styles.topBar}>
<button style={styles.navBtn} onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="prev">
←
</button>

<input
type="month"
value={month}
onChange={(e) => setMonth(e.target.value)}
style={styles.monthInput}
aria-label="month"
/>

<button style={styles.navBtn} onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="next">
→
</button>
</div>

<div style={styles.actionRow}>
<button style={styles.btnJudge(anyLoading)} disabled={anyLoading} onClick={judge}>
判定
</button>
<button style={styles.btnSave(anyLoading || saving)} disabled={anyLoading || saving} onClick={saveTemplate}>
保存
</button>
</div>
</div>

{anyLoading ? (
<div style={styles.loadingBox}>読み込み中…</div>
) : (
<div>
{rows.map((r, idx) => {
const subOptions = subOptionsFor(r.category);
const res = evaluated ? evalMap[r.id] : undefined;
const diffInfo = res ? diffStyleAndText(res.diff) : null;

const statusText =
!res ? "未判定" : res.ok === true ? "OK" : res.ok === false ? "NG" : "判定不能";

return (
<div key={r.id}>
<div style={styles.tplLine}>
<div style={styles.checkboxWrap}>
<input
type="checkbox"
checked={r.enabled}
onChange={(e) => {
updateRow(idx, { enabled: e.target.checked });
setEvaluated(false);
}}
aria-label="enabled"
/>
</div>

<select
value={r.category}
onChange={(e) => {
const v = e.target.value;
updateRow(idx, {
category: v,
subCategorySelect: "",
baseAmountText: "",
});
setEvaluated(false);
}}
style={styles.select}
aria-label="category"
>
<option value="">カテゴリ</option>
{CATEGORIES.map((x) => (
<option key={x} value={x}>
{x}
</option>
))}
</select>

<select
value={r.subCategorySelect}
onChange={(e) => {
const v = e.target.value;

// 選択直後に予算自動入力（予算docに合わせて）
const b =
r.category && v ? getBudgetAmount(budgetDoc, r.category, v) : 0;
const want =
b > 0 ? new Intl.NumberFormat("ja-JP").format(Math.round(b)) : "";

updateRow(idx, {
subCategorySelect: v,
baseAmountText: want,
});
setEvaluated(false);
}}
style={{ ...styles.select, opacity: r.category ? 1 : 0.6 }}
disabled={!r.category}
aria-label="subCategory"
>
<option value="">{r.category ? "内訳" : "カテゴリ先"}</option>
{subOptions.map((x) => (
<option key={x} value={x}>
{x}
</option>
))}
</select>

<input
inputMode="numeric"
value={r.baseAmountText}
onChange={(e) => {
updateRow(idx, { baseAmountText: formatWithCommaDigits(e.target.value) });
setEvaluated(false);
}}
style={{ ...styles.input, textAlign: "center" }}
placeholder="予算"
aria-label="base"
/>
</div>

{evaluated && r.enabled && (
<div style={styles.resultLine}>
<span style={styles.resultChip(res?.ok ?? null)}>{statusText}</span>

{res ? (
<>
<span style={styles.resultText}>
基準 {fmtYen(res.base)} / 実績 {fmtYen(res.actual)} / 範囲{" "}
{fmtYen(res.lower)}〜{fmtYen(res.upper)}
</span>
<span style={{ ...styles.resultText, color: diffInfo?.color }}>
差 {diffInfo?.text}
</span>
</>
) : (
<span style={styles.resultText}>（判定対象外）</span>
)}
</div>
)}

{evaluated && r.enabled && res && (
<div style={styles.detailsBox}>
{res.matched.length === 0 ? (
<div style={{ fontSize: 12, fontWeight: 900, color: "#64748b", padding: "6px 2px" }}>
該当明細なし
</div>
) : (
<>
<div style={styles.detailHead}>
<div style={styles.center}>日付</div>
<div style={styles.center}>金額</div>
<div style={styles.leftEllipsis}>支出元</div>
</div>

{res.matched.map((x) => (
<div key={x.id} style={styles.detailRow}>
<div style={styles.center}>{x.date.slice(5).replace("-", "/")}</div>
<div style={styles.center}>{fmtYen(x.amount)}</div>
<div style={styles.leftEllipsis}>{x.source}</div>
</div>
))}
</>
)}
</div>
)}
</div>
);
})}
</div>
)}
</div>
);
}