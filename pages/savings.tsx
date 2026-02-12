// pages/savings.tsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { CATEGORIES } from "../lib/masterData";

/**
* ✅今回の仕様（確定）
* - 貯金残高：表示期間の「最終残高」を上に表示（従来通り）
* - 期間指定時のみ：下に「その期間だけの増減」を小さく表示
* - マイナス：▲赤
* - 0/プラス：緑（+表示なし、0は緑で¥0）
*
* - 積立合計：
* - 上：今までの合計（全期間の積立累計。HISTORY_START〜）
* - 下：期間指定時のみ、その期間の合計（同色ルール。0は緑¥0）
* - 積立ON時：残高側に積立を加算して見せる（従来仕様維持）
* - このとき積立カード上段は 0 表示（※仕様維持）
* - ただし下段（期間合計）は表示する
*
* - 年またぎ縦線：もっと濃く、分かりやすく
*
* ✅維持
* - 累計（残高）：表示開始月より前の残高を起点にしてスタート
* - 連結ON：実績最終点を起点に予定線を繋ぐ
* - 振替は計算に含めない

*/

type ExpenseDoc = {
registrant: string;
date: string; // YYYY-MM-DD
month?: string; // YYYY-MM
amount: number;
category: string;
subCategory: string;
source: string;
};

type IncomeDoc = {
registrant: string;
date: string; // YYYY-MM-DD
amount: number;
source: string;
};

type BudgetDoc = {
month: string;
registrant: string;
items?: Record<string, number>;
categoryBudgets?: Record<string, number>;
subBudgets?: Record<string, Record<string, number>>;
incomePlans?: Record<string, number>; // 将哉/未有/その他
};

const ALL_REG = "(全員)";
const TRANSFER_CAT = "振替";
const TSUMITATE_CAT = "積立";

// 「過去の残高」算出の起点（あなたの運用に合わせて最古に）
const HISTORY_START = "2022-10";

function ymToday() {
const d = new Date();
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
return `${y}-${m}`;
}
function defaultStartLastYearJan() {
const d = new Date();
const y = d.getFullYear() - 1;
return `${y}-01`;
}
function parseYM(ym: string) {
const [y, m] = ym.split("-").map(Number);
return { y, m };
}
function ymToIndex(ym: string) {
const { y, m } = parseYM(ym);
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
function prevYM(ym: string) {
const idx = ymToIndex(ym);
return indexToYM(idx - 1);
}
function ymdStartOfMonth(ym: string) {
return `${ym}-01`;
}
function ymdStartOfNextMonth(ym: string) {
const { y, m } = parseYM(ym);
const d = new Date(y, m, 1);
const yy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, "0");
return `${yy}-${mm}-01`;
}
function fmtYen(n: number) {
const r = Math.round(Number(n) || 0);
const sign = r < 0 ? "▲" : "";
return `${sign}¥${Math.abs(r).toLocaleString("ja-JP")}`;
}
function budgetDocId(month: string, registrant: string) {
return `${month}__${registrant}`;
}

/**
* categoryBudgets / items / subBudgets合計 の最大を採用
*/
function normalizeCategoryBudgets(
docData: BudgetDoc | null,
categories: string[]
): { cat: Record<string, number>; sub: Record<string, Record<string, number>> } {
const cat: Record<string, number> = {};
const sub = (docData?.subBudgets ?? {}) as Record<string, Record<string, number>>;

const fromCategoryBudgets = (docData?.categoryBudgets ?? {}) as Record<string, number>;
const fromItems = (docData?.items ?? {}) as Record<string, number>;

for (const c of categories) {
const a = Number(fromCategoryBudgets?.[c] ?? 0);
const b = Number(fromItems?.[c] ?? 0);
const sMap = sub?.[c] ?? {};
const sSum = Object.values(sMap).reduce((x, y) => x + (Number(y) || 0), 0);
const best = Math.max(a, b, sSum);
cat[c] = Number.isFinite(best) ? best : 0;
}
return { cat, sub };
}

function sumMap(m?: Record<string, any>) {
if (!m) return 0;
return Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0);
}
function plannedIncomeOfBudgetDoc(b: BudgetDoc | null) {
const plans = (b?.incomePlans ?? {}) as Record<string, number>;
return sumMap(plans);
}
function plannedExpenseOfBudgetDoc(b: BudgetDoc | null) {
const normalized = normalizeCategoryBudgets(b, CATEGORIES);
return CATEGORIES.reduce((a, c) => {
if (c === TRANSFER_CAT) return a;
return a + (Number(normalized.cat?.[c] ?? 0) || 0);
}, 0);
}
function plannedTsumitateOfBudgetDoc(b: BudgetDoc | null) {
const normalized = normalizeCategoryBudgets(b, CATEGORIES);
return Number(normalized.cat?.[TSUMITATE_CAT] ?? 0) || 0;
}

type LineMode = "monthly" | "cumulative";

export default function SavingsPage() {
// responsive
const [wide, setWide] = useState(false);
useEffect(() => {
const on = () => setWide(window.innerWidth >= 768);
on();
window.addEventListener("resize", on);
return () => window.removeEventListener("resize", on);
}, []);

// range
const DEFAULT_START = useMemo(() => defaultStartLastYearJan(), []);
const [rangeMode, setRangeMode] = useState(false);
const [rangeStart, setRangeStart] = useState(DEFAULT_START);
const [rangeEnd, setRangeEnd] = useState(ymToday());

// display
const [lineMode, setLineMode] = useState<LineMode>("cumulative");
const [showForecast, setShowForecast] = useState(true);

// 積立（初期OFF）
const [includeTsumitate, setIncludeTsumitate] = useState(false);

// 連結（初期OFF）
const [linkForecast, setLinkForecast] = useState(false);

// data
const [loading, setLoading] = useState(true);

// 表示範囲のデータ
const [expenses, setExpenses] = useState<ExpenseDoc[]>([]);
const [incomes, setIncomes] = useState<IncomeDoc[]>([]);
const [budgetDocs, setBudgetDocs] = useState<Record<string, BudgetDoc | null>>({});

// 「表示開始月より前の残高」算出用データ（HISTORY_START〜開始月前月）
const [prefixExpenses, setPrefixExpenses] = useState<ExpenseDoc[]>([]);
const [prefixIncomes, setPrefixIncomes] = useState<IncomeDoc[]>([]);
const [prefixBudgetDocs, setPrefixBudgetDocs] = useState<Record<string, BudgetDoc | null>>({});

const monthsActive = useMemo(() => {
if (!rangeMode) return monthsBetween(DEFAULT_START, ymToday());
return monthsBetween(rangeStart, rangeEnd);
}, [rangeMode, rangeStart, rangeEnd, DEFAULT_START]);

// 表示開始YM（レンジON/OFF関係なく「いま表示してる先頭月」）
const displayStartYM = useMemo(() => monthsActive[0] ?? DEFAULT_START, [monthsActive, DEFAULT_START]);

// fetch display-range expenses + incomes
useEffect(() => {
let alive = true;

(async () => {
setLoading(true);
try {
const startYM = monthsActive[0];
const endYM = monthsActive[monthsActive.length - 1];

const start = ymdStartOfMonth(startYM);
const next = ymdStartOfNextMonth(endYM);

const qExp = query(collection(db, "expenses"), where("date", ">=", start), where("date", "<", next));
const expSnap = await getDocs(qExp);
const expList = expSnap.docs.map((d) => d.data() as ExpenseDoc);

const qInc = query(collection(db, "incomes"), where("date", ">=", start), where("date", "<", next));
const incSnap = await getDocs(qInc);
const incList = incSnap.docs
.map((d) => d.data() as IncomeDoc)
.filter((x) => Number.isFinite(Number(x.amount)));

if (!alive) return;
setExpenses(expList);
setIncomes(incList);
} catch (e) {
console.error(e);
if (!alive) return;
setExpenses([]);
setIncomes([]);
} finally {
if (!alive) return;
setLoading(false);
}
})();

return () => {
alive = false;
};
}, [monthsActive]);

// fetch display-range budgets
useEffect(() => {
let alive = true;

(async () => {
try {
const out: Record<string, BudgetDoc | null> = {};
await Promise.all(
monthsActive.map(async (ym) => {
try {
const id = budgetDocId(ym, ALL_REG);
const snap = await getDoc(doc(db, "budgets", id));
out[ym] = snap.exists() ? (snap.data() as BudgetDoc) : null;
} catch (e) {
console.error(e);
out[ym] = null;
}
})
);
if (!alive) return;
setBudgetDocs(out);
} catch (e) {
console.error(e);
if (!alive) return;
setBudgetDocs({});
}
})();

return () => {
alive = false;
};
}, [monthsActive]);

// fetch prefix data (HISTORY_START 〜 displayStartYMの前月)
useEffect(() => {
let alive = true;

(async () => {
try {
// displayStartがHISTORY_START以下ならprefix不要
if (ymToIndex(displayStartYM) <= ymToIndex(HISTORY_START)) {
if (!alive) return;
setPrefixExpenses([]);
setPrefixIncomes([]);
setPrefixBudgetDocs({});
return;
}

const prefixEndYM = prevYM(displayStartYM);
const start = ymdStartOfMonth(HISTORY_START);
const next = ymdStartOfNextMonth(prefixEndYM);

const qExp = query(collection(db, "expenses"), where("date", ">=", start), where("date", "<", next));
const expSnap = await getDocs(qExp);
const expList = expSnap.docs.map((d) => d.data() as ExpenseDoc);

const qInc = query(collection(db, "incomes"), where("date", ">=", start), where("date", "<", next));
const incSnap = await getDocs(qInc);
const incList = incSnap.docs
.map((d) => d.data() as IncomeDoc)
.filter((x) => Number.isFinite(Number(x.amount)));

// budgets（prefix months）
const prefixMonths = monthsBetween(HISTORY_START, prefixEndYM);
const out: Record<string, BudgetDoc | null> = {};
await Promise.all(
prefixMonths.map(async (ym) => {
try {
const id = budgetDocId(ym, ALL_REG);
const snap = await getDoc(doc(db, "budgets", id));
out[ym] = snap.exists() ? (snap.data() as BudgetDoc) : null;
} catch (e) {
console.error(e);
out[ym] = null;
}
})
);

if (!alive) return;
setPrefixExpenses(expList);
setPrefixIncomes(incList);
setPrefixBudgetDocs(out);
} catch (e) {
console.error(e);
if (!alive) return;
setPrefixExpenses([]);
setPrefixIncomes([]);
setPrefixBudgetDocs({});
}
})();

return () => {
alive = false;
};
}, [displayStartYM]);

// ---- actual by month (display range)
const actualByMonth = useMemo(() => {
const inc = new Map<string, number>();
for (const i of incomes) {
const ym = (i.date || "").slice(0, 7);
if (!ym) continue;
inc.set(ym, (inc.get(ym) ?? 0) + (Number(i.amount) || 0));
}

const exp = new Map<string, number>();
const tsumitate = new Map<string, number>();
for (const e of expenses) {
const ym = e.month || (e.date || "").slice(0, 7);
if (!ym) continue;
const amt = Number(e.amount) || 0;

if (e.category !== TRANSFER_CAT) {
exp.set(ym, (exp.get(ym) ?? 0) + amt);
}
if (e.category === TSUMITATE_CAT) {
tsumitate.set(ym, (tsumitate.get(ym) ?? 0) + amt);
}
}

return { inc, exp, tsumitate };
}, [expenses, incomes]);

// ---- actual by month (prefix)
const prefixActualByMonth = useMemo(() => {
const inc = new Map<string, number>();
for (const i of prefixIncomes) {
const ym = (i.date || "").slice(0, 7);
if (!ym) continue;
inc.set(ym, (inc.get(ym) ?? 0) + (Number(i.amount) || 0));
}

const exp = new Map<string, number>();
const tsumitate = new Map<string, number>();
for (const e of prefixExpenses) {
const ym = e.month || (e.date || "").slice(0, 7);
if (!ym) continue;
const amt = Number(e.amount) || 0;

if (e.category !== TRANSFER_CAT) {
exp.set(ym, (exp.get(ym) ?? 0) + amt);
}
if (e.category === TSUMITATE_CAT) {
tsumitate.set(ym, (tsumitate.get(ym) ?? 0) + amt);
}
}

return { inc, exp, tsumitate };
}, [prefixExpenses, prefixIncomes]);

// planned totals (display range)
const plannedByMonth = useMemo(() => {
const pInc = new Map<string, number>();
const pExp = new Map<string, number>();
const pTsu = new Map<string, number>();

for (const ym of monthsActive) {
const b = budgetDocs?.[ym] ?? null;
pInc.set(ym, plannedIncomeOfBudgetDoc(b));
pExp.set(ym, plannedExpenseOfBudgetDoc(b));
pTsu.set(ym, plannedTsumitateOfBudgetDoc(b));
}
return { pInc, pExp, pTsu };
}, [monthsActive, budgetDocs]);

// planned totals (prefix months)
const plannedPrefixBase = useMemo(() => {
if (ymToIndex(displayStartYM) <= ymToIndex(HISTORY_START)) return { pInc: 0, pExp: 0, pTsu: 0 };

const prefixEndYM = prevYM(displayStartYM);
const ms = monthsBetween(HISTORY_START, prefixEndYM);

let sumInc = 0;
let sumExp = 0;
let sumTsu = 0;

for (const ym of ms) {
const b = prefixBudgetDocs?.[ym] ?? null;
sumInc += plannedIncomeOfBudgetDoc(b);
sumExp += plannedExpenseOfBudgetDoc(b);
sumTsu += plannedTsumitateOfBudgetDoc(b);
}
return { pInc: sumInc, pExp: sumExp, pTsu: sumTsu };
}, [displayStartYM, prefixBudgetDocs]);

const todayYM = useMemo(() => ymToday(), []);
const todayIdx = useMemo(() => ymToIndex(todayYM), [todayYM]);

// 表示開始月より前の「実績残高」(初期0からの累計)
const actualBaseBeforeRange = useMemo(() => {
if (ymToIndex(displayStartYM) <= ymToIndex(HISTORY_START)) return 0;

const prefixEndYM = prevYM(displayStartYM);
const ms = monthsBetween(HISTORY_START, prefixEndYM);

let acc = 0;
for (const ym of ms) {
if (ymToIndex(ym) > todayIdx) break;

const inc = prefixActualByMonth.inc.get(ym) ?? 0;
const exp = prefixActualByMonth.exp.get(ym) ?? 0;
const tsu = prefixActualByMonth.tsumitate.get(ym) ?? 0;

const base = inc - exp;
acc += includeTsumitate ? base + tsu : base;
}
return acc;
}, [displayStartYM, prefixActualByMonth, todayIdx, includeTsumitate]);

// 表示開始月より前の「予定累計」(予定線の起点)
const plannedBaseBeforeRange = useMemo(() => {
const base = plannedPrefixBase.pInc - plannedPrefixBase.pExp;
return includeTsumitate ? base + plannedPrefixBase.pTsu : base;
}, [plannedPrefixBase, includeTsumitate]);

// build series
const series = useMemo(() => {
const months = monthsActive;

// 実績：月差分（過去〜当月は値、将来はnull）
const actualMonthlyDelta: (number | null)[] = months.map((ym) => {
if (ymToIndex(ym) > todayIdx) return null;

const inc = actualByMonth.inc.get(ym) ?? 0;
const exp = actualByMonth.exp.get(ym) ?? 0;
const tsu = actualByMonth.tsumitate.get(ym) ?? 0;

const base = inc - exp;
return includeTsumitate ? base + tsu : base;
});

// 予定：月差分（全月出す）
const plannedMonthlyDelta: number[] = months.map((ym) => {
const inc = plannedByMonth.pInc.get(ym) ?? 0;
const exp = plannedByMonth.pExp.get(ym) ?? 0;
const tsu = plannedByMonth.pTsu.get(ym) ?? 0;
const base = inc - exp;
return includeTsumitate ? base + tsu : base;
});

// 実績累計：起点を「表示開始月より前の残高」にする
let accA = actualBaseBeforeRange;
const actualCumulative: (number | null)[] = months.map((_, i) => {
const d = actualMonthlyDelta[i];
if (d === null) return null;
accA += d;
return accA;
});

// 予定累計：起点を「表示開始月より前の予定累計」にする
let accP = plannedBaseBeforeRange;
const plannedCumulativeAll: number[] = months.map((_, i) => {
accP += plannedMonthlyDelta[i];
return accP;
});

// 実績の最後の点
const lastActualIdx = (() => {
let idx = -1;
for (let i = 0; i < months.length; i++) {
if (actualCumulative[i] !== null) idx = i;
}
return idx;
})();

// 連結ON：実績最終点に予定累計を合わせてシフト
let plannedCumulativeLinked: (number | null)[] = plannedCumulativeAll.map((v) => v);

if (lastActualIdx >= 0 && linkForecast) {
const actualLast = Number(actualCumulative[lastActualIdx] ?? 0);
const plannedAtSame = Number(plannedCumulativeAll[lastActualIdx] ?? 0);
const shift = actualLast - plannedAtSame;

plannedCumulativeLinked = months.map((_, i) => {
const v = plannedCumulativeAll[i];
if (i < lastActualIdx) return v;
return v + shift;
});
}

const actualSeries = months.map((ym, i) => ({
date: ym,
monthly: actualMonthlyDelta[i],
cumulative: actualCumulative[i],
}));

const forecastSeries = months.map((ym, i) => ({
date: ym,
monthly: plannedMonthlyDelta[i],
cumulative: plannedCumulativeLinked[i] ?? plannedCumulativeAll[i],
}));

return { months, actualSeries, forecastSeries };
}, [
monthsActive,
todayIdx,
actualByMonth,
plannedByMonth,
includeTsumitate,
linkForecast,
actualBaseBeforeRange,
plannedBaseBeforeRange,
]);

// カード：最終残高
const currentBalance = useMemo(() => {
const a = series.actualSeries.map((x) => x.cumulative).filter((v) => v !== null) as number[];
if (a.length === 0) return actualBaseBeforeRange;
return a[a.length - 1];
}, [series, actualBaseBeforeRange]);

// 期間合計（表示期間の積立合計）
const periodTsumitateTotal = useMemo(() => {
return series.months.reduce((a, ym) => a + (actualByMonth.tsumitate.get(ym) ?? 0), 0);
}, [series.months, actualByMonth]);

// 全期間合計（HISTORY_START〜今の積立合計）
const allTimeTsumitateTotal = useMemo(() => {
// prefix は「HISTORY_START〜表示開始前月」なので、そのまま全部足してOK
let sum = 0;

for (const [, v] of prefixActualByMonth.tsumitate) sum += Number(v) || 0;
for (const [ym, v] of actualByMonth.tsumitate) {
// display側に未来が混ざる可能性は薄いけど、一応「今日より先」を除外
if (ymToIndex(ym) > todayIdx) continue;
sum += Number(v) || 0;
}
return sum;
}, [prefixActualByMonth, actualByMonth, todayIdx]);

// 期間だけの「貯金増減」（積立OFF時は純貯金、ON時は貯金+積立）
const periodBalanceDelta = useMemo(() => {
let sum = 0;
for (const ym of series.months) {
if (ymToIndex(ym) > todayIdx) break;

const inc = actualByMonth.inc.get(ym) ?? 0;
const exp = actualByMonth.exp.get(ym) ?? 0;
const tsu = actualByMonth.tsumitate.get(ym) ?? 0;

const base = inc - exp;
sum += includeTsumitate ? base + tsu : base;
}
return sum;
}, [series.months, actualByMonth, includeTsumitate, todayIdx]);

// 積立ONなら「貯金残高に加算」し、積立合計カードは0（仕様維持）
const cardBalance = includeTsumitate ? currentBalance + periodTsumitateTotal : currentBalance;
const cardTsumitateTop = includeTsumitate ? 0 : allTimeTsumitateTotal;

// 期間表示（小さく出すやつ）用の色・テキスト
const periodValueStyle = (v: number): { color: string; text: string } => {
if (v < 0) return { color: "#dc2626", text: fmtYen(v) }; // ▲付き
return { color: "#16a34a", text: fmtYen(v) }; // 0も緑、+は元々出ない
};

const showPeriodSub = useMemo(() => rangeMode, [rangeMode]);

const periodBalanceView = useMemo(() => periodValueStyle(periodBalanceDelta), [periodBalanceDelta]);
const periodTsumitateView = useMemo(() => periodValueStyle(periodTsumitateTotal), [periodTsumitateTotal]);

// styles
const styles = useMemo(() => {
const selectBase: React.CSSProperties = {
width: "100%",
height: 34,
borderRadius: 10,
border: "1px solid #cbd5e1",
padding: "0 6px",
fontSize: 12,
fontWeight: 900,
background: "#fff",
outline: "none",
fontVariantNumeric: "tabular-nums",
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

title: { fontSize: 18, fontWeight: 900, color: "#0b4aa2" } as React.CSSProperties,

card: {
background: "#ffffff",
border: "1px solid #e5e7eb",
borderRadius: 14,
padding: 12,
boxShadow: "0 6px 18px rgba(15, 23, 42, 0.05)",
} as React.CSSProperties,

toggleRow: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" } as React.CSSProperties,

toggleBtn: (active: boolean): React.CSSProperties => ({
height: 32,
padding: "0 12px",
borderRadius: 999,
border: "1px solid " + (active ? "#93c5fd" : "#cbd5e1"),
background: active ? "#dbeafe" : "#ffffff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
fontSize: 12,
flex: 1,
minWidth: 90,
}),

monthRow: {
display: "flex",
alignItems: "center",
gap: 8,
justifyContent: "center",
flexWrap: "wrap",
} as React.CSSProperties,

monthInput: {
...selectBase,
width: wide ? 150 : 140,
padding: "0 4px",
} as React.CSSProperties,

tinyBtn: {
height: 32,
padding: "0 12px",
borderRadius: 999,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
fontSize: 12,
} as React.CSSProperties,

cardsRow: {
display: "grid",
gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
gap: 8,
marginTop: 10,
} as React.CSSProperties,

infoCard: {
borderRadius: 14,
padding: 10,
border: "1px solid #dbeafe",
background: "linear-gradient(180deg, #dbeafe 0%, #ffffff 100%)",
} as React.CSSProperties,

infoTitle: { fontSize: 11, fontWeight: 900, color: "#1e3a8a" } as React.CSSProperties,
infoValue: {
marginTop: 6,
fontSize: 16,
fontWeight: 900,
textAlign: "center",
fontVariantNumeric: "tabular-nums",
} as React.CSSProperties,

infoSub: {
marginTop: 6,
fontSize: 11,
fontWeight: 900,
textAlign: "center",
color: "#64748b",
} as React.CSSProperties,

sectionTitle: { fontSize: 14, fontWeight: 900, color: "#0b4aa2" } as React.CSSProperties,

legendRow: {
display: "flex",
gap: 10,
alignItems: "center",
marginTop: 8,
flexWrap: "wrap",
fontWeight: 900,
color: "#334155",
fontSize: 12,
} as React.CSSProperties,

legendDot: (color: string): React.CSSProperties => ({
width: 10,
height: 10,
borderRadius: 999,
background: color,
display: "inline-block",
}),

note: { fontSize: 12, color: "#334155", fontWeight: 800 } as React.CSSProperties,
};
}, [wide]);

const canClearToDefault = useMemo(() => rangeMode, [rangeMode]);

return (
<div style={styles.page}>
<div style={styles.title}>貯蓄</div>

<div style={{ ...styles.card, marginTop: 10 }}>
{/* toggles */}
<div style={styles.toggleRow}>
<button
style={styles.toggleBtn(rangeMode)}
onClick={() => {
setRangeMode((v) => {
const next = !v;
if (!v && next) {
setRangeStart(monthsActive[0] ?? DEFAULT_START);
setRangeEnd(monthsActive[monthsActive.length - 1] ?? ymToday());
}
return next;
});
}}
>
期間
</button>

<button style={styles.toggleBtn(lineMode === "monthly")} onClick={() => setLineMode("monthly")}>
月別
</button>
<button style={styles.toggleBtn(lineMode === "cumulative")} onClick={() => setLineMode("cumulative")}>
累計
</button>

<button style={styles.toggleBtn(showForecast)} onClick={() => setShowForecast((v) => !v)}>
予定貯蓄
</button>

<button style={styles.toggleBtn(includeTsumitate)} onClick={() => setIncludeTsumitate((v) => !v)}>
積立
</button>

<button style={styles.toggleBtn(linkForecast)} onClick={() => setLinkForecast((v) => !v)}>
連結
</button>
</div>

{/* range inputs */}
{rangeMode && (
<div style={{ ...styles.monthRow, marginTop: 10 }}>
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
{canClearToDefault && (
<button
style={styles.tinyBtn}
onClick={() => {
setRangeMode(false);
setRangeStart(DEFAULT_START);
setRangeEnd(ymToday());
}}
>
解除
</button>
)}
</div>
)}

{/* cards */}
<div style={styles.cardsRow}>
<div style={styles.infoCard}>
<div style={styles.infoTitle}>貯金残高（実績）</div>
<div style={styles.infoValue}>{fmtYen(cardBalance)}</div>

{/* 期間だけ（range指定時のみ） */}
{showPeriodSub && (
<div style={{ ...styles.infoSub, color: periodBalanceView.color }}>{periodBalanceView.text}</div>
)}
</div>

<div style={styles.infoCard}>
<div style={styles.infoTitle}>積立合計（実績）</div>
<div style={styles.infoValue}>{fmtYen(cardTsumitateTop)}</div>

{/* 期間だけ（range指定時のみ） */}
{showPeriodSub && (
<div style={{ ...styles.infoSub, color: periodTsumitateView.color }}>{periodTsumitateView.text}</div>
)}
</div>
</div>
</div>

{/* chart */}
<div style={{ ...styles.card, marginTop: 10 }}>
<div style={styles.sectionTitle}>推移（{lineMode === "monthly" ? "月別" : "累計"}）</div>

<div style={styles.legendRow}>
<span>
<span style={styles.legendDot("#0b4aa2")} /> 実績
</span>
{showForecast && (
<span>
<span style={styles.legendDot("#f97316")} /> 予定
</span>
)}

</div>

{loading ? (
<div style={{ ...styles.note, textAlign: "center", padding: 14 }}>読み込み中…</div>
) : (
<SavingsLineChart
months={series.months}
mode={lineMode}
showForecast={showForecast}
actual={series.actualSeries.map((x) => (lineMode === "monthly" ? x.monthly : x.cumulative))}
forecast={series.forecastSeries.map((x) => (lineMode === "monthly" ? x.monthly : x.cumulative))}
/>
)}
</div>
</div>
);
}

/** ---------------------------
* Chart helpers
* --------------------------*/

/**
* 2桁有効（上から2桁目を四捨五入）
*/
function roundTo2Significant(n: number) {
const x = Math.abs(n);
if (x === 0) return 0;
const digits = Math.floor(Math.log10(x)) + 1;
const factor = Math.pow(10, Math.max(0, digits - 2));
return Math.round(n / factor) * factor;
}

/**
* Y軸 tick 生成
* - max を 4 等分した step を2桁有効で丸める
* - maxNice = stepNice * 4
* - min側は「期間MIN以上」で止める（MIN未満は不要）
*/
function buildYAxis(values: number[]) {
const safe = values.length ? values : [0];
const realMin = Math.min(...safe);
const realMax = Math.max(...safe);

const maxBase = Math.max(realMax, 0, 1);
const stepRaw = maxBase / 4;
const stepNice = Math.max(1, roundTo2Significant(stepRaw));
const maxNice = stepNice * 4;

const minTarget = Math.min(realMin, 0);

const ticks: number[] = [];
for (let v = 0; v <= maxNice + 0.0001; v += stepNice) ticks.push(Math.round(v));

if (minTarget < 0) {
let v = -stepNice;
while (v >= minTarget - 0.0001) {
ticks.unshift(Math.round(v));
v -= stepNice;
}
}

return { min: Math.min(minTarget, ticks[0] ?? minTarget), max: maxNice, ticks };
}

function ymToLabelJP(ym: string) {
const y = ym.slice(0, 4);
const m = String(Number(ym.slice(5, 7)));
return `${y}年${m}月`;
}

function navBtnStyle(): React.CSSProperties {
return {
height: 28,
padding: "0 10px",
borderRadius: 999,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
fontSize: 12,
whiteSpace: "nowrap",
};
}
function miniCardStyle(): React.CSSProperties {
return {
borderRadius: 10,
border: "1px solid #e2e8f0",
padding: 8,
background: "#fff",
};
}
function miniTitleStyle(): React.CSSProperties {
return { fontSize: 11, color: "#334155" };
}
function miniValueStyle(): React.CSSProperties {
return { marginTop: 6, textAlign: "center", fontSize: 14, fontWeight: 900 };
}

/** ---------------------------
* Chart component
* --------------------------*/
function SavingsLineChart({
months,
actual,
forecast,
mode,
showForecast,
}: {
months: string[];
actual: (number | null)[];
forecast: (number | null)[];
mode: "monthly" | "cumulative";
showForecast: boolean;
}) {
const W = 680;
const H = 260;

const padL = 64;
const padR = 16;
const padT = 14;
const padB = 28;

const [selectedYM, setSelectedYM] = useState<string | null>(null);

const allValues = useMemo(() => {
const vals: number[] = [];
for (const v of actual) if (v !== null && Number.isFinite(Number(v))) vals.push(Number(v));
if (showForecast) for (const v of forecast) if (v !== null && Number.isFinite(Number(v))) vals.push(Number(v));
return vals.length ? vals : [0];
}, [actual, forecast, showForecast]);

const axis = useMemo(() => buildYAxis(allValues), [allValues]);

const valueToY = (v: number) => {
const range = axis.max - axis.min || 1;
const ratio = (v - axis.min) / range;
return H - padB - ratio * (H - padT - padB);
};

const n = months.length;
const xStep = n <= 1 ? 0 : (W - padL - padR) / (n - 1);

const pts = useMemo(() => {
return months.map((ym, i) => {
const x = padL + xStep * i;
const a = actual[i];
const f = showForecast ? forecast[i] : null;

const ay = a === null ? null : valueToY(Number(a || 0));
const fy = f === null ? null : valueToY(Number(f || 0));

return { ym, x, a, f, ay, fy };
});
}, [months, xStep, actual, forecast, showForecast, axis.min, axis.max]);

const buildPath = (key: "ay" | "fy") => {
let d = "";
let started = false;
for (const p of pts) {
const y = p[key] as number | null;
if (y === null) {
started = false;
continue;
}
if (!started) {
d += `M ${p.x.toFixed(1)} ${y.toFixed(1)} `;
started = true;
} else {
d += `L ${p.x.toFixed(1)} ${y.toFixed(1)} `;
}
}
return d.trim();
};

const dA = useMemo(() => buildPath("ay"), [pts]);
const dF = useMemo(() => buildPath("fy"), [pts]);

// x labels skip
const labelSkip = useMemo(() => {
if (n <= 12) return 1;
if (n <= 24) return 2;
return 3;
}, [n]);

// 年またぎ縦線
const yearLines = useMemo(() => {
const out: { x: number; ym: string }[] = [];
for (let i = 1; i < pts.length; i++) {
const prevY = pts[i - 1].ym.slice(0, 4);
const curY = pts[i].ym.slice(0, 4);
if (prevY !== curY) out.push({ x: pts[i].x, ym: pts[i].ym });
}
return out;
}, [pts]);

const selectedInfo = useMemo(() => {
if (!selectedYM) return null;
const idx = months.findIndex((m) => m === selectedYM);
if (idx < 0) return null;

const a = actual[idx];
const f = showForecast ? forecast[idx] : null;

const aNum = a === null ? null : Number(a);
const fNum = f === null ? null : Number(f);

const diff = aNum !== null && fNum !== null ? aNum - fNum : null;

return { idx, ym: selectedYM, a: aNum, f: fNum, diff };
}, [selectedYM, months, actual, forecast, showForecast]);

const moveSelected = (dir: -1 | 1) => {
if (!selectedInfo) return;
const nextIdx = selectedInfo.idx + dir;
if (nextIdx < 0 || nextIdx >= months.length) return;
setSelectedYM(months[nextIdx]);
};

const diffColor = (diff: number | null) => {
if (diff === null) return "#334155";
if (diff >= 0) return "#16a34a";
return "#dc2626";
};

const diffText = (diff: number | null) => {
if (diff === null) return "—";
return fmtYen(diff); // +は元々出ない
};

return (
<div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 10, marginTop: 10 }}>
<svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 260, display: "block" }}>
{/* 年またぎ縦線（濃くする） */}
{yearLines.map((l) => (
<line
key={`yline-${l.ym}`}
x1={l.x}
x2={l.x}
y1={padT}
y2={H - padB}
stroke="#64748b"
strokeDasharray="3 4"
strokeWidth="1.6"
/>
))}

{/* 横補助線 + 縦軸数値 */}
{axis.ticks.map((t, i) => {
const y = valueToY(t);
const isZero = t === 0;

return (
<g key={`tick-${t}-${i}`}>
{!isZero && (
<line
x1={padL}
x2={W - padR}
y1={y}
y2={y}
stroke="#9e9c9c"
strokeDasharray="4 6"
strokeWidth="0.8"
/>
)}

<text x={padL - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b" fontWeight="800">
{fmtYen(t)}
</text>
</g>
);
})}

{/* 0 line */}
<line x1={padL} x2={W - padR} y1={valueToY(0)} y2={valueToY(0)} stroke="#334155" strokeWidth="1.2" />

{/* forecast */}
{showForecast && <path d={dF} fill="none" stroke="#f97316" strokeWidth="2.8" />}

{/* actual */}
<path d={dA} fill="none" stroke="#0b4aa2" strokeWidth="3" />

{/* dots */}
{pts.map((p) => {
const out: any[] = [];

if (p.fy !== null) {
out.push(
<g key={p.ym + "_f"}>
<circle
cx={p.x}
cy={p.fy}
r={11}
fill="transparent"
onClick={() => setSelectedYM(p.ym)}
style={{ cursor: "pointer" }}
/>
<circle cx={p.x} cy={p.fy} r={3.2} fill="#f97316" stroke="#ffffff" strokeWidth={1.5} />
</g>
);
}

if (p.ay !== null) {
out.push(
<g key={p.ym + "_a"}>
<circle
cx={p.x}
cy={p.ay}
r={11}
fill="transparent"
onClick={() => setSelectedYM(p.ym)}
style={{ cursor: "pointer" }}
/>
<circle cx={p.x} cy={p.ay} r={3.2} fill="#0b4aa2" stroke="#ffffff" strokeWidth={1.5} />
</g>
);
}

return out;
})}

{/* x labels */}
{pts.map((p, i) => {
if (n > 12 && i % labelSkip !== 0 && i !== 0 && i !== n - 1) return null;

const prevY = i > 0 ? pts[i - 1].ym.slice(0, 4) : null;
const curY = p.ym.slice(0, 4);
const yearChanged = i === 0 || (prevY && prevY !== curY);

const m = String(Number(p.ym.slice(5, 7)));
const yy = p.ym.slice(2, 4);
const label = yearChanged ? `${yy}/${m}` : m;

return (
<text key={p.ym + "_x"} x={p.x} y={H - 6} textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="800">
{label}
</text>
);
})}
</svg>

{/* panel */}
{selectedInfo && (
<div
style={{
marginTop: 10,
borderRadius: 12,
border: "1px solid #dbeafe",
background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
padding: "10px 12px",
fontWeight: 900,
}}
>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
<div style={{ color: "#0b4aa2" }}>
{ymToLabelJP(selectedInfo.ym)}（{mode === "monthly" ? "月別" : "累計"}）
</div>

<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
<button onClick={() => moveSelected(-1)} style={navBtnStyle()} aria-label="prev">
←
</button>
<button onClick={() => moveSelected(1)} style={navBtnStyle()} aria-label="next">
→
</button>
<button onClick={() => setSelectedYM(null)} style={navBtnStyle()}>
閉じる
</button>
</div>
</div>

<div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
<div style={miniCardStyle()}>
<div style={miniTitleStyle()}>貯蓄額</div>
<div style={miniValueStyle()}>{selectedInfo.a === null ? "—" : fmtYen(selectedInfo.a)}</div>
</div>

<div style={miniCardStyle()}>
<div style={miniTitleStyle()}>予定貯蓄</div>
<div style={miniValueStyle()}>{selectedInfo.f === null ? "—" : fmtYen(selectedInfo.f)}</div>
</div>

<div style={miniCardStyle()}>
<div style={miniTitleStyle()}>差額</div>
<div style={{ ...miniValueStyle(), color: diffColor(selectedInfo.diff) }}>{diffText(selectedInfo.diff)}</div>
</div>
</div>
</div>
)}
</div>
);
}