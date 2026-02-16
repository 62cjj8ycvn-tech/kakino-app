// pages/budget.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
doc,
getDoc,
setDoc,
serverTimestamp,
writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { CATEGORIES, SUBCATEGORIES } from "../lib/masterData";

/**
* 予算ページ（更新版）
*
* ✅ 予定収入：将哉 / 未有 / その他（固定）
* - incomes の source（収入元）と一致する前提で運用
* 将哉 = 収入元が「将哉」の予定、未有も同様、その他も同様
*
* ✅ イベント支出：不要 → 完全削除
*
* ✅ UI
* - 余計な文言削除（横幅確保）
* - 左列（項目）幅をギリギリに
* - 期間指定で横に月が並ぶ。左列は sticky 固定
*
* ✅ 編集制限
* - 支出カテゴリ（カテゴリ合計）は、その月の内訳合計が 1以上なら編集不可
* タップ時「内訳に入力されています」アラート
*
* ✅ Firestore
* - budgets docId: `${YYYY-MM}__${registrant}`
* - registrant は現状 (全員) 固定運用（必要なら拡張可）
*
* 保存想定（budgets）
* {
* month, registrant,
* incomePlans: { 将哉: number, 未有: number, その他: number },
* categoryBudgets: { [category]: number },
* subBudgets: { [category]: { [subCategory]: number } },
* items?: 既存互換（使わないが残っててもOK）
* }
*/

type BudgetDoc = {
month: string;
registrant: string;
categoryBudgets?: Record<string, number>;
subBudgets?: Record<string, Record<string, number>>;
items?: Record<string, number>; // 既存互換（使わない）
incomePlans?: Record<string, number>; // 将哉/未有/その他
createdAt?: any;
updatedAt?: any;
};

const ALL_REG = "(全員)";
const FREE_SUB = "自由入力";

const INCOME_KEYS = ["将哉", "未有", "その他"] as const;

// ---------- utils ----------
function ymToday() {
const d = new Date();
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
return `${y}-${m}`;
}
function parseYM(ym: string) {
const [ys, ms] = (ym ?? "").split("-");
const y = Number(ys);
const m = Number(ms);
return { y: Number.isFinite(y) ? y : 1970, m: Number.isFinite(m) ? m : 1 };
}
function ymToIndex(ym: string) {

const { y, m } = parseYM(ym);
if (y == null || m == null) return 0;

return y * 12 + (m - 1);
}

function indexToYM(idx: number) {
const y = Math.floor(idx / 12);
const m = (idx % 12) + 1;
return `${y}-${String(m).padStart(2, "0")}`;
}
function monthsBetween(startYM: string, endYM: string) {
const a = ymToIndex(startYM);
const b = ymToIndex(endYM);
const from = Math.min(a, b);
const to = Math.max(a, b);
const out: string[] = [];
for (let i = from; i <= to; i++) out.push(indexToYM(i));
return out;
}
function fmtYen(n: number) {
const r = Math.round(Number(n) || 0);
const sign = r < 0 ? "▲" : "";
return `${sign}¥${Math.abs(r).toLocaleString("ja-JP")}`;
}
function toNumSafe(v: any) {
const n = Number(String(v ?? "").replace(/,/g, ""));
return Number.isFinite(n) ? n : NaN;
}
function budgetDocId(month: string, registrant: string) {
return `${month}__${registrant}`;
}

/**
* ✅ 予算docの正規化（グラフページと合わせる）
* - categoryBudgets / items / subBudgets合計 の最大をカテゴリ合計として扱う
* - subBudgets はそのまま
* - incomePlans は 将哉/未有/その他 を必ず持つ（無ければ0）
*/
function normalizeBudgetDoc(docData: BudgetDoc | null) {
const rawCat = (docData?.categoryBudgets ?? {}) as Record<string, number>;
const rawItems = (docData?.items ?? {}) as Record<string, number>;
const rawSub = (docData?.subBudgets ?? {}) as Record<string, Record<string, number>>;
const rawIncome = (docData?.incomePlans ?? {}) as Record<string, number>;

const categoryBudgets: Record<string, number> = {};
const subBudgets: Record<string, Record<string, number>> = {};

for (const c of CATEGORIES) {
const a = Number(rawCat?.[c] ?? 0);
const b = Number(rawItems?.[c] ?? 0);
const sMap = rawSub?.[c] ?? {};
const sSum = Object.values(sMap).reduce((x, y) => x + (Number(y) || 0), 0);
// 内訳が1つでも入っていれば「内訳合計」を優先
if (sSum > 0) {
categoryBudgets[c] = sSum;
} else {
const best = Math.max(a, b);

categoryBudgets[c] = Number.isFinite(best) ? best : 0;
}
subBudgets[c] = { ...(rawSub?.[c] ?? {}) };
}

const incomePlans: Record<string, number> = {};
for (const k of INCOME_KEYS) {
incomePlans[k] = Number(rawIncome?.[k] ?? 0) || 0;
}

return { categoryBudgets, subBudgets, incomePlans };
}

// ---------- Firestore ----------
async function fetchBudgetDocByYM(ym: string, registrant: string) {
const id = budgetDocId(ym, registrant);
const snap = await getDoc(doc(db, "budgets", id));
if (!snap.exists()) return null;
return snap.data() as BudgetDoc;
}
async function fetchBudgetDocsByMonths(months: string[], registrant: string) {
const out: Record<string, BudgetDoc | null> = {};
for (const ym of months) {
out[ym] = await fetchBudgetDocByYM(ym, registrant);
}
return out;
}

// ---------- UI helpers ----------
const CATEGORY_COLORS: Record<string, string> = {
食費: "#1e88e5",
光熱費: "#43a047",
消耗品: "#fb8c00",
車: "#8e24aa",
娯楽費: "#e53935",
会社: "#546e7a",
子供: "#f06292",
医療費: "#00acc1",
固定費: "#3949ab",
その他: "#757575",
積立: "#2e7d32",
振替: "#6d4c41",
};
function colorOfCategory(cat: string) {
return CATEGORY_COLORS[cat] ?? "#0b4aa2";
}

type EditTarget =
| { kind: "income"; key: (typeof INCOME_KEYS)[number] }
| { kind: "category"; category: string }
| { kind: "sub"; category: string; subCategory: string };

export default function BudgetPage() {
// responsive
const [wide, setWide] = useState(false);
useEffect(() => {
const on = () => setWide(window.innerWidth >= 768);
on();
window.addEventListener("resize", on);
return () => window.removeEventListener("resize", on);
}, []);

// mode
const [rangeMode, setRangeMode] = useState(false);
const [month, setMonth] = useState(ymToday());
const [rangeStart, setRangeStart] = useState(ymToday());
const [rangeEnd, setRangeEnd] = useState(ymToday());

const monthsActive = useMemo(() => {
return rangeMode ? monthsBetween(rangeStart, rangeEnd) : [month];
}, [rangeMode, rangeStart, rangeEnd, month]);

// registrant（いったん全員固定）
const registrant = ALL_REG;

// budgets data
const [loading, setLoading] = useState(false);
const [budgetDocs, setBudgetDocs] = useState<Record<string, BudgetDoc | null>>({});

const reloadBudgets = async () => {
setLoading(true);
try {
const result = await fetchBudgetDocsByMonths(monthsActive, registrant);
setBudgetDocs(result);
} catch (e) {
console.error(e);
setBudgetDocs({});
} finally {
setLoading(false);
}
};

useEffect(() => {
let alive = true;
(async () => {
setLoading(true);
try {
const result = await fetchBudgetDocsByMonths(monthsActive, registrant);
if (!alive) return;
setBudgetDocs(result);
} catch (e) {
console.error(e);
if (!alive) return;
setBudgetDocs({});
} finally {
if (!alive) return;
setLoading(false);
}
})();
return () => {
alive = false;
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [monthsActive.join("|"), registrant]);

// normalized per month
const normalizedByYM = useMemo(() => {
const out: Record<string, ReturnType<typeof normalizeBudgetDoc> & { exists: boolean }> = {};
for (const ym of monthsActive) {
const docData = budgetDocs[ym] ?? null;
out[ym] = { ...normalizeBudgetDoc(docData), exists: !!docData };
}
return out;
}, [budgetDocs, monthsActive.join("|")]);

// expand state (categories)
const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
const toggleCat = (cat: string) => setOpenCats((p) => ({ ...p, [cat]: !p[cat] }));

// sub keys
const subKeysByCategory = useMemo(() => {
const out: Record<string, string[]> = {};
for (const cat of CATEGORIES) {
const official = (SUBCATEGORIES as any)?.[cat] as string[] | undefined;
if (!official || official.length === 0) {
out[cat] = [];
continue;
}
const uniq = Array.from(new Set(official));
const list = uniq.filter((x) => x !== FREE_SUB);
if (uniq.includes(FREE_SUB)) list.push(FREE_SUB);
out[cat] = list;
}
return out;
}, []);

// ---------- bulk register ----------
const [bulkOpen, setBulkOpen] = useState(false);

const [selIncome, setSelIncome] = useState<Record<string, boolean>>({
将哉: false,
未有: false,
その他: false,
});

const [selCatTotals, setSelCatTotals] = useState<Record<string, boolean>>({});
const [selSubs, setSelSubs] = useState<Record<string, Record<string, boolean>>>({});
const [bulkValues, setBulkValues] = useState<Record<string, string>>({});

const setBulkValue = (key: string, v: string) => setBulkValues((p) => ({ ...p, [key]: v }));

const buildBulkTargets = () => {
const targets: { key: string; label: string }[] = [];

// incomes
for (const k of INCOME_KEYS) {
if (selIncome[k]) targets.push({ key: `income::${k}`, label: k });
}

// category totals
for (const [cat, on] of Object.entries(selCatTotals)) {
if (on) targets.push({ key: `cat::${cat}`, label: cat });
}

// subs
for (const [cat, subs] of Object.entries(selSubs)) {
for (const [sub, on] of Object.entries(subs ?? {})) {
if (!on) continue;
targets.push({ key: `sub::${cat}::${sub}`, label: `${cat}/${sub}` });
}
}
return targets;
};

const doBulkApply = async () => {
const months = rangeMode ? monthsActive : [month];
if (months.length === 0) return;

const targets = buildBulkTargets();
if (targets.length === 0) {
alert("一括反映する項目を選んでね");
return;
}

// resolve numeric values (blank = untouched)
const resolved: { key: string; value: number }[] = [];
for (const t of targets) {
const raw = bulkValues[t.key];
if (raw == null || String(raw).trim() === "") continue;
const v = toNumSafe(raw);
if (!Number.isFinite(v) || v < 0) {
alert(`金額が不正：${t.label}`);
return;
}
resolved.push({ key: t.key, value: Math.round(v) });
}
if (resolved.length === 0) {
alert("金額が1つも入力されてないよ（空欄は変更しない仕様）");
return;
}

if (!confirm(`期間 ${months[0]} 〜 ${months[months.length - 1]} に反映する？（${resolved.length}項目）`)) return;

setLoading(true);
try {
const batch = writeBatch(db);

for (const ym of months) {
const id = budgetDocId(ym, registrant);
const ref = doc(db, "budgets", id);
const snap = await getDoc(ref);
const prev = snap.exists() ? (snap.data() as BudgetDoc) : null;

const prevIncome = (prev?.incomePlans ?? {}) as Record<string, number>;
const prevCat = (prev?.categoryBudgets ?? {}) as Record<string, number>;
const prevSub = (prev?.subBudgets ?? {}) as Record<string, Record<string, number>>;

let nextIncome = { ...prevIncome };
let nextCat = { ...prevCat };
let nextSub = { ...prevSub };

for (const { key, value } of resolved) {
const parts = key.split("::");
const kind = parts[0];

if (kind === "income") {
const k = parts[1];
if (!k) continue;
nextIncome[k] = value;
}

else if (kind === "cat") {
const cat = parts[1];
if (!cat) continue;

// ✅ 一括でカテゴリ合計を上書きする時も内訳をクリア
nextSub[cat] = {};

nextCat[cat] = value;
}

else if (kind === "sub") {
const cat = parts[1];
const sub = parts[2];
if (!cat || !sub) continue;

nextSub[cat] = {
...(nextSub?.[cat] ?? {}),
[sub]: value,
};

const subSum = Object.values(nextSub[cat]).reduce(
(a, b) => a + (Number(b) || 0),
0
);

nextCat[cat] = subSum;
}
}


const patch: any = {
month: ym,
registrant,
incomePlans: nextIncome,
categoryBudgets: nextCat,
subBudgets: nextSub,
updatedAt: serverTimestamp(),
};
if (!prev) patch.createdAt = serverTimestamp();

batch.set(ref, patch, { merge: true });
}

await batch.commit();
alert("一括反映OK！");
setBulkOpen(false);
await reloadBudgets();
} catch (e) {
console.error(e);
alert("一括反映で失敗した：コンソール見て！");
} finally {
setLoading(false);
}
};

// ---------- cell getters ----------
const getIncome = (ym: string, key: (typeof INCOME_KEYS)[number]) => {
const m = normalizedByYM[ym]?.incomePlans ?? {};
return Number(m?.[key] ?? 0);
};
const getCatBudget = (ym: string, cat: string) => {
const m = normalizedByYM[ym]?.categoryBudgets ?? {};
return Number(m?.[cat] ?? 0);
};
const getSubBudget = (ym: string, cat: string, sub: string) => {
const m = normalizedByYM[ym]?.subBudgets ?? {};
return Number(m?.[cat]?.[sub] ?? 0);
};
const sumSubs = (ym: string, cat: string) => {
const m = normalizedByYM[ym]?.subBudgets?.[cat] ?? {};
return Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0);
};

// ---------- modal edit ----------
const [editOpen, setEditOpen] = useState(false);
const [editYM, setEditYM] = useState<string>(monthsActive[0] ?? ymToday());
const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
const [editValue, setEditValue] = useState<string>("");

const openEdit = (ym: string, target: EditTarget, current: number) => {
setEditYM(ym);
setEditTarget(target);
setEditValue(String(Math.round(Number(current) || 0)));
setEditOpen(true);
};

const saveEdit = async () => {
if (!editTarget) return;

const val = toNumSafe(editValue);
if (!Number.isFinite(val) || val < 0) {
alert("金額は0以上の数値で入力してね");
return;
}

const id = budgetDocId(editYM, registrant);
const ref = doc(db, "budgets", id);
const snap = await getDoc(ref);
const prev = snap.exists() ? (snap.data() as BudgetDoc) : null;

const prevIncome = (prev?.incomePlans ?? {}) as Record<string, number>;
const prevCat = (prev?.categoryBudgets ?? {}) as Record<string, number>;
const prevSub = (prev?.subBudgets ?? {}) as Record<string, Record<string, number>>;

let nextIncome = { ...prevIncome };
let nextCat = { ...prevCat };
let nextSub = { ...prevSub };

if (editTarget.kind === "income") {
nextIncome[editTarget.key] = Math.round(val);
}

else if (editTarget.kind === "category") {
const cat = editTarget.category;

// そのカテゴリに内訳が入ってるかチェック（1円でも入ってたら true）
const subSum = Object.values(nextSub?.[cat] ?? {}).reduce(
(a, b) => a + (Number(b) || 0),
0
);
const hasSubs = subSum >= 1;

// 内訳があるなら確認して、OKなら内訳を削除してカテゴリ合計で上書き
if (hasSubs) {
const ok = confirm(
"このカテゴリには内訳が登録されています。\nカテゴリ合計で上書きすると内訳は削除されます。\n続けますか？"
);
if (!ok) return;
}

nextCat[cat] = Math.round(val);

// 🔥 重要：カテゴリ合計で運用したいので内訳を削除する
nextSub[cat] = {};
}


else if (editTarget.kind === "sub") {
const cat = editTarget.category;
const sub = editTarget.subCategory;

nextSub[cat] = {
...(nextSub?.[cat] ?? {}),
[sub]: Math.round(val),
};

// 🔥 内訳合計をカテゴリに反映
const subSum = Object.values(nextSub[cat]).reduce(
(a, b) => a + (Number(b) || 0),
0
);

nextCat[cat] = subSum;
}

const patch: any = {
month: editYM,
registrant,
incomePlans: nextIncome,
categoryBudgets: nextCat,
subBudgets: nextSub,
updatedAt: serverTimestamp(),
};

if (!prev) patch.createdAt = serverTimestamp();

await setDoc(ref, patch, { merge: true });

setEditOpen(false);
await reloadBudgets();
};
// ---------- styles ----------
const styles = useMemo(() => {
const selectBase: React.CSSProperties = {
height: 34,
borderRadius: 10,
border: "1px solid #cbd5e1",
padding: "0 8px",
fontSize: 12,
fontWeight: 900,
background: "#fff",
outline: "none",
fontVariantNumeric: "tabular-nums",
};

const leftW = wide ? 120 : 100; // ✅ ギリギリに

return {
page: {
padding: 12,
maxWidth: 1200,
margin: "0 auto",
fontFamily:
'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Arial',
color: "#0f172a",
} as React.CSSProperties,

card: {
background: "#ffffff",
border: "1px solid #e5e7eb",
borderRadius: 14,
padding: 12,
boxShadow: "0 6px 18px rgba(15, 23, 42, 0.05)",
} as React.CSSProperties,

topRow: {
display: "flex",
alignItems: "center",
gap: 8,
justifyContent: "center",
flexWrap: "wrap",
} as React.CSSProperties,

squareBtn: {
width: 34,
height: 34,
borderRadius: 12,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
} as React.CSSProperties,

monthInput: {
...selectBase,
width: wide ? 150 : 140,
} as React.CSSProperties,

toggleRow: { display: "flex", gap: 8, marginTop: 10 } as React.CSSProperties,
toggleBtn: (active: boolean): React.CSSProperties => ({
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid " + (active ? "#93c5fd" : "#cbd5e1"),
background: active ? "#dbeafe" : "#ffffff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
fontSize: 12,
flex: 1,
}),

sectionTitle: {
fontSize: 14,
fontWeight: 900,
color: "#0b4aa2",
marginBottom: 8,
} as React.CSSProperties,

tableWrap: {
border: "1px solid #e5e7eb",
borderRadius: 14,
overflow: "hidden",
background: "#fff",
} as React.CSSProperties,

scrollX: { overflowX: "auto", overflowY: "hidden" } as React.CSSProperties,

table: {
width: "max-content",
minWidth: "100%",
borderCollapse: "separate",
borderSpacing: 0,
fontVariantNumeric: "tabular-nums",
} as React.CSSProperties,

th: {
position: "sticky",
top: 0,
background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
zIndex: 3,
borderBottom: "1px solid #e5e7eb",
padding: "10px 10px",
fontSize: 12,
fontWeight: 900,
color: "#0b4aa2",
textAlign: "center",
whiteSpace: "nowrap",
} as React.CSSProperties,

thLeft: {
position: "sticky",
left: 0,
zIndex: 4,
textAlign: "left",
minWidth: leftW,
maxWidth: leftW,
background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
borderRight: "1px solid #e5e7eb",
} as React.CSSProperties,

td: {
borderBottom: "1px dashed #e2e8f0",
padding: "8px 10px",
fontSize: 12,
fontWeight: 900,
textAlign: "center",
whiteSpace: "nowrap",
minWidth: 140,
} as React.CSSProperties,

tdLeft: {
position: "sticky",
left: 0,
zIndex: 2,
textAlign: "left",
background: "#fff",
borderRight: "1px solid #e5e7eb",
} as React.CSSProperties,

rowHeader: { display: "flex", alignItems: "center", gap: 8 } as React.CSSProperties,

pill: {
display: "inline-flex",
alignItems: "center",
padding: "3px 10px",
borderRadius: 999,
border: "1px solid #e2e8f0",
background: "#f8fafc",
fontSize: 11,
fontWeight: 900,
color: "#334155",
} as React.CSSProperties,

tinyBtn: {
height: 30,
padding: "0 10px",
borderRadius: 999,
border: "1px solid #cbd5e1",
background: "#fff",
fontWeight: 900,
cursor: "pointer",
fontSize: 12,
color: "#0b4aa2",
} as React.CSSProperties,

dangerBtn: {
height: 30,
padding: "0 10px",
borderRadius: 999,
border: "1px solid #fecaca",
background: "#fff1f2",
fontWeight: 900,
cursor: "pointer",
fontSize: 12,
color: "#b91c1c",
} as React.CSSProperties,

note: { fontSize: 12, fontWeight: 800, color: "#64748b", lineHeight: 1.5 } as React.CSSProperties,

// bulk panel
grid2: { display: "grid", gridTemplateColumns: wide ? "1fr 1fr" : "1fr", gap: 10 } as React.CSSProperties,
checkRow: {
display: "flex",
alignItems: "center",
gap: 8,
padding: "6px 0",
borderBottom: "1px dashed #e2e8f0",
} as React.CSSProperties,
amountRow: {
display: "grid",
gridTemplateColumns: wide ? "1fr 160px" : "1fr 140px",
gap: 10,
alignItems: "center",
padding: "6px 0",
borderBottom: "1px dashed #e2e8f0",
} as React.CSSProperties,
input: { ...selectBase, width: "100%" } as React.CSSProperties,
amountInput: { ...selectBase, width: "100%", textAlign: "right" } as React.CSSProperties,

// modal
modalOverlay: {
position: "fixed",
inset: 0,
background: "rgba(15,23,42,0.45)",
display: "flex",
justifyContent: "center",
alignItems: "center",
padding: 12,
zIndex: 50,
} as React.CSSProperties,
modalCard: {
width: "min(720px, 100%)",
maxHeight: "85vh",
background: "#fff",
borderRadius: 14,
border: "1px solid #e5e7eb",
boxShadow: "0 20px 60px rgba(15,23,42,0.25)",
overflow: "hidden",
display: "flex",
flexDirection: "column",
} as React.CSSProperties,
modalHeader: {
padding: 10,
borderBottom: "1px solid #e5e7eb",
background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
} as React.CSSProperties,
modalBody: { padding: 10, overflow: "auto" } as React.CSSProperties,
};
}, [wide]);

// ---------- nav ----------
const moveMonth = (delta: number) => {
const { y, m } = parseYM(month);
const d = new Date(y, m - 1 + delta, 1);
const yy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, "0");
setMonth(`${yy}-${mm}`);
};
const moveRange = (delta: number) => {
if (!rangeMode) {
moveMonth(delta);
return;
}
const a = parseYM(rangeStart);
const b = parseYM(rangeEnd);
const da = new Date(a.y, a.m - 1 + delta, 1);
const db2 = new Date(b.y, b.m - 1 + delta, 1);
const sa = `${da.getFullYear()}-${String(da.getMonth() + 1).padStart(2, "0")}`;
const sb = `${db2.getFullYear()}-${String(db2.getMonth() + 1).padStart(2, "0")}`;
setRangeStart(sa);
setRangeEnd(sb);
};

return (
<div style={styles.page}>
{/* Top */}
<div style={styles.card}>
<div style={styles.topRow}>
<button style={styles.squareBtn} onClick={() => moveRange(-1)} aria-label="prev">
←
</button>

{!rangeMode ? (
<input
type="month"
value={month}
onChange={(e) => setMonth(e.target.value)}
style={styles.monthInput}
aria-label="month"
/>
) : (
<>
<input
type="month"
value={rangeStart}
onChange={(e) => setRangeStart(e.target.value)}
style={styles.monthInput}
aria-label="range-start"
/>
<span style={{ fontWeight: 900, color: "#64748b" }}>〜</span>
<input
type="month"
value={rangeEnd}
onChange={(e) => setRangeEnd(e.target.value)}
style={styles.monthInput}
aria-label="range-end"
/>
</>
)}

<button style={styles.squareBtn} onClick={() => moveRange(1)} aria-label="next">
→
</button>
</div>

<div style={styles.toggleRow}>
<button
style={styles.toggleBtn(rangeMode)}
onClick={() => {
setRangeMode((v) => {
const next = !v;
if (!v && next) {
setRangeStart(month);
setRangeEnd(month);
}
return next;
});
}}
>
期間指定
</button>

<button style={styles.toggleBtn(bulkOpen)} onClick={() => setBulkOpen((v) => !v)}>
一括登録
</button>
</div>

<div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
<div style={styles.note}>
{rangeMode ? `${monthsActive[0]}〜${monthsActive[monthsActive.length - 1]}` : month}
</div>
<button style={styles.tinyBtn} onClick={reloadBudgets} disabled={loading}>
{loading ? "読込中…" : "再読み込み"}
</button>
</div>
</div>

{/* Bulk panel */}
{bulkOpen && (
<div style={{ ...styles.card, marginTop: 10 }}>
<div style={styles.sectionTitle}>一括登録</div>

<div style={{ marginTop: 10, ...styles.grid2 }}>
{/* Left: choose */}
<div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10 }}>
<div style={{ fontWeight: 900, color: "#0b4aa2" }}>項目</div>

<div style={{ marginTop: 10, fontWeight: 900 }}>予定収入</div>
{INCOME_KEYS.map((k) => (
<label key={k} style={styles.checkRow}>
<input
type="checkbox"
checked={!!selIncome[k]}
onChange={(e) => setSelIncome((p) => ({ ...p, [k]: e.target.checked }))}
/>
<span style={{ fontWeight: 900 }}>{k}</span>
</label>
))}

<div style={{ marginTop: 10, fontWeight: 900 }}>予定支出</div>
{CATEGORIES.map((cat) => {
const subs = subKeysByCategory[cat] ?? [];
const open = !!selSubs[cat] || !!selCatTotals[cat];
return (
<div key={cat} style={{ borderBottom: "1px dashed #e2e8f0", paddingBottom: 6, marginBottom: 6 }}>
<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
<span style={{ fontWeight: 900, color: colorOfCategory(cat) }}>{cat}</span>
</div>

<label style={{ ...styles.checkRow, paddingLeft: 6 }}>
<input
type="checkbox"
checked={!!selCatTotals[cat]}
onChange={(e) => setSelCatTotals((p) => ({ ...p, [cat]: e.target.checked }))}
/>
<span style={{ fontWeight: 900 }}>カテゴリ合計</span>
</label>

{subs.length > 0 && (
<div style={{ paddingLeft: 18 }}>
{subs.map((sub) => (
<label key={sub} style={styles.checkRow}>
<input
type="checkbox"
checked={!!selSubs?.[cat]?.[sub]}
onChange={(e) =>
setSelSubs((p) => ({
...p,
[cat]: { ...(p[cat] ?? {}), [sub]: e.target.checked },
}))
}
/>
<span style={{ fontWeight: 900 }}>{sub}</span>
</label>
))}
</div>
)}

{!open && subs.length === 0 && (
<div style={{ ...styles.note, paddingLeft: 6 }}>
（内訳なし：カテゴリ合計で運用）
</div>
)}
</div>
);
})}
</div>

{/* Right: amount */}
<div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10 }}>
<div style={{ fontWeight: 900, color: "#0b4aa2" }}>金額</div>

<div style={{ marginTop: 10 }}>
{buildBulkTargets().length === 0 ? (
<div style={styles.note}>左で項目を選ぶと入力欄が出ます。</div>
) : (
buildBulkTargets().map((t) => (
<div key={t.key} style={styles.amountRow}>
<div style={{ fontWeight: 900, fontSize: 12 }}>{t.label}</div>
<input
value={bulkValues[t.key] ?? ""}
onChange={(e) => setBulkValue(t.key, e.target.value)}
placeholder="例：45000"
inputMode="numeric"
style={styles.amountInput}
/>
</div>
))
)}
</div>

<div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
<button
style={styles.dangerBtn}
onClick={() => {
setSelIncome({ 将哉: false, 未有: false, その他: false });
setSelCatTotals({});
setSelSubs({});
setBulkValues({});
}}
>
クリア
</button>
<button style={styles.tinyBtn} onClick={doBulkApply} disabled={loading}>
{loading ? "反映中…" : "期間に反映"}
</button>
</div>
</div>
</div>
</div>
)}

{/* Table */}
<div style={{ ...styles.card, marginTop: 10 }}>
<div style={styles.sectionTitle}>予算</div>

<div style={styles.tableWrap}>
<div style={styles.scrollX}>
<table style={styles.table}>
<thead>
<tr>
<th style={{ ...styles.th, ...styles.thLeft }}>項目</th>
{monthsActive.map((ym) => (
<th key={ym} style={styles.th}>
{ym}
</th>
))}
</tr>
</thead>

<tbody>
{/* ---------- Income Plans ---------- */}
<tr>
<td style={{ ...styles.td, ...styles.tdLeft }}>
<div style={styles.rowHeader}>
<span style={styles.pill}>予定収入</span>
</div>
</td>
{monthsActive.map((ym) => (
<td key={ym} style={styles.td}>
{fmtYen(INCOME_KEYS.reduce((a, k) => a + getIncome(ym, k), 0))}
</td>
))}
</tr>

{INCOME_KEYS.map((k) => (
<tr key={`income_${k}`}>
<td style={{ ...styles.td, ...styles.tdLeft }}>
<div style={{ ...styles.rowHeader, paddingLeft: 8 }}>
<span style={{ fontWeight: 900 }}>{k}</span>
</div>
</td>
{monthsActive.map((ym) => {
const v = getIncome(ym, k);
return (
<td
key={ym}
style={{ ...styles.td, cursor: "pointer" }}
onClick={() => openEdit(ym, { kind: "income", key: k }, v)}
title="タップで編集"
>
{fmtYen(v)}
</td>
);
})}
</tr>
))}

{/* spacer */}
<tr>
<td style={{ ...styles.td, ...styles.tdLeft, borderBottom: "1px solid #e5e7eb" }} />
{monthsActive.map((ym) => (
<td key={ym} style={{ ...styles.td, borderBottom: "1px solid #e5e7eb" }} />
))}
</tr>

{/* ---------- Expense Plans ---------- */}
<tr>
<td style={{ ...styles.td, ...styles.tdLeft }}>
<div style={styles.rowHeader}>
<span style={styles.pill}>予定支出</span>
</div>
</td>
{monthsActive.map((ym) => (
<td key={ym} style={styles.td}>
{fmtYen(CATEGORIES.reduce((a, c) => a + getCatBudget(ym, c), 0))}
</td>
))}
</tr>

{CATEGORIES.map((cat) => {
const open = !!openCats[cat];
const subs = subKeysByCategory[cat] ?? [];

return (
<React.Fragment key={`cat_${cat}`}>
<tr>
{/* 左：展開 */}
<td
style={{ ...styles.td, ...styles.tdLeft, cursor: "pointer" }}
onClick={() => toggleCat(cat)}
title="タップで内訳を開閉"
>
<div style={styles.rowHeader}>
<span style={{ fontWeight: 900, color: colorOfCategory(cat) }}>{cat}</span>
<span style={{ fontSize: 11, color: "#64748b", fontWeight: 900 }}>
{open ? "－" : "＋"}
</span>
</div>
</td>

{/* 右：カテゴリ合計セル（内訳合計>=1なら編集不可） */}
{monthsActive.map((ym) => {
const v = getCatBudget(ym, cat);
const subSum = sumSubs(ym, cat);
const locked = subSum >= 1;

return (
<td
key={ym}
style={{
...styles.td,
cursor: locked ? "not-allowed" : "pointer",
color: locked ? "#64748b" : "#0f172a",
}}
onClick={() => {
if (locked) {
alert("内訳に入力されています");
return;
}
openEdit(ym, { kind: "category", category: cat }, v);
}}
title={locked ? "内訳があるため編集不可" : "タップで編集（カテゴリ）"}
>
{fmtYen(v)}
</td>
);
})}
</tr>

{/* sub rows */}
{open &&
subs.map((sub) => (
<tr key={`sub_${cat}_${sub}`}>
<td style={{ ...styles.td, ...styles.tdLeft }}>
<div style={{ ...styles.rowHeader, paddingLeft: 14 }}>
<span style={{ fontWeight: 900, color: "#334155" }}>{sub}</span>
</div>
</td>

{monthsActive.map((ym) => {
const v = getSubBudget(ym, cat, sub);
return (
<td
key={ym}
style={{ ...styles.td, cursor: "pointer" }}
onClick={() => openEdit(ym, { kind: "sub", category: cat, subCategory: sub }, v)}
title="タップで編集（内訳）"
>
{fmtYen(v)}
</td>
);
})}
</tr>
))}
</React.Fragment>
);
})}
</tbody>
</table>
</div>
</div>

<div style={{ marginTop: 10, ...styles.note }}>
※カテゴリ合計は「内訳が1円以上ある月」は編集できません（内訳優先）
</div>
</div>

{/* Edit modal */}
{editOpen && editTarget && (
<div style={styles.modalOverlay} onClick={() => setEditOpen(false)} role="button">
<div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
<div style={styles.modalHeader}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
<div style={{ fontWeight: 900, color: "#0b4aa2" }}>編集</div>
<button style={styles.tinyBtn} onClick={() => setEditOpen(false)}>
✖︎
</button>
</div>

<div style={{ marginTop: 6, fontWeight: 900, color: "#334155" }}>
月：{editYM} /{" "}
{editTarget.kind === "income"
? `予定収入：${editTarget.key}`
: editTarget.kind === "category"
? `カテゴリ：${editTarget.category}`
: `内訳：${editTarget.category}/${editTarget.subCategory}`}
</div>
</div>

<div style={styles.modalBody}>
<div style={{ display: "grid", gap: 8 }}>
<div style={styles.note}>金額（0以上、整数）</div>
<input
value={editValue}
onChange={(e) => setEditValue(e.target.value)}
inputMode="numeric"
placeholder="例：45000"
style={{ ...styles.input, textAlign: "right" }}
/>

<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
<button style={styles.tinyBtn} onClick={saveEdit}>
保存
</button>
</div>
</div>
</div>
</div>
</div>
)}
</div>
);
}