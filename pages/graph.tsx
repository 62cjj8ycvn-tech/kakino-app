// pages/graph.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import {
collection,
doc,
getDoc,
getDocs,
query,
where,
updateDoc,
deleteDoc,
serverTimestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { CATEGORIES, SUBCATEGORIES, EXPENSE_SOURCES, REGISTRANTS } from "../lib/masterData";
type Category = (typeof CATEGORIES)[number];

function isCategory(x: any): x is Category {
return (CATEGORIES as readonly string[]).includes(String(x));
}
// =====================
// ✅ 月キャッシュ追加（ここから）
// =====================



const expensesCacheByMonth = new Map<string, { rows: ExpenseDoc[]; cachedAt: number }>();
const incomesCacheByRange = new Map<string, { rows: IncomeDoc[]; cachedAt: number }>();

const EXPENSES_TTL_MS = 1000 * 60 * 10; // 10分
const INCOMES_TTL_MS = 1000 * 60 * 10; // 10分

function isFresh(ts: number, ttl: number) {
return Date.now() - ts <= ttl;
}

// =====================
// ✅ 月キャッシュ追加（ここまで）
// =====================

function fmtMdDow(ymd: string) {
// ymd: "YYYY-MM-DD"
const [ys, ms, ds] = (ymd ?? "").split("-");
const y = Number(ys);
const m = Number(ms);
const d = Number(ds);

// 不正値の保険（変な値が来ても落とさない）
const yy = Number.isFinite(y) ? y : 1970;
const mm = Number.isFinite(m) ? m : 1;
const dd = Number.isFinite(d) ? d : 1;

const dt = new Date(yy, mm - 1, dd);
const dow = dt.getDay(); // 0=日
const JP = ["日", "月", "火", "水", "木", "金", "土"];
return { text: `${mm}/${dd}(${JP[dow]})`, isWeekend: dow === 0 || dow === 6 };
}


/**
* GraphPage（完成版）
* - 見た目・UIは現行のまま
* - 目安ロジック完全統一
* - 棒グラフ行は横全体タップ可能
*/

type ExpenseDoc = {
id: string;
registrant: string;
date: string;
month: string;
amount: number;
category: string;
subCategory: string;
source: string;
memo?: string;

// ✅ 追加（最終登録判定用）
createdAt?: any;
updatedAt?: any;
};

type IncomeDoc = {
registrant: string;
date: string;
amount: number;
source: string;
};

type BudgetDoc = {
month: string;
registrant: string;
items?: Record<string, number>;
categoryBudgets?: Record<string, number>;
subBudgets?: Record<string, Record<string, number>>;
};

const ALL_REG = "(全員)";

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
return CATEGORY_COLORS[cat] ?? "#1e88e5";
}

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

return {
y: Number.isFinite(y) ? y : 1970,
m: Number.isFinite(m) ? m : 1,
};
}

function daysInMonth(ym: string) {
const { y, m } = parseYM(ym);
return new Date(y, m, 0).getDate();
}

function clamp(n: number, min: number, max: number) {
return Math.max(min, Math.min(max, n));
}

function fmtYen(n: number) {
const r = Math.round(Number(n) || 0);
const sign = r < 0 ? "▲" : "";
return `${sign}¥${Math.abs(r).toLocaleString("ja-JP")}`;
}

const FREE_LABEL = "自由入力";

function digitsOnly(s: string) {
return (s || "").replace(/[^\d]/g, "");
}
function formatWithCommaDigits(s: string) {
const d = digitsOnly(s);
if (!d) return "";
return new Intl.NumberFormat("ja-JP").format(Number(d));
}
function parseAmountFromText(amountText: string, isMinus: boolean) {
const d = digitsOnly(amountText);
if (!d) return NaN;
const n = Number(d);
if (!Number.isFinite(n)) return NaN;
return isMinus ? -n : n;
}

function diffStyleAndText(diff: number) {
if (diff < 0) {
return { color: "#dc2626", text: `▲¥${Math.abs(diff).toLocaleString("ja-JP")}` };
}
return { color: "#16a34a", text: `¥${diff.toLocaleString("ja-JP")}` };
}

// Firestore helpers
function budgetDocId(month: string, registrant: string) {
return `${month}__${registrant}`;
}

async function fetchBudgetDoc(month: string) {
const ids = [budgetDocId(month, ALL_REG)];
for (const id of ids) {
const snap = await getDoc(doc(db, "budgets", id));
if (snap.exists()) return snap.data() as BudgetDoc;
}
return null;
}

// source helpers
const isMiuSource = (s: string) => (s || "").includes("未有");
const isShoyaSource = (s: string) => (s || "").includes("将");

// ===== ここまで Part1 =====
// ===== Part2 ここから =====

// range helpers
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
function chunk<T>(arr: T[], size: number) {
const out: T[][] = [];
for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
return out;
}

function ymdStartOfMonthFromYM(ym: string) {
return `${ym}-01`;
}
function ymdStartOfNextMonthFromYM(ym: string) {
const { y, m } = parseYM(ym);
const d = new Date(y, m, 1); // 次月1日
const yy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, "0");
return `${yy}-${mm}-01`;
}

// 収入の“未有分”だけ欲しい（未有立替の差し引きに使用）
function isMiuIncome(i: IncomeDoc) {
return (i.source || "").includes("未有") || (i.registrant || "").includes("未有");
}

type Scope = "total" | "shoya" | "miu";

/**
* ✅カテゴリ予算 正規化
* categoryBudgets / items / subBudgets合計 の最大を採用
*/
function normalizeCategoryBudgets(
docData: BudgetDoc | null,
categories: readonly string[]
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

/**
* ✅「外食だけ土日20倍」用の配分
* - 1日平日=1、土日=20 の重み
* - 月の合計予算にピッタリ合うように 1日あたり額を算出
*/
function buildWeightedDailyBudgetsForGaisyoku(ym: string, monthlyBudget: number) {
const dim = daysInMonth(ym);
const weights: number[] = [];
for (let day = 1; day <= dim; day++) {
const dt = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1, day);
const dow = dt.getDay(); // 0=日 6=土
const isWeekend = dow === 0 || dow === 6;
weights.push(isWeekend ? 20 : 1);
}
const sumW = weights.reduce((a, b) => a + b, 0) || 1;
const unit = monthlyBudget / sumW;
// day(1..dim) -> budget
const daily = weights.map((w) => unit * w);

// 端数調整（丸めでズレるのを防ぐため、最後に差分吸収）
// ※ここは「計算用」はfloatのまま持っておき、表示は丸め。
return daily; // length=dim, index0=1日
}

/**
* ✅ 目安線（累計）を「月初=初日の実績、月末=予算」で直線
* - 初日の実績が0なら従来通り（0→予算）
* - 外食(土日20倍)が対象なら、その配分で「その日までの累計予算」を使う
*/


/**
* ✅ 期間モードの「その月の目安上限」
* - 当月だけ日割り（当日まで） * factor
* - それ以外は月予算 * factor
*/


export default function GraphPage() {
const router = useRouter();

const goToExpense = (openAdd?: boolean) => {
// openAdd=true のとき、支出ページ側で「＋登録モーダル」を自動で開く
router.push(openAdd ? "/expense?openAdd=1" : "/expense");
};

// responsive
const [wide, setWide] = useState(false);
useEffect(() => {
const on = () => setWide(window.innerWidth >= 768);
on();
window.addEventListener("resize", on);
return () => window.removeEventListener("resize", on);
}, []);

// month + nav
const [month, setMonth] = useState(ymToday());

// range mode
const [rangeMode, setRangeMode] = useState(false);
const [rangeStart, setRangeStart] = useState(ymToday());
const [rangeEnd, setRangeEnd] = useState(ymToday());

// 目安係数（従来=0.95 / ON=1.0）
const [guideFull, setGuideFull] = useState(false);
const guideFactor = guideFull ? 1.0 : 0.95;

const moveMonth = (delta: number) => {
const { y, m } = parseYM(month);
const d = new Date(y, m - 1 + delta, 1);
const yy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, "0");
setMonth(`${yy}-${mm}`);
};

// scope（支出合計/将哉/未有）
const [scope, setScope] = useState<Scope>("total");

// data
const [rowsMonth, setRowsMonth] = useState<ExpenseDoc[]>([]);
const [incomesMonth, setIncomesMonth] = useState<IncomeDoc[]>([]);
const [loading, setLoading] = useState(true);
// ====== 日付/期間に応じた対象month配列 ======
const monthsActive = useMemo(() => {
return rangeMode ? monthsBetween(rangeStart, rangeEnd) : [month];
}, [rangeMode, rangeStart, rangeEnd, month]);
const forceReload = () => {
for (const ym of monthsActive) {
expensesCacheByMonth.delete(ym);
}
incomesCacheByRange.clear();
window.location.reload(); // 一番簡単な強制再取得
};
// budgets
const [budgetDoc, setBudgetDoc] = useState<BudgetDoc | null>(null);
const [budgetDocs, setBudgetDocs] = useState<Record<string, BudgetDoc | null>>({});

// drilldown
const [drillCat, setDrillCat] = useState<string | null>(null);
const [drillSub, setDrillSub] = useState<string | null>(null);

// line mode
const [lineMode, setLineMode] = useState<"daily" | "cumulative">("cumulative");

// collapse categories
const COLLAPSE_CATS = ["固定費", "積立", "振替"] as const;
const [showCollapsedCats, setShowCollapsedCats] = useState(false);

// ====== expenses + incomes load ======
useEffect(() => {
let alive = true;

(async () => {
setLoading(true);

try {
const months = monthsActive;

if (months.length === 0) {
if (!alive) return;
setRowsMonth([]);
setIncomesMonth([]);
return;
}

// =====================
// ✅ expenses（月キャッシュ）
// =====================
const resultByMonth: Record<string, ExpenseDoc[]> = {};
const missing: string[] = [];

for (const ym of months) {
const cached = expensesCacheByMonth.get(ym);
if (cached && isFresh(cached.cachedAt, EXPENSES_TTL_MS)) {
resultByMonth[ym] = cached.rows;
} else {
missing.push(ym);
}
}

// 取得が必要な月は空配列で初期化
for (const ym of missing) resultByMonth[ym] = [];

// Firestoreは "in" が最大10なので chunk
for (const part of chunk(missing, 10)) {
const qExp = query(collection(db, "expenses"), where("month", "in", part));
const snap = await getDocs(qExp);

snap.docs.forEach((d) => {
const raw = d.data() as any;

const row: ExpenseDoc = {
id: d.id,
registrant: String(raw.registrant ?? ""),
date: String(raw.date ?? ""),
month: String(raw.month ?? ""),
amount: Number(raw.amount ?? 0),
category: String(raw.category ?? ""),
subCategory: String(raw.subCategory ?? ""),
source: String(raw.source ?? ""),
memo: raw.memo != null ? String(raw.memo) : "",

// ✅ 追加
createdAt: raw.createdAt ?? null,
updatedAt: raw.updatedAt ?? null,
};


const ym = row.month;
if (!resultByMonth[ym]) resultByMonth[ym] = [];
resultByMonth[ym].push(row);
});
}

// ✅ ここでまとめてキャッシュ保存（for(part) の外）
if (missing.length > 0) {
const now = Date.now();
for (const ym of missing) {
const rows = resultByMonth[ym] ?? [];
expensesCacheByMonth.set(ym, { rows, cachedAt: now });
}
}

const expList = months.flatMap((ym) => resultByMonth[ym] ?? []);

// =====================
// ✅ incomes（期間キャッシュ）
// =====================
const startYM = months[0]!; // months.length===0 は上で弾いてる
const endYM2 = months[months.length - 1] ?? startYM;

const start = `${startYM}-01`;
const { y, m } = parseYM(endYM2);
const nextMonth = new Date(y, m, 1);
const next = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;

const rangeKey = `${start}__${next}`;

let incList: IncomeDoc[] = [];
const cachedInc = incomesCacheByRange.get(rangeKey);

if (cachedInc && isFresh(cachedInc.cachedAt, INCOMES_TTL_MS)) {
incList = cachedInc.rows;
} else {
const qInc = query(
collection(db, "incomes"),
where("date", ">=", start),
where("date", "<", next)
);
const snap = await getDocs(qInc);

incList = snap.docs
.map((d) => d.data() as IncomeDoc)
.filter((x) => Number(x.amount) > 0);

incomesCacheByRange.set(rangeKey, { rows: incList, cachedAt: Date.now() });
}

if (!alive) return;
setRowsMonth(expList);
setIncomesMonth(incList);
} catch (e) {
console.error(e);
if (!alive) return;
setRowsMonth([]);
setIncomesMonth([]);
} finally {
if (!alive) return;
setLoading(false);
}
})();

return () => {
alive = false;
};
}, [monthsActive.join("|")]);

// ====== budgets load ======
useEffect(() => {
let alive = true;

(async () => {
try {
if (!rangeMode) {
const docData = await fetchBudgetDoc(month);
if (!alive) return;
setBudgetDoc(docData);
setBudgetDocs({});
return;
}

const months = monthsActive;
const result: Record<string, BudgetDoc | null> = {};
for (const ym of months) {
result[ym] = await fetchBudgetDoc(ym);
}

if (!alive) return;
setBudgetDocs(result);
setBudgetDoc(null);
} catch (e) {
console.error(e);
if (!alive) return;
setBudgetDoc(null);
setBudgetDocs({});
}
})();

return () => {
alive = false;
};
}, [rangeMode, month, monthsActive]);

// ====== 予算 正規化（単月 / 期間で合算） ======
const { categoryBudgets, subBudgets } = useMemo(() => {
if (!rangeMode) {
const normalized = normalizeCategoryBudgets(budgetDoc, CATEGORIES);
return { categoryBudgets: normalized.cat, subBudgets: normalized.sub };
}

const catSum: Record<string, number> = {};
const subSum: Record<string, Record<string, number>> = {};
for (const c of CATEGORIES) {
catSum[c] = 0;
subSum[c] = {};
}

for (const ym of monthsActive) {
const docData = budgetDocs[ym] ?? null;
const normalized = normalizeCategoryBudgets(docData, CATEGORIES);

for (const c of CATEGORIES) {
catSum[c] = (catSum[c] ?? 0) + Number(normalized.cat?.[c] ?? 0);
const sMap = (normalized.sub?.[c] ?? {}) as Record<string, number>;
for (const [subKey, v] of Object.entries(sMap)) {
subSum[c] = subSum[c] ?? {};
subSum[c][subKey] = (subSum[c][subKey] ?? 0) + (Number(v) || 0);
}
}
}

return { categoryBudgets: catSum, subBudgets: subSum };
}, [rangeMode, budgetDoc, monthsActive, budgetDocs]);

// ====== scope（実績だけ絞る） ======
const scopeFiltered = useMemo(() => {
if (scope === "total") return rowsMonth;
if (scope === "shoya") return rowsMonth.filter((r) => isShoyaSource(r.source));
return rowsMonth.filter((r) => isMiuSource(r.source));
}, [rowsMonth, scope]);
// ✅ カテゴリごとの「内訳 実績集計」
// - 娯楽費は「将哉 / 未有」を registrant で集計（あなたのsubAgg仕様と同じ）
// - それ以外は「自由入力」をまとめて "自由入力" 扱い（あなたのsubAgg仕様と同じ）
// - 文字の揺れ対策で trim() する
function subAggForCategorySafe(category: string) {
// 予防：category が空でも落とさない
const cat = String(category ?? "");

// ✅ 娯楽費は特別ルール（あなたの subAgg と同じ）
if (cat === "娯楽費") {
const shoya = scopeFiltered
.filter(
(r) =>
String(r.category ?? "") === "娯楽費" &&
(String(r.registrant ?? "").includes("将") || String(r.registrant ?? "").includes("将哉"))
)
.reduce((a, b) => a + (Number(b.amount) || 0), 0);

const miu = scopeFiltered
.filter(
(r) =>
String(r.category ?? "") === "娯楽費" &&
String(r.registrant ?? "").includes("未有")
)
.reduce((a, b) => a + (Number(b.amount) || 0), 0);

return [
{ subCategory: "将哉", actual: shoya },
{ subCategory: "未有", actual: miu },
];
}

const FREE = "自由入力";

// official 内訳（自由入力は除外）
const officialRaw = isCategory(cat) ? (SUBCATEGORIES[cat] ?? []) : [];
const official = officialRaw.filter((s) => s !== FREE).map((s) => String(s).trim());

// 実績を map 集計
const m = new Map<string, number>();

for (const r of scopeFiltered) {
if (String(r.category ?? "") !== cat) continue;

const raw = String(r.subCategory ?? "").trim();
const key = official.includes(raw) ? raw : FREE; // ✅ 自由入力まとめ
m.set(key, (m.get(key) ?? 0) + (Number(r.amount) || 0));
}

return Array.from(m.entries()).map(([subCategory, actual]) => ({ subCategory, actual }));
}

function daysSinceYMD(ymd: string) {
// ymd: "YYYY-MM-DD"
if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return Infinity;

const parts = String(ymd).split("-");
const y = Number(parts[0]);
const m = Number(parts[1]);
const d = Number(parts[2]);

// 不正値の保険（NaN なら Infinity 扱い）
if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return Infinity;

const dt = new Date(y, m - 1, d);
const today = new Date();
const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
const diffMs = t0.getTime() - dt.getTime();
return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}


function latestDateOf(list: ExpenseDoc[]) {
// date文字列の最大を返す（YYYY-MM-DD なので文字比較でOK）
let max = "";
for (const r of list) {
const d = String(r.date || "");
if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > max) max = d;
}
return max;
}

function tsToYMD(ts: any) {
if (!ts) return "";
const d =
typeof ts?.toDate === "function"
? ts.toDate()
: ts instanceof Date
? ts
: null;
if (!d) return "";
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
const day = String(d.getDate()).padStart(2, "0");
return `${y}-${m}-${day}`;
}

// ✅ “最終登録日” = updatedAt > createdAt > date の順で最大を返す
function latestRegisteredYMD(list: ExpenseDoc[]) {
let max = "";
for (const r of list) {
const ymd = tsToYMD(r.updatedAt) || tsToYMD(r.createdAt) || String(r.date || "");
if (/^\d{4}-\d{2}-\d{2}$/.test(ymd) && ymd > max) max = ymd;
}
return max;
}

// totals
const totalActual = useMemo(() => scopeFiltered.reduce((a, b) => a + (Number(b.amount) || 0), 0), [
scopeFiltered,
]);

// 将哉立替（年月のみ）
const shoyaPaid = useMemo(() => {
return rowsMonth.filter((r) => isShoyaSource(r.source)).reduce((a, b) => a + (Number(b.amount) || 0), 0);
}, [rowsMonth]);

// 未有立替 = 支出(未有) - 収入(未有)
const miuPaid = useMemo(() => {
const expMiu = rowsMonth.filter((r) => isMiuSource(r.source)).reduce((a, b) => a + (Number(b.amount) || 0), 0);
const incMiu = incomesMonth.filter((i) => isMiuIncome(i)).reduce((a, b) => a + (Number(b.amount) || 0), 0);
return expMiu - incMiu;
}, [rowsMonth, incomesMonth]);

// ===== 最終支出日（将哉/未有）=====
// ✅ 起点は「支出日(date)」で判定する（登録日 createdAt/updatedAt は見ない）

const shoyaLastExpenseDate = useMemo(() => {
return latestDateOf(rowsMonth.filter((r) => r.registrant === "将哉"));
}, [rowsMonth]);

const miuLastExpenseDate = useMemo(() => {
return latestDateOf(rowsMonth.filter((r) => r.registrant === "未有"));
}, [rowsMonth]);

// ✅ 「3日以上」＝ >= 3（いまは >3 だからズレてた）
const shoyaLate = useMemo(() => daysSinceYMD(shoyaLastExpenseDate) >= 3, [shoyaLastExpenseDate]);
const miuLate = useMemo(() => daysSinceYMD(miuLastExpenseDate) >= 3, [miuLastExpenseDate]);

// 娯楽費（立替カード内訳用：金額）
const shoyaEntertainment = useMemo(() => {
return rowsMonth
.filter((r) => r.category === "娯楽費" && (r.registrant || "").includes("将"))
.reduce((a, b) => a + (Number(b.amount) || 0), 0);
}, [rowsMonth]);

const miuEntertainment = useMemo(() => {
return rowsMonth
.filter((r) => r.category === "娯楽費" && (r.registrant || "").includes("未有"))
.reduce((a, b) => a + (Number(b.amount) || 0), 0);
}, [rowsMonth]);

// ====== Part2 ここまで（次でUI/チャート/モーダル実装に入る） =====
// ===== Part3 ここから（GraphPageの残り + LineChart改修 + モーダル） =====

// ====== 立替カード：娯楽費の「予算差」表示 ======
const shoyaEntBudget = useMemo(() => Number(subBudgets?.["娯楽費"]?.["将哉"] ?? 0), [subBudgets]);
const miuEntBudget = useMemo(() => Number(subBudgets?.["娯楽費"]?.["未有"] ?? 0), [subBudgets]);

const shoyaEntDiffInfo = useMemo(() => diffStyleAndText(shoyaEntBudget - shoyaEntertainment), [
shoyaEntBudget,
shoyaEntertainment,
]);
const miuEntDiffInfo = useMemo(() => diffStyleAndText(miuEntBudget - miuEntertainment), [
miuEntBudget,
miuEntertainment,
]);

const miuColor = miuPaid < 0 ? "#dc2626" : "#0f172a";

// ====== category aggregate（scope実績に合わせる） ======
const categoryAggAll = useMemo(() => {
const m = new Map<string, number>();
for (const r of scopeFiltered) {
m.set(r.category, (m.get(r.category) ?? 0) + (Number(r.amount) || 0));
}
return CATEGORIES.map((c) => ({
category: c,
actual: m.get(c) ?? 0,
budget: Number(categoryBudgets?.[c] ?? 0),
}));
}, [scopeFiltered, categoryBudgets]);

const categoryAggVisible = useMemo(() => {
if (showCollapsedCats) return categoryAggAll;
return categoryAggAll.filter((x) => !COLLAPSE_CATS.includes(x.category as any));
}, [categoryAggAll, showCollapsedCats]);

// ====== drilldown sub agg (actual) ★自由入力を合算 / 娯楽費は将哉・未有を常時表示 ======
const subAgg = useMemo(() => {
if (!drillCat) return [];

// ✅ 娯楽費は「将哉」「未有」を常時表示（0円でも出す）
if (drillCat === "娯楽費") {
const shoya = scopeFiltered
.filter(
(r) =>
r.category === "娯楽費" &&
((r.registrant || "").includes("将") || (r.registrant || "").includes("将哉"))
)
.reduce((a, b) => a + (Number(b.amount) || 0), 0);

const miu = scopeFiltered
.filter((r) => r.category === "娯楽費" && (r.registrant || "").includes("未有"))
.reduce((a, b) => a + (Number(b.amount) || 0), 0);

return [
{ subCategory: "将哉", actual: shoya },
{ subCategory: "未有", actual: miu },
];
}

const FREE = "自由入力";
const officialRaw = isCategory(drillCat) ? (SUBCATEGORIES[drillCat] ?? []) : [];
const official = officialRaw.filter((s) => s !== FREE);

const m = new Map<string, number>();
for (const r of scopeFiltered) {
if (r.category !== drillCat) continue;
const raw = (r.subCategory || "").trim();
const key = official.includes(raw) ? raw : FREE;
m.set(key, (m.get(key) ?? 0) + (Number(r.amount) || 0));
}

const keys = [...official, FREE];
const keysFiltered = keys.filter((k) => k !== FREE || (m.get(FREE) ?? 0) !== 0);

return keysFiltered.map((k) => ({
subCategory: k,
actual: m.get(k) ?? 0,
}));
}, [scopeFiltered, drillCat]);

// ✅ 内訳フィルタ（自由入力含む）
function filterByCatSub(list: ExpenseDoc[], cat: string | null, sub: string | null) {
let out = list;
if (cat) out = out.filter((r) => r.category === cat);
if (!cat || !sub) return out;

// ✅ 娯楽費は subCategory ではなく registrant で分岐
if (cat === "娯楽費") {
if (sub === "将哉") {
return out.filter(
(r) => (r.registrant || "").includes("将") || (r.registrant || "").includes("将哉")
);
}
if (sub === "未有") return out.filter((r) => (r.registrant || "").includes("未有"));
return out;
}

const FREE = "自由入力";
const officialRaw = isCategory(cat) ? (SUBCATEGORIES[cat] ?? []) : [];
const official = officialRaw.filter((s) => s !== FREE);


if (sub === FREE) {
return out.filter((r) => {
const raw = (r.subCategory || "").trim();
return !official.includes(raw);
});
}
return out.filter((r) => (r.subCategory || "").trim() === sub);
}

// --- 期間モード用：月ごとの正規化予算キャッシュ（TDZ回避：先に作る） ---
const normalizedByYM = useMemo(() => {
const out: Record<
string,
{ cat: Record<string, number>; sub: Record<string, Record<string, number>> }
> = {};
if (!rangeMode) return out;
for (const ym of monthsActive) {
out[ym] = normalizeCategoryBudgets(budgetDocs[ym] ?? null, CATEGORIES);
}
return out;
}, [rangeMode, monthsActive, budgetDocs]);

// 期間モード：カテゴリの目安合計（各月の目安を足す）
function guidelineTotalForCategoryInRange(category: string) {
let sum = 0;
for (const ym of monthsActive) {
const n = normalizedByYM[ym];
const b = Number(n?.cat?.[category] ?? 0);
sum += guidelineOfMonth(ym, b, guideFactor);
}
return sum;
}


// 期間モード：内訳の目安合計（各月の目安を足す）
const guidelineTotalForSubInRange = useMemo(() => {
return (category: string, subCategory: string) => {
let sum = 0;
for (const ym of monthsActive) {
const n = normalizedByYM[ym];
const b = Number(n?.sub?.[category]?.[subCategory] ?? 0);
if (!b || b <= 0) continue;
sum += guidelineOfMonth(ym, b, guideFactor);
}
return sum;
};
}, [monthsActive, normalizedByYM, guideFactor]);

// build days (1..end)
const days = useMemo(() => {
const dim = daysInMonth(month);
const arr: string[] = [];
for (let d = 1; d <= dim; d++) {
const dd = String(d).padStart(2, "0");
arr.push(`${month}-${dd}`);
}
return arr;
}, [month]);

// line focus
const lineFocus = useMemo(() => {
if (!drillCat) return { cat: null as string | null, sub: null as string | null };
return { cat: drillCat, sub: drillSub };
}, [drillCat, drillSub]);

// daily series (0 fill)
const dailySeries = useMemo(() => {
const baseList = filterByCatSub(scopeFiltered, lineFocus.cat, lineFocus.sub);

const target =
!lineFocus.cat && !lineFocus.sub && !showCollapsedCats
? baseList.filter((r) => !COLLAPSE_CATS.includes(r.category as any))
: baseList;

const m = new Map<string, number>();
for (const r of target) {
m.set(r.date, (m.get(r.date) ?? 0) + (Number(r.amount) || 0));
}

const seriesBase = days.map((d) => ({ date: d, value: m.get(d) ?? 0 }));
if (lineMode === "daily") return seriesBase;

let acc = 0;
return seriesBase.map((x) => {
acc += x.value;
return { date: x.date, value: acc };
});
}, [scopeFiltered, days, lineMode, lineFocus.cat, lineFocus.sub, showCollapsedCats]);

// ✅期間モード用（月別） series
const monthlySeries = useMemo(() => {
if (!rangeMode) return [];

const baseList = filterByCatSub(rowsMonth, lineFocus.cat, lineFocus.sub);

const baseTarget =
!lineFocus.cat && !lineFocus.sub && !showCollapsedCats
? baseList.filter((r) => !COLLAPSE_CATS.includes(r.category as any))
: baseList;

const scoped =
scope === "total"
? baseTarget
: scope === "shoya"
? baseTarget.filter((r) => isShoyaSource(r.source))
: baseTarget.filter((r) => isMiuSource(r.source));

const m = new Map<string, number>();
for (const r of scoped) {
m.set(r.month, (m.get(r.month) ?? 0) + (Number(r.amount) || 0));
}

const seriesBase = monthsActive.map((ym) => ({ date: ym, value: m.get(ym) ?? 0 }));
if (lineMode === "daily") return seriesBase;

let acc = 0;
return seriesBase.map((x) => {
acc += x.value;
return { date: x.date, value: acc };
});
}, [rangeMode, monthsActive, rowsMonth, lineFocus.cat, lineFocus.sub, scope, lineMode, showCollapsedCats]);

// ✅期間モード用（月別） guideline（外食の土日20倍は「単月日別ロジック」専用なので、期間(月別)は従来通り）
const monthlyGuidelineSeries = useMemo(() => {
if (!rangeMode) return [];

// ① 期間合計目安を算出
let totalBudget = 0;

for (const ym of monthsActive) {
const n = normalizedByYM[ym];

if (lineFocus.cat && lineFocus.sub) {
totalBudget += Number(n?.sub?.[lineFocus.cat]?.[lineFocus.sub] ?? 0);
} else if (lineFocus.cat) {
totalBudget += Number(n?.cat?.[lineFocus.cat] ?? 0);
} else {
const cats = showCollapsedCats
? CATEGORIES
: CATEGORIES.filter((c) => !COLLAPSE_CATS.includes(c as any));

let catsBudget = 0;
for (const c of cats as string[]) {
catsBudget += Number(n?.cat?.[c] ?? 0) || 0;
}
totalBudget += catsBudget;
}
}

totalBudget *= guideFactor;

const monthCount = monthsActive.length || 1;
const perMonth = totalBudget / monthCount;

// ② 月別 or 累計
if (lineMode === "daily") {
// 月別：全月同じ目安
return monthsActive.map((ym) => ({
date: ym,
value: Math.round(perMonth),
}));
}

// 累計：直線（0 → totalBudget）
let acc = 0;
return monthsActive.map((ym) => {
acc += perMonth;
return {
date: ym,
value: Math.round(acc),
};
});
}, [
rangeMode,
monthsActive,
normalizedByYM,
lineFocus.cat,
lineFocus.sub,
lineMode,
guideFactor,
showCollapsedCats,
]);
// ✅「初日実績を起点」にした目安線（単月：日別/累計 共通。外食は土日20倍配分）
const guidelineSeries = useMemo(() => {
const dim = daysInMonth(month);

// baseBudget算出（全体/カテゴリ/内訳）
let baseBudget = 0;

// 外食土日20倍：対象は「食費」カテゴリの「外食」内訳選択中だけ
const useGaisyokuWeekendBoost =
!rangeMode && lineFocus.cat === "食費" && lineFocus.sub === "外食";

if (lineFocus.cat && lineFocus.sub) {
baseBudget = Number(subBudgets?.[lineFocus.cat]?.[lineFocus.sub] ?? 0);
} else if (lineFocus.cat) {
baseBudget = Number(categoryBudgets?.[lineFocus.cat] ?? 0);
} else {
const catsForLine = showCollapsedCats
? CATEGORIES
: CATEGORIES.filter((c) => !COLLAPSE_CATS.includes(c as any));

let sum = 0;
for (const c of catsForLine as readonly string[]) {
sum += Number((categoryBudgets as any)?.[c] ?? 0) || 0;
}
baseBudget = sum;
}

// 1日目の実績（lineFocus/畳みを反映した「その1日ぶん」）
const baseList = filterByCatSub(scopeFiltered, lineFocus.cat, lineFocus.sub);
const target =
!lineFocus.cat && !lineFocus.sub && !showCollapsedCats
? baseList.filter((r) => !COLLAPSE_CATS.includes(r.category as any))
: baseList;

const firstDayKey = `${month}-01`;
const firstDayActual = target
.filter((r) => r.date === firstDayKey)
.reduce((a, b) => a + (Number(b.amount) || 0), 0);

// 予算0なら0固定
if (!baseBudget || baseBudget <= 0) {
return days.map((date) => ({ date, value: 0 }));
}

return buildGuidelineSeriesWithFirstDayActual({
ym: month,
dates: days,
mode: lineMode,
baseBudget,
guideFactor,
firstDayActual,
useGaisyokuWeekendBoost,
});
}, [
rangeMode,
lineMode,
month,
days,
scopeFiltered,
categoryBudgets,
subBudgets,
lineFocus.cat,
lineFocus.sub,
showCollapsedCats,
guideFactor,
]);

// forecast (cumulative only / 単月だけ)
const forecast = useMemo(() => {
if (rangeMode) return null;
if (lineMode !== "cumulative") return null;

const dim = daysInMonth(month);
const isCurrent = month === ymToday();
const today = isCurrent ? new Date().getDate() : dim;
const d = clamp(today, 1, dim);

const first = dailySeries[0]?.value ?? 0;
const todayValue = dailySeries[d - 1]?.value ?? 0;

let monthEndValue = 0;
if (d === 1) {
monthEndValue = Math.round(first);
} else {
const slope = (todayValue - first) / (d - 1);
monthEndValue = Math.round(first + slope * (dim - 1));
}

// 予測差に使う予算
let budget = 0;
if (lineFocus.cat && lineFocus.sub) {
if (lineFocus.cat === "娯楽費") {
budget = Number(subBudgets?.["娯楽費"]?.[lineFocus.sub] ?? 0);
} else {
budget = Number(subBudgets?.[lineFocus.cat]?.[lineFocus.sub] ?? 0);
}
} else if (lineFocus.cat) {
budget = Number(categoryBudgets?.[lineFocus.cat] ?? 0);
} else {
const catsForLine = showCollapsedCats
? CATEGORIES
: CATEGORIES.filter((c) => !COLLAPSE_CATS.includes(c as any));

let sum = 0;
for (const c of catsForLine as readonly string[]) {
sum += Number((categoryBudgets as any)?.[c] ?? 0) || 0;
}
budget = sum;
}

const diff = budget - monthEndValue;
return {
today: d,
monthEndValue,
budget,
remaining: diff,
diffInfo: diffStyleAndText(diff),
};
}, [
rangeMode,
lineMode,
dailySeries,
month,
categoryBudgets,
subBudgets,
lineFocus.cat,
lineFocus.sub,
showCollapsedCats,
]);
// ===== グラフ下部：全体の当日目安カード（単月のみ） =====
const bottomGuideCard = useMemo(() => {
if (rangeMode) return null;

const dim = daysInMonth(month);

// ✅ 表示日付：当月なら今日 / 過去月なら月末
const isCurrent = month === ymToday();
const dayNum = isCurrent ? new Date().getDate() : dim;
const d = clamp(dayNum, 1, dim);

const y = Number(month.slice(0, 4));
const m = Number(month.slice(5, 7));
const dateLabel = `${y}年${m}月${d}日`;

// ✅ 固定費/積立/振替が「表示されていない」時は、
// 予算も支出もその3カテゴリを除外した“全体”を使う
const visibleCats = showCollapsedCats
? CATEGORIES
: CATEGORIES.filter((c) => !COLLAPSE_CATS.includes(c as any));

// ✅ 予算（全体）
let totalBudgetVisible = 0;
for (const c of visibleCats as readonly string[]) {
totalBudgetVisible += Number((categoryBudgets as any)?.[c] ?? 0) || 0;
}

// ✅ 支出（全体 / scope反映）
// scopeは「支出合計/将哉/未有」の表示に合わせる（いまのUIと整合）
const scoped = scope === "total"
? rowsMonth
: scope === "shoya"
? rowsMonth.filter((r) => isShoyaSource(r.source))
: rowsMonth.filter((r) => isMiuSource(r.source));

const visibleSet = new Set<string>(visibleCats as readonly string[]);
const actualVisible = scoped
.filter((r) => visibleSet.has(String(r.category ?? "")))
.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

// ✅ 目安計算（あなたの指定どおり）
// 目安ON → factor=1.0 / OFF → factor=0.95
const factor = guideFull ? 1.0 : 0.95;
const guide = Math.round((totalBudgetVisible / dim) * d * factor);

// ✅ 差異表示（支出 - 目安）
// 支出が多い＝超過：▲赤
// 支出が少ない/同じ＝緑（+無し、0も緑）
const delta = Math.round(actualVisible - guide);
const isOver = delta > 0;

const deltaText = isOver
? `▲¥${Math.abs(delta).toLocaleString("ja-JP")}`
: `¥${Math.abs(delta).toLocaleString("ja-JP")}`;

const deltaColor = isOver ? "#dc2626" : "#16a34a";
const deltaLabel = isOver ? "超過" : "差異";

return {
dateLabel,
guide,
actual: actualVisible,
deltaText,
deltaColor,
deltaLabel,
};
}, [
rangeMode,
month,
guideFull,
showCollapsedCats,
categoryBudgets,
rowsMonth,
scope,
]);


// line max/min
const { lineMax, lineMin } = useMemo(() => {
const seriesA = rangeMode ? monthlySeries : dailySeries;
const seriesG = rangeMode ? monthlyGuidelineSeries : guidelineSeries;

const values = [
...seriesA.map((x) => x.value),
...seriesG.map((x) => x.value),
...(forecast ? [forecast.monthEndValue] : []),
];

const max = Math.max(...values, 0);
const min = Math.min(...values, 0);
if (max === 0 && min === 0) return { lineMax: 1, lineMin: 0 };
return { lineMax: max, lineMin: min };
}, [rangeMode, dailySeries, monthlySeries, guidelineSeries, monthlyGuidelineSeries, forecast]);

// top budget total（常に全カテゴリ合算）
const totalBudgetAll = useMemo(() => {
return Object.values(categoryBudgets ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
}, [categoryBudgets]);

const totalDiffInfo = useMemo(() => diffStyleAndText(totalBudgetAll - totalActual), [totalBudgetAll, totalActual]);

// guideline for category bar marker（カテゴリ単位）
function categoryGuidelineValue(catBudget: number) {
const dim = daysInMonth(month);
const isCurrent = month === ymToday();
const today = isCurrent ? new Date().getDate() : dim;
const d = clamp(today, 1, dim);
if (!catBudget || catBudget <= 0) return 0;
return Math.round((catBudget / dim) * d * guideFactor);
}

// drill header summary（カテゴリ合計＋予算）
const drillHeader = useMemo(() => {
if (!drillCat) return null;

const actual = categoryAggAll.find((c) => c.category === drillCat)?.actual ?? 0;
const budget = Number(categoryBudgets?.[drillCat] ?? 0);

const guideline = rangeMode
? guidelineTotalForCategoryInRange(drillCat)
: categoryGuidelineValue(budget);

const overBudget = budget > 0 && actual > budget;
const overGuide = guideline > 0 && actual > guideline;

const actualColor = overBudget ? "#dc2626" : overGuide ? "#f97316" : "#16a34a";

const guideDiffInfo = diffStyleAndText(guideline - actual);
const budgetDiffInfo = diffStyleAndText(budget - actual);

return { actual, budget, guideline, actualColor, guideDiffInfo, budgetDiffInfo };
}, [drillCat, categoryAggAll, categoryBudgets, rangeMode, guidelineTotalForCategoryInRange, guideFactor, month]);

// ====== 折れ線グラフ上の ← month/range連動 → ======
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

// ====== 点タップ：日(or月)モーダル ======
const [detailOpen, setDetailOpen] = useState(false);
const [detailKey, setDetailKey] = useState<string>(""); // "YYYY-MM-DD" or "YYYY-MM"
const [detailModeMonthly, setDetailModeMonthly] = useState(false);
// ====== 下部一覧（期間全体の明細） ======
const [bottomOpen, setBottomOpen] = useState(false);
const [bottomCat, setBottomCat] = useState<string | null>(null);
const [bottomSub, setBottomSub] = useState<string | null>(null);

const [bottomSort, setBottomSort] = useState<{ key: "date" | "amount"; dir: "asc" | "desc" }>({
key: "date",
dir: "asc",
});
// ====== 明細行タップ：編集/削除モーダル（支出ページと同UI） ======
const [editOpen, setEditOpen] = useState(false);
const [editingId, setEditingId] = useState<string | null>(null);

// form（支出ページ互換）
const [registrant, setRegistrant] = useState<string>(() => {
if (REGISTRANTS.includes("将哉")) return "将哉";
if (REGISTRANTS.length) return REGISTRANTS[0];
return "";
});
const [date, setDate] = useState<string>("");
const [amountText, setAmountText] = useState<string>("");
const [isMinus, setIsMinus] = useState<boolean>(false);
const [category, setCategory] = useState<string>("");
const [subCategorySelect, setSubCategorySelect] = useState<string>("");
const [source, setSource] = useState<string>("");
const [memo, setMemo] = useState<string>("");

// validation（支出ページ互換）
const [touched, setTouched] = useState<Record<string, boolean>>({});

const openEdit = (r: ExpenseDoc) => {
setEditingId(r.id);
setTouched({});

setRegistrant(String(r.registrant ?? ""));
setDate(String(r.date ?? ""));

const amt = Number(r.amount) || 0;
setIsMinus(amt < 0);
setAmountText(formatWithCommaDigits(String(Math.abs(amt))));

const cat = String(r.category ?? "");
setCategory(cat);

// 「自由入力」判定：マスターに無い内訳は自由入力扱い（支出ページと同じ思想）
const list = isCategory(cat) ? (SUBCATEGORIES[cat] ?? []) : [];
if (list.includes(String(r.subCategory ?? ""))) {
setSubCategorySelect(String(r.subCategory ?? ""));
setMemo(String(r.memo ?? "")); // 通常メモ
} else {
setSubCategorySelect(FREE_LABEL);
setMemo(String(r.subCategory ?? "")); // 自由入力文字列は memo欄で編集
}

setSource(String(r.source ?? ""));
setEditOpen(true);
};

const closeEdit = () => {
setEditOpen(false);
setEditingId(null);
};

// subCategory（保存用）
const finalSubCategory = useMemo(() => {
if (!subCategorySelect) return "";
if (subCategorySelect === FREE_LABEL) return (memo || "").trim();
return subCategorySelect;
}, [subCategorySelect, memo]);

const amountValue = useMemo(() => {
return parseAmountFromText(amountText, isMinus);
}, [amountText, isMinus]);

const missing = useMemo(() => {
const m: Record<string, boolean> = {};
m.registrant = !registrant;
m.date = !date;
m.amount = !amountText || !Number.isFinite(amountValue);
m.category = !category;
m.subCategory = !finalSubCategory;
m.source = !source;
return m;
}, [registrant, date, amountText, amountValue, category, finalSubCategory, source]);

const hasMissing = useMemo(() => Object.values(missing).some(Boolean), [missing]);

const markAllTouched = () => {
setTouched({
registrant: true,
date: true,
amount: true,
category: true,
subCategory: true,
source: true,
});
};

const onChangeAmount = (v: string) => {
setAmountText(formatWithCommaDigits(v));
if (!touched.amount) setTouched((t) => ({ ...t, amount: true }));
};

const toggleMinus = () => {
setIsMinus((p) => !p);
if (!touched.amount) setTouched((t) => ({ ...t, amount: true }));
};

const onSaveEdit = async () => {
if (!editingId) return;

if (hasMissing) {
markAllTouched();
alert("未入力の必須項目があります。赤枠の項目を入力してください。");
return;
}

if (!Number.isFinite(amountValue) || amountValue === 0) {
setTouched((t) => ({ ...t, amount: true }));
alert("金額が不正です（0不可・整数のみ）。");
return;
}

const nextDate = String(date ?? "");
if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
setTouched((t) => ({ ...t, date: true }));
alert("日付が不正です（YYYY-MM-DD）");
return;
}

const nextMonth = nextDate.slice(0, 7);

// rowsMonth から対象を拾う（idで一致）
const current = rowsMonth.find((x) => x.id === editingId);
if (!current) {
alert("対象の明細が見つかりませんでした。");
return;
}

const nextRow: ExpenseDoc = {
...current,
registrant,
date: nextDate,
month: nextMonth,
amount: Math.trunc(amountValue),
category,
subCategory: finalSubCategory,
source,
memo: memo || "",
};

try {
await updateDoc(doc(db, "expenses", editingId), {
registrant: nextRow.registrant,
date: nextRow.date,
month: nextRow.month,
amount: nextRow.amount,
category: nextRow.category,
subCategory: nextRow.subCategory,
source: nextRow.source,
memo: nextRow.memo ?? "",
updatedAt: serverTimestamp(),
});

// state更新
setRowsMonth((prev) => prev.map((r) => (r.id === nextRow.id ? nextRow : r)));

// ✅ キャッシュは「旧月/新月」を消す（安全策）
expensesCacheByMonth.delete(current.month);
expensesCacheByMonth.delete(nextRow.month);

closeEdit();
} catch (e) {
console.error(e);
alert("保存に失敗しました。");
}
};

const onDeleteEdit = async () => {
if (!editingId) return;

const current = rowsMonth.find((x) => x.id === editingId);
if (!current) return;

const ok = confirm("この明細を削除しますか？");
if (!ok) return;

try {
await deleteDoc(doc(db, "expenses", editingId));

setRowsMonth((prev) => prev.filter((r) => r.id !== editingId));
expensesCacheByMonth.delete(current.month);

closeEdit();
} catch (e) {
console.error(e);
alert("削除に失敗しました。");
}
};

// モーダル内フィルタ（カテゴリ/内訳/金額範囲/登録者）
type DetailFilter = {
category: string; // "" = 未指定
subCategory: string; // "" = 未指定
registrant: string; // "" = 未指定
amountMin: string; // "" = 未指定
amountMax: string; // "" = 未指定
};

const EMPTY_DETAIL_FILTER: DetailFilter = {
category: "",
subCategory: "",
registrant: "",
amountMin: "",
amountMax: "",
};


const [detailFilter, setDetailFilter] = useState<DetailFilter>(EMPTY_DETAIL_FILTER);

// ====== ヘッダー用：フィルター選択モーダル ======
type PickerKind = "category" | "subCategory" | "amount" | "registrant";
const [pickerOpen, setPickerOpen] = useState(false);
const [pickerKind, setPickerKind] = useState<PickerKind>("category");



const openPicker = (kind: PickerKind) => {
setPickerKind(kind);
setPickerOpen(true);
};

const closePicker = () => setPickerOpen(false);

// ====== 下部一覧用：フィルタ ======
type BottomPickerKind = "date" | "subCategory" | "amount" | "registrant";

const [bottomFilter, setBottomFilter] = useState<{
subCategory: string; // ""=指定なし
registrant: string; // ""=指定なし
amountMin: string; // ""=指定なし
amountMax: string; // ""=指定なし
dateWeekendOnly: boolean; // つけたいなら（今回は未使用でもOK）
}>({
subCategory: "",
registrant: "",
amountMin: "",
amountMax: "",
dateWeekendOnly: false,
});

const [bottomPickerOpen, setBottomPickerOpen] = useState(false);
const [bottomPickerKind, setBottomPickerKind] = useState<BottomPickerKind>("subCategory");

const openBottomPicker = (kind: BottomPickerKind) => {
setBottomPickerKind(kind);
setBottomPickerOpen(true);
};
const closeBottomPicker = () => setBottomPickerOpen(false);

const applyBottomPickerValue = (v: any) => {
if (bottomPickerKind === "subCategory") {
setBottomFilter((p) => ({ ...p, subCategory: String(v || "") }));
} else if (bottomPickerKind === "registrant") {
setBottomFilter((p) => ({ ...p, registrant: String(v || "") }));
} else if (bottomPickerKind === "amount") {
setBottomFilter((p) => ({ ...p, amountMin: String(v?.min ?? ""), amountMax: String(v?.max ?? "") }));
}
closeBottomPicker();
};

// ====== 下部一覧：ベース行（カテゴリ/内訳/期間/ソートまで反映） ======
const bottomRows = useMemo(() => {
if (!bottomOpen || !bottomCat) return [];

// ① scopeを反映（rowsMonth は期間モードなら monthsActive 全月ぶん入ってる）
let base =
scope === "total"
? rowsMonth
: scope === "shoya"
? rowsMonth.filter((r) => isShoyaSource(r.source))
: rowsMonth.filter((r) => isMiuSource(r.source));

// ② カテゴリ/内訳で絞る
base = filterByCatSub(base, bottomCat, bottomSub);

// ③ month 範囲を安全に限定
if (!rangeMode) {
base = base.filter((r) => r.month === month);
} else {
const setYM = new Set(monthsActive);
base = base.filter((r) => setYM.has(r.month));
}

// ④ 並び替え
const mul = bottomSort.dir === "asc" ? 1 : -1;
const out = [...base].sort((a, b) => {
if (bottomSort.key === "amount") return (Number(a.amount) - Number(b.amount)) * mul;
return String(a.date).localeCompare(String(b.date)) * mul;
});

return out;
}, [bottomOpen, bottomCat, bottomSub, bottomSort, scope, rowsMonth, rangeMode, month, monthsActive]);

// ====== 下部一覧：フィルタ適用後 ======
const bottomRowsFiltered = useMemo(() => {
let out = [...bottomRows];

// 内訳（表示値の文字一致でOK）
if (bottomFilter.subCategory) out = out.filter((r) => r.subCategory === bottomFilter.subCategory);

if (bottomFilter.registrant) out = out.filter((r) => r.registrant === bottomFilter.registrant);

const min = bottomFilter.amountMin?.trim() ? Number(bottomFilter.amountMin) : null;
const max = bottomFilter.amountMax?.trim() ? Number(bottomFilter.amountMax) : null;

if (min != null && Number.isFinite(min)) out = out.filter((r) => Number(r.amount) >= min);
if (max != null && Number.isFinite(max)) out = out.filter((r) => Number(r.amount) <= max);

// dateWeekendOnly を使うならここで絞れる
// if (bottomFilter.dateWeekendOnly) out = out.filter((r) => fmtMdDow(r.date).isWeekend);

return out;
}, [bottomRows, bottomFilter]);

// ====== 下部ピッカー選択肢（Hookはトップレベルで！） ======
const bottomPickerOptions = useMemo(() => {
if (bottomPickerKind === "subCategory") {
const uniq = Array.from(new Set(bottomRows.map((r) => r.subCategory))).filter(Boolean);
return [{ label: "（指定なし）", value: "" }, ...uniq.map((s) => ({ label: s, value: s }))];
}

if (bottomPickerKind === "registrant") {
const uniq = Array.from(new Set(bottomRows.map((r) => r.registrant))).filter(Boolean);
return [{ label: "（指定なし）", value: "" }, ...uniq.map((s) => ({ label: s, value: s }))];
}

if (bottomPickerKind === "amount") {
return [
{ label: "（指定なし）", value: { min: "", max: "" } },
{ label: "〜 ¥999", value: { min: "", max: "999" } },
{ label: "¥1,000 〜 ¥4,999", value: { min: "1000", max: "4999" } },
{ label: "¥5,000 〜 ¥9,999", value: { min: "5000", max: "9999" } },
{ label: "¥10,000 〜 ¥19,999", value: { min: "10000", max: "19999" } },
{ label: "¥20,000 〜", value: { min: "20000", max: "" } },
];
}

// date は今回は未使用
return [{ label: "（指定なし）", value: "" }];
}, [bottomPickerKind, bottomRows]);

// モーダル内ソート（全て昇順/降順可能）
const [detailSort, setDetailSort] = useState<{
key: "date" | "amount" | "category" | "subCategory" | "registrant";
dir: "asc" | "desc";
}>({ key: "date", dir: "asc" });

const openDetailByKey = (key: string, isMonthly: boolean) => {
setDetailKey(key);
setDetailModeMonthly(isMonthly);
setDetailOpen(true);
setDetailFilter({
category: "",
subCategory: "",
registrant: "",
amountMin: "",
amountMax: "",
});
setDetailSort({ key: "date", dir: "asc" });
};


// モーダルの明細（今のlineFocusを必ず反映）
const detailRows = useMemo(() => {
// ① scopeを反映したベース
let base = scopeFiltered;

// ② lineFocus（カテゴリ/内訳）を反映
base = filterByCatSub(base, lineFocus.cat, lineFocus.sub);

// ③ 日(or月)で絞る
const picked = detailModeMonthly
? base.filter((r) => r.month === detailKey)
: base.filter((r) => r.date === detailKey);

// ④ 追加フィルタ
let out = picked;
if (detailFilter.category) out = out.filter((r) => r.category === detailFilter.category);
if (detailFilter.subCategory) out = out.filter((r) => r.subCategory === detailFilter.subCategory);
if (detailFilter.registrant) out = out.filter((r) => r.registrant === detailFilter.registrant);

// ✅ 金額（範囲）
const min = detailFilter.amountMin?.trim() ? Number(detailFilter.amountMin) : null;
const max = detailFilter.amountMax?.trim() ? Number(detailFilter.amountMax) : null;

if (min != null && Number.isFinite(min)) out = out.filter((r) => Number(r.amount) >= min);
if (max != null && Number.isFinite(max)) out = out.filter((r) => Number(r.amount) <= max);

// ✅ 並び替え（全て昇順/降順）
const dirMul = detailSort.dir === "asc" ? 1 : -1;

const toStr = (v: any) => String(v ?? "");
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

out = [...out].sort((a, b) => {
const k = detailSort.key;

if (k === "amount") {
return (Number(a.amount) - Number(b.amount)) * dirMul;
}
if (k === "date") {
return cmpStr(toStr(a.date), toStr(b.date)) * dirMul;
}
if (k === "category") {
return cmpStr(toStr(a.category), toStr(b.category)) * dirMul;
}
if (k === "subCategory") {
return cmpStr(toStr(a.subCategory), toStr(b.subCategory)) * dirMul;
}
// registrant
return cmpStr(toStr(a.registrant), toStr(b.registrant)) * dirMul;
});

return out;
}, [
scopeFiltered,
lineFocus.cat,
lineFocus.sub,
detailKey,
detailModeMonthly,
detailFilter,
detailSort,
]);

// 選択肢を作る（いま見えてる明細からユニーク抽出）
const pickerOptions = useMemo(() => {
if (pickerKind === "category") {
// カテゴリはマスター固定
return [{ label: "（指定なし）", value: "" }, ...CATEGORIES.map((c) => ({ label: c, value: c }))];
}

if (pickerKind === "subCategory") {
const uniq = Array.from(new Set(detailRows.map((r) => r.subCategory))).filter(Boolean);
return [{ label: "（指定なし）", value: "" }, ...uniq.map((s) => ({ label: s, value: s }))];
}

if (pickerKind === "registrant") {
const uniq = Array.from(new Set(detailRows.map((r) => r.registrant))).filter(Boolean);
return [{ label: "（指定なし）", value: "" }, ...uniq.map((s) => ({ label: s, value: s }))];
}

// amount（プリセット）
return [
{ label: "（指定なし）", value: { min: "", max: "" } },
{ label: "〜 ¥999", value: { min: "", max: "999" } },
{ label: "¥1,000 〜 ¥4,999", value: { min: "1000", max: "4999" } },
{ label: "¥5,000 〜 ¥9,999", value: { min: "5000", max: "9999" } },
{ label: "¥10,000 〜 ¥19,999", value: { min: "10000", max: "19999" } },
{ label: "¥20,000 〜", value: { min: "20000", max: "" } },
];
}, [pickerKind, detailRows]);

const applyPickerValue = (v: any) => {
if (pickerKind === "category") {
setDetailFilter((p) => ({ ...p, category: String(v || ""), subCategory: "" }));
} else if (pickerKind === "subCategory") {
setDetailFilter((p) => ({ ...p, subCategory: String(v || "") }));
} else if (pickerKind === "registrant") {
setDetailFilter((p) => ({ ...p, registrant: String(v || "") }));
} else {
// amount
const min = v?.min ?? "";
const max = v?.max ?? "";
setDetailFilter((p) => ({ ...p, amountMin: String(min), amountMax: String(max) }));
}

closePicker();
};

const detailTotal = useMemo(() => {
return detailRows.reduce((a, b) => a + (Number(b.amount) || 0), 0);
}, [detailRows]);

const detailCategoryTotals = useMemo(() => {
const m = new Map<string, number>();
for (const r of detailRows) {
m.set(r.category, (m.get(r.category) ?? 0) + (Number(r.amount) || 0));
}
return Array.from(m.entries())
.map(([category, total]) => ({ category, total }))
.filter((x) => x.total !== 0)
.sort((a, b) => b.total - a.total);
}, [detailRows]);

// ====== styles（Part1/2のまま） ======
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

const cardTitleSize = 11;
const cardValueSize = 15;
const cardSubValueSize = 11;
const subLabelSize = 9;
const subValueSize = 10;

return {

overlay: {
position: "fixed",
inset: 0,
background: "rgba(2,6,23,0.45)",
zIndex: 80,
display: "flex",
alignItems: "flex-end",
justifyContent: "center",
padding: 10,
} as React.CSSProperties,

modal: {
width: "100%",
maxWidth: 680,
background: "#fff",
borderRadius: 16,
border: "1px solid #e5e7eb",
boxShadow: "0 18px 45px rgba(0,0,0,0.25)",
overflow: "hidden",
} as React.CSSProperties,

modalHead: {
display: "flex",
alignItems: "center",
justifyContent: "space-between",
padding: "10px 12px",
background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
borderBottom: "1px solid #dbeafe",
} as React.CSSProperties,

modalTitle: { fontSize: 14, fontWeight: 900, color: "#0b4aa2" } as React.CSSProperties,
modalBody: { padding: 12 } as React.CSSProperties,

grid: {
display: "grid",
gridTemplateColumns: wide ? "1fr 1fr" : "1fr",
gap: 10,
} as React.CSSProperties,

label: { fontSize: 12, fontWeight: 900, color: "#334155", marginBottom: 4 } as React.CSSProperties,

input: {
width: "100%",
height: 36,
borderRadius: 10,
border: "1px solid #cbd5e1",
padding: "0 10px",
fontSize: 13,
background: "#fff",
outline: "none",
} as React.CSSProperties,

errorBorder: {
border: "2px solid #dc2626",
background: "#fff5f5",
} as React.CSSProperties,

amountRow: {
display: "grid",
gridTemplateColumns: "1fr 44px",
gap: 6,
alignItems: "center",
} as React.CSSProperties,

minusBtn: (active: boolean): React.CSSProperties => ({
height: 36,
borderRadius: 10,
border: "1px solid " + (active ? "#fecaca" : "#cbd5e1"),
background: active ? "#fee2e2" : "#fff",
color: active ? "#b91c1c" : "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
fontSize: 12,
}),

regCardRow: {
display: "grid",
gridTemplateColumns: "1fr 1fr",
gap: 8,
marginBottom: 10,
} as React.CSSProperties,

regCard: (active: boolean): React.CSSProperties => ({
borderRadius: 14,
padding: 10,
border: "1px solid " + (active ? "#93c5fd" : "#e2e8f0"),
background: active ? "linear-gradient(180deg, #dbeafe 0%, #ffffff 100%)" : "#ffffff",
cursor: "pointer",
userSelect: "none",
fontWeight: 900,
color: active ? "#0b4aa2" : "#334155",
textAlign: "center",
}),

modalFoot: {
display: "flex",
gap: 8,
padding: 12,
borderTop: "1px solid #e5e7eb",
justifyContent: "flex-end",
background: "#fff",
} as React.CSSProperties,

btnDanger: {
height: 36,
padding: "0 12px",
borderRadius: 10,
border: "1px solid #fecaca",
background: "#fee2e2",
color: "#b91c1c",
fontWeight: 900,
cursor: "pointer",
} as React.CSSProperties,

btnPrimary: {
height: 36,
padding: "0 12px",
borderRadius: 10,
border: "1px solid #93c5fd",
background: "#1d4ed8",
color: "#fff",
fontWeight: 900,
cursor: "pointer",
} as React.CSSProperties,

btnSub: {
height: 36,
padding: "0 12px",
borderRadius: 10,
border: "1px solid #cbd5e1",
background: "#fff",

color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
} as React.CSSProperties,

page: {
padding: 12,
maxWidth: 1100,
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

monthRow: {
display: "flex",
alignItems: "center",
gap: 8,
justifyContent: "center",
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
width: wide ? 145 : 124,
padding: "0 4px",
} as React.CSSProperties,

summaryRow: {
display: "grid",
gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
gap: 8,
marginTop: 10,
} as React.CSSProperties,

summaryCardBtn: (active: boolean): React.CSSProperties => ({
borderRadius: 14,
padding: 10,
border: "1px solid " + (active ? "#93c5fd" : "#dbeafe"),
background: active
? "linear-gradient(180deg, #dbeafe 0%, #ffffff 100%)"
: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
cursor: "pointer",
userSelect: "none",
}),

summaryTitle: {
fontSize: cardTitleSize,
color: "#1e3a8a",
fontWeight: 900,
marginBottom: 6,
} as React.CSSProperties,

summaryValue: {
fontSize: cardValueSize,
fontWeight: 900,
textAlign: "center",
fontVariantNumeric: "tabular-nums",
} as React.CSSProperties,

summarySubValue: {
fontSize: cardSubValueSize,
color: "#64748b",
fontWeight: 900,
marginTop: 2,
textAlign: "center",
} as React.CSSProperties,

summarySubWrap: {
marginTop: 6,
textAlign: "center",
fontWeight: 900,
fontVariantNumeric: "tabular-nums",
lineHeight: 1.25,
} as React.CSSProperties,

summarySubLine: {
fontSize: subValueSize,
color: "#334155",
fontWeight: 900,
} as React.CSSProperties,

summarySubLabel: {
fontSize: subLabelSize,
color: "#64748b",
fontWeight: 900,
marginRight: 6,
} as React.CSSProperties,

grid2: {
display: "grid",
gridTemplateColumns: "1fr",
gap: 10,
marginTop: 10,
} as React.CSSProperties,

grid2Wide: {
gridTemplateColumns: "1.2fr 0.8fr",
} as React.CSSProperties,

sectionTitle: {
fontSize: 14,
fontWeight: 900,
color: "#0b4aa2",
marginBottom: 8,
} as React.CSSProperties,

barRow: {
display: "grid",
// ✅ 右端にアイコン専用列を用意（右端固定）
// ✅ 固定幅を減らしてバーを長くする
gridTemplateColumns: "60px minmax(0, 1fr) 108px 26px",
alignItems: "center",
gap: 6,
padding: "8px 0",
borderBottom: "1px dashed #e2e8f0",
} as React.CSSProperties,

// ✅ 右側（実績/目安）は2段だけ。右寄せにする
rightBox: {
display: "flex",
flexDirection: "column",
alignItems: "center",
justifyContent: "center",
textAlign: "center",
width: "100%",
fontVariantNumeric: "tabular-nums",
} as React.CSSProperties,

// ✅ アイコンは4列目（右端）に固定、右寄せ＆中央揃え
warnIcon: {
display: "flex",
justifyContent: "flex-end",
alignItems: "center",
fontSize: 12,
fontWeight: 900,
opacity:0.9,
height: "100%",
paddingRight: 2, // 右端にギリ寄せ
} as React.CSSProperties,



catName: {
fontSize: 12,
fontWeight: 900,
textAlign: "center",
} as React.CSSProperties,

barWrap: {
position: "relative",
height: 18,
background: "#f1f5f9",
borderRadius: 999,
overflow: "hidden",
border: "1px solid #e2e8f0",
cursor: "pointer",
} as React.CSSProperties,

barBudget: {
position: "absolute",
top: 0,
bottom: 0,
left: 0,
background: "#cbd5e1",
opacity: 0.55,
} as React.CSSProperties,

barActualWithin: {
position: "absolute",
top: 0,
bottom: 0,
left: 0,
opacity: 0.92,
borderTopLeftRadius: 999,
borderBottomLeftRadius: 999,
borderTopRightRadius: 0,
borderBottomRightRadius: 0,
} as React.CSSProperties,

barOver: {
position: "absolute",
top: 0,
bottom: 0,
opacity: 0.92,
background: "#dc2626",
borderTopLeftRadius: 0,
borderBottomLeftRadius: 0,
borderTopRightRadius: 999,
borderBottomRightRadius: 999,
} as React.CSSProperties,

guidelineMarker: {
position: "absolute",
top: -2,
bottom: -2,
width: 0,
borderLeft: "2px dotted #94a3b8",
} as React.CSSProperties,


rightActual: {
fontSize: 12,
fontWeight: 900,
textAlign: "center",
color: "#0f172a",
lineHeight: 1.1,
} as React.CSSProperties,

rightGuide: {
marginTop: 3,
fontSize: 11,
fontWeight: 900,
textAlign: "center",
lineHeight: 1.1,
} as React.CSSProperties,

drillBox: {
marginTop: 10,
border: "1px solid #e2e8f0",
borderRadius: 14,
padding: 10,
background: "#fbfdff",
} as React.CSSProperties,

drillTop: {
display: "flex",
justifyContent: "space-between",
alignItems: "center",
gap: 8,
} as React.CSSProperties,

drillTitle: {
fontSize: 13,
fontWeight: 900,
color: "#0b4aa2",
} as React.CSSProperties,

closeBtn: {
height: 32,
padding: "0 10px",
borderRadius: 10,
border: "1px solid #cbd5e1",
background: "#fff",
fontWeight: 900,
cursor: "pointer",
whiteSpace: "nowrap",
} as React.CSSProperties,

drillHeaderLine: {
marginTop: 6,
fontSize: 12,
fontWeight: 900,
display: "flex",
gap: 10,
alignItems: "center",
flexWrap: "wrap",
} as React.CSSProperties,

subRow: {
display: "grid",
gridTemplateColumns: "1fr 110px 90px 28px", // ← 4列目追加
gap: 8,
padding: "7px 0",
borderBottom: "1px dashed #e2e8f0",
alignItems: "center",
} as React.CSSProperties,

subWarnIcon: {
display: "flex",
justifyContent: "flex-end",
alignItems: "center",
fontSize: 14,
paddingRight: 2,
} as React.CSSProperties,

subName: {
fontSize: 12,
fontWeight: 900,
color: "#0f172a",
overflow: "hidden",
textOverflow: "ellipsis",
whiteSpace: "nowrap",
} as React.CSSProperties,

subActual: {
textAlign: "center",
fontSize: 12,
fontWeight: 900,
fontVariantNumeric: "tabular-nums",
} as React.CSSProperties,

subGuide: {
textAlign: "center",
fontSize: 12,
fontWeight: 900,
fontVariantNumeric: "tabular-nums",
} as React.CSSProperties,

toggleRow: { display: "flex", gap: 8, marginBottom: 8 } as React.CSSProperties,

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
}),

note: { fontSize: 12, color: "#334155", fontWeight: 800 } as React.CSSProperties,

foldBtn: (open: boolean): React.CSSProperties => ({
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid " + (open ? "#93c5fd" : "#cbd5e1"),
background: open ? "#dbeafe" : "#ffffff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
fontSize: 12,
}),

// ✅ 折れ線上ナビ（追加）
lineNavRow: {
display: "flex",
alignItems: "center",
justifyContent: "center",
gap: 8,
marginBottom: 8,
} as React.CSSProperties,

// ✅ モーダル（追加）
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
width: "min(980px, 100%)",
maxHeight: "85vh",
background: "#fff",
borderRadius: 14,
border: "1px solid #e5e7eb",
boxShadow: "0 20px 60px rgba(15,23,42,0.25)",
overflow: "hidden",
display: "flex",
flexDirection: "column",
} as React.CSSProperties,
filterGrid: {
marginTop: 8,
display: "grid",
gridTemplateColumns: wide ? "1fr 1fr" : "1fr",
gap: 8,
} as React.CSSProperties,

filterRow: {
display: "grid",
gridTemplateColumns: "90px 1fr",
gap: 8,
alignItems: "center",
} as React.CSSProperties,

filterLabel: {
fontSize: 11,
color: "#64748b",
fontWeight: 900,
} as React.CSSProperties,

inputBase: {
width: "100%",
height: 32,
borderRadius: 10,
border: "1px solid #cbd5e1",
padding: "0 10px",
fontSize: 12,
fontWeight: 900,
outline: "none",
} as React.CSSProperties,

amountRange: {
display: "grid",
gridTemplateColumns: "1fr 18px 1fr",
gap: 6,
alignItems: "center",
} as React.CSSProperties,

sortRow: {
marginTop: 8,
display: "grid",
gridTemplateColumns: wide ? "1fr 1fr" : "1fr",
gap: 8,
} as React.CSSProperties,
modalHeader: {
padding: 10,
borderBottom: "1px solid #e5e7eb",
background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
} as React.CSSProperties,
modalHeaderTop: {
display: "flex",
justifyContent: "space-between",
alignItems: "center",
gap: 8,
} as React.CSSProperties,
modalBodyScroll: {
padding: 10,
overflow: "auto",
} as React.CSSProperties,
tinyBtn: {
height: 30,
padding: "0 10px",
borderRadius: 999,
border: "1px solid #cbd5e1",
background: "#fff",
fontWeight: 900,
cursor: "pointer",
fontSize: 9,
} as React.CSSProperties,
tableHeader: {
display: "grid",
gridTemplateColumns: "1fr 1fr 110px 80px",
gap: 8,
padding: "6px 0",
borderBottom: "1px solid #e5e7eb",
position: "sticky",
top: 0,
background: "#fff",
zIndex: 2,
fontWeight: 900,
color: "#64748b",
textAlign: "center",
} as React.CSSProperties,

headerBtn: {
all: "unset",
cursor: "pointer",
textAlign: "center",
fontWeight: 900,
color: "#0b4aa2",
padding: "6px 0",
} as React.CSSProperties,

pickerOverlay: {
position: "fixed",
inset: 0,
background: "rgba(15,23,42,0.55)",
display: "flex",
justifyContent: "center",
alignItems: "center",
padding: 12,
zIndex: 60, // detail modal(50)より上
} as React.CSSProperties,

pickerCard: {
width: "min(420px, 100%)",
maxHeight: "70vh",
background: "#fff",
borderRadius: 14,
border: "1px solid #e5e7eb",
boxShadow: "0 20px 60px rgba(15,23,42,0.25)",
overflow: "hidden",
display: "flex",
flexDirection: "column",
} as React.CSSProperties,

pickerHeader: {
padding: 10,
borderBottom: "1px solid #e5e7eb",
background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
fontWeight: 900,
color: "#0b4aa2",
} as React.CSSProperties,

pickerList: {
overflow: "auto",
} as React.CSSProperties,

pickerItem: {
padding: "12px 12px",
borderBottom: "1px dashed #e2e8f0",
cursor: "pointer",
fontWeight: 900,
color: "#0f172a",
} as React.CSSProperties,

tableRow: {
display: "grid",
gridTemplateColumns: "1fr 1fr 110px 80px",
gap: 8,
padding: "7px 0",
borderBottom: "1px dashed #e2e8f0",
alignItems: "center",
textAlign: "center",
fontWeight: 900,
} as React.CSSProperties,
};
}, [wide, guideFull, showCollapsedCats, totalActual, totalBudgetAll]);

const foldLabel = showCollapsedCats ? "－" : "＋";

// ====== 期間表示時：折れ線タイトル/ボタン文言 ======
const lineTitlePrefix = rangeMode ? "月別推移" : "日別推移";
const lineBtnLeftLabel = rangeMode ? "月別" : "日別";

// ====== ドリル開始（棒グラフの「行全体」をタップ判定） ======
const openDrill = (category: string) => {
setDrillCat((prev) => {
const next = prev === category ? null : category;

// ドリル（内訳）を開く/閉じる
setDrillSub(null);

// 下部一覧も同期（カテゴリが閉じたら下部も閉じる）
if (next) {
setBottomCat(next);
setBottomSub(null);
setBottomOpen(true);
} else {
setBottomOpen(false);
setBottomCat(null);
setBottomSub(null);
}

return next;
});
};


return (
<div style={styles.page}>
{/* 上部 */}
<div style={{ ...styles.card, padding: 10 }}>
<div style={styles.monthRow}>
{!rangeMode ? (
<>
<button style={styles.squareBtn} onClick={() => moveMonth(-1)} aria-label="prev">
←
</button>
<input
type="month"
value={month}
onChange={(e) => setMonth(e.target.value)}
style={styles.monthInput}
aria-label="month"
/>
<button style={styles.squareBtn} onClick={() => moveMonth(1)} aria-label="next">
→
</button>
</>
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
</div>

{/* 上部ボタン */}
<div style={{ display: "flex", gap: 8, marginTop: 10 }}>
<button
style={styles.toggleBtn(rangeMode)}
onClick={() => {
setRangeMode((v) => {
const next = !v;
if (!v && next) {
setRangeStart(month);
setRangeEnd(month);
}
setDrillCat(null);
setDrillSub(null);
return next;
});
}}
>
期間
</button>

<button style={styles.toggleBtn(guideFull)} onClick={() => setGuideFull((v) => !v)}>
目安
</button><button
style={styles.toggleBtn(false)}
onClick={forceReload}
>
↻
</button>
<button style={styles.toggleBtn(false)} onClick={() => goToExpense(true)}>
登録
</button>

</div>

{/* summary */}
<div style={styles.summaryRow}>
{/* 支出合計 */}
<div style={styles.summaryCardBtn(scope === "total")} onClick={() => setScope("total")} role="button">
<div style={styles.summaryTitle}>支出合計</div>
<div style={styles.summaryValue}>{fmtYen(totalActual)}</div>

<div style={styles.summarySubWrap}>
<div style={styles.summarySubLine}>{fmtYen(totalBudgetAll)}</div>
<div style={{ ...styles.summarySubLine, color: totalDiffInfo.color }}>{totalDiffInfo.text}</div>
</div>
</div>

{/* 将哉立替 */}
<div
style={{
...styles.summaryCardBtn(scope === "shoya"),
border: shoyaLate ? "2px solid #dc2626" : (styles.summaryCardBtn(scope === "shoya") as any).border,
background: shoyaLate ? "#fff5f5" : (styles.summaryCardBtn(scope === "shoya") as any).background,
}}
onClick={() => setScope("shoya")}
role="button"
>
<div style={styles.summaryTitle}>将哉立替</div>
<div style={styles.summaryValue}>{fmtYen(shoyaPaid)}</div>
<div style={styles.summarySubValue}>（ {fmtYen(shoyaEntertainment)}）</div>
{/* ✅ 娯楽費 予算差 */}
<div style={{ ...styles.summarySubValue, color: shoyaEntDiffInfo.color }}>
（ {shoyaEntDiffInfo.text}）
</div>
</div>

{/* 未有立替 */}
<div
style={{
...styles.summaryCardBtn(scope === "miu"),
border: miuLate ? "2px solid #dc2626" : (styles.summaryCardBtn(scope === "miu") as any).border,
background: miuLate ? "#fff5f5" : (styles.summaryCardBtn(scope === "miu") as any).background,
}}
onClick={() => setScope("miu")}
role="button"
>
<div style={styles.summaryTitle}>未有立替</div>
<div style={{ ...styles.summaryValue, color: miuColor }}>{fmtYen(miuPaid)}</div>
<div style={styles.summarySubValue}>（ {fmtYen(miuEntertainment)}）</div>
{/* ✅ 娯楽費 予算差 */}
<div style={{ ...styles.summarySubValue, color: miuEntDiffInfo.color }}>
（ {miuEntDiffInfo.text}）
</div>
</div>
</div>
</div>

{/* Charts */}
<div style={{ ...styles.grid2, ...(wide ? styles.grid2Wide : {}) }}>
{/* Bar + drill */}
<div style={styles.card}>
<div style={styles.sectionTitle}>{drillCat ? "カテゴリ内訳" : "カテゴリ別"}</div>

<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
<button style={styles.foldBtn(showCollapsedCats)} onClick={() => setShowCollapsedCats((v) => !v)}>
{foldLabel}
</button>
</div>

{!drillCat &&
categoryAggVisible.map((x) => {
const actual = Number(x.actual) || 0;
const budget = Number(x.budget) || 0;
// ========= 追加：カテゴリ警告判定（落ちない版） =========
const overBudget = budget > 0 && actual > budget; // ⛔️

let hasSubOverGuide = false; // ⚠️（カテゴリは超過してないが、内訳のどれかが目安超過）

// ※カテゴリが予算超過してる時は⚠️不要（⛔️のみ）
if (!overBudget) {
const subMap = (subBudgets?.[x.category] ?? {}) as Record<string, number>;

// 内訳実績（娯楽費/自由入力含め、仕様に合わせて集計）
const actualSubs = subAggForCategorySafe(x.category);

for (const s of actualSubs) {
const sb = Number(subMap?.[s.subCategory] ?? 0);

// ✅ 内訳に予算が無いなら判定しない（あなたの要件）
if (!sb || sb <= 0) continue;

// ✅ “目安” は 目安ボタン(guideFull)と連動（guideFactor使用）
const guidelineSub = rangeMode
? guidelineTotalForSubInRange(x.category, s.subCategory)
: subGuidelineDiffInfo({
month,
subBudget: sb,
subActual: 0, // guideline だけ欲しいので actual は0でOK
guideFactor,
}).guideline;

if (Number(s.actual) > Number(guidelineSub)) {
hasSubOverGuide = true;
break;
}
}
}

const baseline = budget > 0 ? Math.max(budget, actual) : Math.max(actual, 1);
const budgetW = budget > 0 ? (budget / baseline) * 100 : 0;

const over = actual > budget ? actual - budget : 0;
const within = budget > 0 ? Math.min(actual, budget) : 0;

const withinW = (within / baseline) * 100;
const overW = over > 0 ? (over / baseline) * 100 : 0;

const guideline = rangeMode
? guidelineTotalForCategoryInRange(x.category)
: categoryGuidelineValue(budget);

const guidelineW = baseline > 0 ? (clamp(guideline, 0, baseline) / baseline) * 100 : 0;
const gInfo = diffStyleAndText(guideline - actual);

// ✅ 行全体をタップ判定（カテゴリ名/バー/金額すべて）
return (
<div
key={x.category}
style={{ ...styles.barRow, cursor: "pointer" }}
onClick={() => openDrill(x.category)}
role="button"
>
<div style={styles.catName}>{x.category}</div>

<div style={styles.barWrap}>
<div style={{ ...styles.barBudget, width: `${budgetW}%` }} />
<div style={{ ...styles.guidelineMarker, left: `${guidelineW}%` }} />
<div
style={{
...styles.barActualWithin,
width: `${withinW}%`,
background: colorOfCategory(x.category),
}}
/>
{over > 0 && (
<div
style={{
...styles.barOver,
left: `${withinW}%`,
width: `${clamp(overW, 0, 100 - withinW)}%`,
}}
/>
)}
</div>

<div style={styles.rightBox}>
<div
style={{
...styles.rightActual,
color: (budget === 0 && actual > 0) || actual > budget ? "#dc2626" : "#0f172a",
}}
>
{fmtYen(actual)}
</div>

<div style={{ ...styles.rightGuide, color: gInfo.color }}>
{gInfo.text}
</div>
</div>

{/* ✅ 4列目：アイコンを右端固定 */}
<div style={styles.warnIcon}>
{overBudget ? "⛔️" : hasSubOverGuide ? "⚠️" : ""}
</div>

</div>
);
})}

{/* Drilldown */}
{drillCat && (
<div style={styles.drillBox}>
<div style={styles.drillTop}>
<div style={styles.drillTitle}>内訳：{drillCat}</div>
<button style={styles.closeBtn} onClick={() => { setDrillCat(null); setDrillSub(null); }}>
閉じる
</button>
</div>

{drillHeader && (
<div style={{ ...styles.drillHeaderLine, gap: 14 }}>
<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 11, color: "#64748b", fontWeight: 900 }}>合計</div>
<div style={{ fontWeight: 900, color: drillHeader.actualColor }}>
{fmtYen(drillHeader.actual)}
</div>
</div>

<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 11, color: "#64748b", fontWeight: 900 }}>目安</div>
<div style={{ fontWeight: 900 }}>{fmtYen(drillHeader.guideline)}</div>
<div style={{ fontSize: 10, fontWeight: 900, color: drillHeader.guideDiffInfo.color }}>
{drillHeader.guideDiffInfo.text}
</div>
</div>

<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 11, color: "#64748b", fontWeight: 900 }}>予算</div>
<div style={{ fontWeight: 900 }}>{fmtYen(drillHeader.budget)}</div>
<div style={{ fontSize: 10, fontWeight: 900, color: drillHeader.budgetDiffInfo.color }}>
{drillHeader.budgetDiffInfo.text}
</div>
</div>
</div>
)}

<div style={{ marginTop: 10 }}>
{subAgg.map((s) => {
const subBudget =
drillCat === "娯楽費"
? Number(subBudgets?.["娯楽費"]?.[s.subCategory] ?? 0)
: Number(subBudgets?.[drillCat]?.[s.subCategory] ?? 0);

const subActual = Number(s.actual) || 0;

const info = (() => {
if (rangeMode) {
const g = guidelineTotalForSubInRange(drillCat, s.subCategory);
const diff = Math.round(g - subActual);
const dInfo = diffStyleAndText(diff);
return { guideline: g, diff, color: dInfo.color, text: dInfo.text };
}

// 単月：従来（0予算は¥0固定）
return subGuidelineDiffInfo({ month, subBudget, subActual, guideFactor });
})();
const subOverBudget = subBudget > 0 && subActual > subBudget;
const subOverGuide = subBudget > 0 && !subOverBudget && subActual > info.guideline;
const subIcon = subOverBudget ? "⛔️" : subOverGuide ? "⚠️" : "";
return (
<div
key={s.subCategory}
style={{
...styles.subRow,
cursor: "pointer",
background: drillSub === s.subCategory ? "#eff6ff" : "transparent",
borderRadius: 10,
paddingLeft: 6,
paddingRight: 6,
}}
onClick={() => {
const next = drillSub === s.subCategory ? null : s.subCategory;
setDrillSub(next);

// 下部一覧にも反映
setBottomCat(drillCat);
setBottomSub(next);
setBottomOpen(true);
}}
role="button"
>
<div style={{ ...styles.subName, color: drillSub === s.subCategory ? "#0b4aa2" : "#0f172a" }}>
{s.subCategory}
</div>

<div style={styles.subActual}>{fmtYen(s.actual)}</div>

<div
style={{
...styles.subGuide,
color: subBudget <= 0 ? "#0f172a" : info.color,
}}
>
{subBudget <= 0 ? "-" : info.text}
</div>

{/* ✅ 4列目：右端アイコン */}
<div style={styles.subWarnIcon}>{subIcon}</div>
</div>
);
})}
</div>
</div>
)}
</div>

{/* Line */}
<div style={styles.card}>
<div style={styles.sectionTitle}>
{lineTitlePrefix}（{lineFocus.sub ? lineFocus.sub : lineFocus.cat ? lineFocus.cat : "全体"}）
</div>

{/* ✅ 折れ線上ナビ：← 日付(上部と連動) → */}
<div style={styles.lineNavRow}>
<button style={styles.squareBtn} onClick={() => moveRange(-1)} aria-label="line-prev">
←
</button>

{!rangeMode ? (
<input
type="month"
value={month}
onChange={(e) => setMonth(e.target.value)}
style={styles.monthInput}
aria-label="line-month"
/>
) : (
<>
<input
type="month"
value={rangeStart}
onChange={(e) => setRangeStart(e.target.value)}
style={styles.monthInput}
aria-label="line-range-start"
/>
<span style={{ fontWeight: 900, color: "#64748b" }}>〜</span>
<input
type="month"
value={rangeEnd}
onChange={(e) => setRangeEnd(e.target.value)}
style={styles.monthInput}
aria-label="line-range-end"
/>
</>
)}

<button style={styles.squareBtn} onClick={() => moveRange(1)} aria-label="line-next">
→
</button>
</div>

<div style={styles.toggleRow}>
<button style={styles.toggleBtn(lineMode === "daily")} onClick={() => setLineMode("daily")}>
{lineBtnLeftLabel}
</button>
<button style={styles.toggleBtn(lineMode === "cumulative")} onClick={() => setLineMode("cumulative")}>
累計
</button>
</div>

{loading ? (
<div style={{ ...styles.note, textAlign: "center" }}>読み込み中…</div>
) : (
<KakeiboLineChart
month={rangeMode ? `${rangeStart}~${rangeEnd}` : month}
data={rangeMode ? monthlySeries : dailySeries}
guideline={rangeMode ? monthlyGuidelineSeries : guidelineSeries}
forecast={forecast}
maxValue={lineMax}
minValue={lineMin}
showDots={true}
mode={lineMode}
onPointClick={(key, isMonthly) => openDetailByKey(key, isMonthly)}
/>

)}
</div>
</div>
{bottomGuideCard && (
<div style={{ ...styles.card, marginTop: 10, padding: 12 }}>
<div style={{ fontSize: 13, fontWeight: 900, color: "#0b4aa2" }}>
{bottomGuideCard.dateLabel}
</div>

<div
style={{
display: "grid",
gridTemplateColumns: "1fr 1fr 1fr",
gap: 8,
marginTop: 10,
textAlign: "center",
fontWeight: 900,
fontVariantNumeric: "tabular-nums",
}}
>
<div
style={{
border: "1px solid #e5e7eb",
borderRadius: 14,
background: "#ffffff",
padding: "10px 8px",
boxShadow: "0 6px 16px rgba(15,23,42,0.06)",
}}
>
<div style={{ fontSize: 11, color: "#64748b" }}>目安</div>
<div style={{ marginTop: 4, fontSize: 14, color: "#0f172a" }}>
{fmtYen(bottomGuideCard.guide)}
</div>
</div>

<div
style={{
border: "1px solid #e5e7eb",
borderRadius: 14,
background: "#ffffff",
padding: "10px 8px",
boxShadow: "0 6px 16px rgba(15,23,42,0.06)",
}}
>
<div style={{ fontSize: 11, color: "#64748b" }}>支出</div>
<div style={{ marginTop: 4, fontSize: 14, color: "#0f172a" }}>
{fmtYen(bottomGuideCard.actual)}
</div>
</div>

<div
style={{
border: "1px solid #e5e7eb",
borderRadius: 14,
background: "#ffffff",
padding: "10px 8px",
boxShadow: "0 6px 16px rgba(15,23,42,0.06)",
}}
>
<div style={{ fontSize: 11, color: "#64748b" }}>
{bottomGuideCard.deltaLabel}
</div>
<div
style={{
marginTop: 4,
fontSize: 14,
color: bottomGuideCard.deltaColor,
}}
>
{bottomGuideCard.deltaText}
</div>
</div>
</div>
</div>
)}
{/* ✅ 下部：期間全体のカテゴリ明細一覧 */}
{bottomOpen && bottomCat && (
<div style={{ ...styles.card, marginTop: 10 }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
<div
style={{
fontSize: 9,
fontWeight: 800,
color: "#0b4aa2",
display: "flex",
alignItems: "center",
gap: 4,
flexWrap: "nowrap",
}}
>
<span>{rangeMode ? `${rangeStart}〜${rangeEnd}` : month}</span>
<span style={{ color: "#64748b", fontWeight: 700 }}>
/ {bottomCat}
{bottomSub ? `（${bottomSub}）` : ""}
</span>
</div>

<div
style={{
display: "flex",
gap: 4,
alignItems: "center",
flexWrap: "nowrap", // ← 折り返し禁止
}}
>
<button
style={styles.tinyBtn}
onClick={() =>
setBottomSort((p) => ({
key: "date",
dir: p.key === "date" && p.dir === "asc" ? "desc" : "asc",
}))
}
>
日付⇅
</button>
<button
style={styles.tinyBtn}
onClick={() =>
setBottomSort((p) => ({
key: "amount",
dir: p.key === "amount" && p.dir === "asc" ? "desc" : "asc",
}))
}
>
金額⇅
</button>
<button
style={styles.tinyBtn}
onClick={() =>
setBottomFilter({ subCategory: "", registrant: "", amountMin: "", amountMax: "", dateWeekendOnly: false })
}
>
解除
</button>

<button style={styles.closeBtn} onClick={() => setBottomOpen(false)}>
閉じる
</button>
</div>
</div>

<div style={{ marginTop: 8, fontWeight: 900, color: "#334155" }}>
件数 {bottomRowsFiltered.length} / 合計 {fmtYen(bottomRowsFiltered.reduce((a, b) => a + (Number(b.amount) || 0), 0))}
</div>

<div style={{ marginTop: 10 }}>
{bottomRowsFiltered.length === 0 ? (
<div style={{ fontWeight: 900, color: "#64748b", textAlign: "center", padding: 18 }}>
該当明細なし
</div>
) : (
<>
<div
style={{
...styles.tableHeader,
gridTemplateColumns: "92px 1fr 96px 72px",
fontSize: 11,
}}
>
<button
style={{ ...styles.headerBtn, color: "#64748b", whiteSpace: "nowrap" }}
onClick={() => openBottomPicker("date")}
>
日付
</button>
<button
style={{ ...styles.headerBtn, color: "#64748b", whiteSpace: "nowrap" }}
onClick={() => openBottomPicker("subCategory")}
>
内訳
</button>
<button
style={{ ...styles.headerBtn, color: "#64748b", whiteSpace: "nowrap" }}
onClick={() => openBottomPicker("amount")}
>
金額
</button>
<button
style={{ ...styles.headerBtn, color: "#64748b", whiteSpace: "nowrap" }}
onClick={() => openBottomPicker("registrant")}
>
登録者
</button>
</div>


{bottomRowsFiltered.map((r) => {
const d = fmtMdDow(r.date);
return (
<div
key={r.id}
style={{
...styles.tableRow,
gridTemplateColumns: "92px 1fr 96px 72px",
cursor: "pointer",
fontSize: 11,
}}
onClick={() => openEdit(r)}
role="button"
>
{/* ✅ 土日は赤 */}
<div style={{ color: d.isWeekend ? "#dc2626" : "#0f172a", whiteSpace: "nowrap" }}>
{d.text}
</div>

{/* ✅ 内訳は省略表示で必ず出す */}
<div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#0f172a" }}>
{r.subCategory}
</div>

<div style={{ whiteSpace: "nowrap" }}>{fmtYen(r.amount)}</div>
<div style={{ whiteSpace: "nowrap", color: "#0f172a" }}>{r.registrant}</div>
</div>
);
})}
</>
)}
</div>
</div>
)}

{/* ✅ 明細モーダル */}
{detailOpen && (
<div style={styles.modalOverlay} onClick={() => setDetailOpen(false)} role="button">
<div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
<div style={styles.modalHeader}>
<div style={styles.modalHeaderTop}>
<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
<button
style={styles.tinyBtn}
onClick={() => {
// 前日/前月
if (detailModeMonthly) {
const idx = monthsActive.indexOf(detailKey);
const prev = idx > 0 ? monthsActive[idx - 1] : undefined;
if (prev) setDetailKey(prev);
} else {
const idx = days.indexOf(detailKey);
const prev = idx > 0 ? days[idx - 1] : undefined;
if (prev) setDetailKey(prev);
}

}}
>
←
</button>

{/* 日付ホイール（単月は日、期間は月） */}
{detailModeMonthly ? (
<select
value={detailKey}
onChange={(e) => setDetailKey(e.target.value)}
style={{ ...styles.monthInput, width: 160 }}
>
{monthsActive.map((ym) => (
<option key={ym} value={ym}>
{ym}
</option>
))}
</select>
) : (
<select
value={detailKey}
onChange={(e) => setDetailKey(e.target.value)}
style={{
...styles.monthInput,
width: 160,
// ✅ select本体の色（選択中表示）を土日は薄赤に
color: fmtMdDow(detailKey).isWeekend ? "#fca5a5" : "#0b4aa2",
}}
>
{days.map((d) => {
const info = fmtMdDow(d);
return (
<option
key={d}
value={d}
// ✅ option側の色（効く環境だけ反映）
style={{ color: info.isWeekend ? "#fca5a5" : "#0b4aa2" }}
>
{info.text}
</option>
);
})}
</select>
)}

<button
style={styles.tinyBtn}
onClick={() => {
// 翌日/翌月
if (detailModeMonthly) {
const idx = monthsActive.indexOf(detailKey);
const next =
idx >= 0 && idx < monthsActive.length - 1
? monthsActive[idx + 1]
: undefined;
if (next) setDetailKey(next);
} else {
const idx = days.indexOf(detailKey);
const next =
idx >= 0 && idx < days.length - 1
? days[idx + 1]
: undefined;
if (next) setDetailKey(next);
}
}}
>
→
</button>
</div>

<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
{(detailFilter.category ||
detailFilter.subCategory ||
detailFilter.registrant ||
detailFilter.amountMin ||
detailFilter.amountMax) && (
<button style={styles.tinyBtn} onClick={() => setDetailFilter(EMPTY_DETAIL_FILTER)}
>
解除
</button>
)}
<button style={styles.closeBtn} onClick={() => setDetailOpen(false)}>
✖︎
</button>
</div>
</div>

<div style={{ marginTop: 6, fontWeight: 900, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
<div
style={{
color: detailModeMonthly
? "#0b4aa2"
: fmtMdDow(detailKey).isWeekend
? "#f38484" // ✅ 土日：薄い赤
: "#0b4aa2",
}}
>
{detailModeMonthly ? `${detailKey}` : fmtMdDow(detailKey).text}
</div>

<div style={{ fontWeight: 900 }}>合計 {fmtYen(detailTotal)}</div>

</div>

{/* カテゴリ別合計（0は非表示） */}
<div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8 }}>
{detailCategoryTotals.length === 0 ? (
<div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>（カテゴリ合計なし）</div>
) : (
detailCategoryTotals.map((x) => (
<div
key={x.category}
style={{
fontSize: 12,
fontWeight: 900,
color: "#334155",
padding: "4px 10px",
borderRadius: 999,
border: "1px solid #e2e8f0",
background: "#fff",
}}
>
{x.category} {fmtYen(x.total)}
</div>
))
)}
</div>
</div>

<div style={styles.modalBody}>
{detailRows.length === 0 ? (
<div style={{ fontWeight: 900, color: "#64748b", textAlign: "center", padding: 18 }}>
金額0円 / 登録明細なし
</div>
) : (
<>
<div style={styles.tableHeader}>
<button style={styles.headerBtn} onClick={() => openPicker("category")}>カテゴリ</button>
<button style={styles.headerBtn} onClick={() => openPicker("subCategory")}>内訳</button>
<button style={styles.headerBtn} onClick={() => openPicker("amount")}>金額</button>
<button style={styles.headerBtn} onClick={() => openPicker("registrant")}>登録者</button>
</div>

{detailRows.map((r, idx) => (
<div
key={r.id || idx}
style={{ ...styles.tableRow, cursor: "pointer" }}
onClick={() => openEdit(r)}
role="button"
>
<div style={{ color: "#0f172a" }}>{r.category}</div>
<div style={{ color: "#0f172a" }}>{r.subCategory}</div>
<div>{fmtYen(r.amount)}</div>
<div style={{ color: "#0f172a" }}>{r.registrant}</div>
</div>
))}

</>
)}
</div>
</div>
</div>
)}

{/* ===== 支出ページと同じ 編集モーダル ===== */}
{editOpen && (
<div style={styles.overlay} onClick={closeEdit} role="dialog" aria-modal="true">
<div style={styles.modal} onClick={(e) => e.stopPropagation()}>
<div style={styles.modalHead}>
<div style={styles.modalTitle}>明細の編集</div>
<button style={styles.btnSub} onClick={closeEdit}>閉じる</button>
</div>

<div style={styles.modalBody}>
{/* 登録者カード */}
<div>
<div style={styles.label}>登録者（必須）</div>
<div style={styles.regCardRow}>
{(["将哉", "未有"] as const).map((p) => {
const exists = REGISTRANTS.includes(p);
if (!exists) return <div key={p} />;
const active = registrant === p;
return (
<div
key={p}
style={styles.regCard(active)}
onClick={() => {
setRegistrant(p);
if (!touched.registrant) setTouched((t) => ({ ...t, registrant: true }));
}}
role="button"
>
{p}
</div>
);
})}
</div>
{touched.registrant && missing.registrant && (
<div style={{ marginTop: 6, color: "#dc2626", fontWeight: 900, fontSize: 12 }}>
登録者を選択してください
</div>
)}
</div>

<div style={styles.grid}>
{/* date */}
<div>
<div style={styles.label}>日付（必須）</div>
<input
type="date"
value={date}
onChange={(e) => setDate(e.target.value)}
onBlur={() => setTouched((t) => ({ ...t, date: true }))}
style={{ ...styles.input, ...(touched.date && missing.date ? styles.errorBorder : {}) }}
/>
</div>

{/* source */}
<div>
<div style={styles.label}>支出元（必須）</div>
<select
value={source}
onChange={(e) => setSource(e.target.value)}
onBlur={() => setTouched((t) => ({ ...t, source: true }))}
style={{ ...styles.input, ...(touched.source && missing.source ? styles.errorBorder : {}) }}
>
<option value="">選択</option>
{EXPENSE_SOURCES.map((s) => (
<option key={s} value={s}>{s}</option>
))}
</select>
</div>

{/* amount */}
<div>
<div style={styles.label}>金額（必須）</div>
<div style={styles.amountRow}>
<input
inputMode="numeric"
placeholder="例: 12,000"
value={amountText}
onChange={(e) => onChangeAmount(e.target.value)}
onBlur={() => setTouched((t) => ({ ...t, amount: true }))}
style={{
...styles.input,
textAlign: "center",
fontWeight: 900,
fontVariantNumeric: "tabular-nums",
...(touched.amount && missing.amount ? styles.errorBorder : {}),
}}
/>
<button type="button" onClick={toggleMinus} style={styles.minusBtn(isMinus)} aria-label="minus">
−
</button>
</div>
<div style={{ marginTop: 4, fontSize: 12, fontWeight: 900, textAlign: "center", color: "#334155" }}>
{Number.isFinite(amountValue) ? fmtYen(amountValue) : "¥0"}
</div>
</div>

{/* category */}
<div>
<div style={styles.label}>カテゴリ（必須）</div>
<select
value={category}
onChange={(e) => {
const v = e.target.value;
setCategory(v);
setSubCategorySelect("");
}}
onBlur={() => setTouched((t) => ({ ...t, category: true }))}
style={{ ...styles.input, ...(touched.category && missing.category ? styles.errorBorder : {}) }}
>
<option value="">選択</option>
{CATEGORIES.map((c) => (
<option key={c} value={c}>{c}</option>
))}
</select>
</div>

{/* subCategory */}
<div>
<div style={styles.label}>カテゴリ内訳（必須）</div>
<select
value={subCategorySelect}
onChange={(e) => {
const v = e.target.value;
setSubCategorySelect(v);
if (v !== FREE_LABEL) setMemo("");
}}
onBlur={() => setTouched((t) => ({ ...t, subCategory: true }))}
disabled={!category}
style={{
...styles.input,
...(touched.subCategory && missing.subCategory ? styles.errorBorder : {}),
opacity: category ? 1 : 0.6,
}}
>
<option value="">{category ? "選択" : "カテゴリを先に選択"}</option>
{(() => {
if (!category || !isCategory(category)) return [];
const list = SUBCATEGORIES[category] ?? [];
const withoutFree = list.filter((s) => s !== FREE_LABEL);
return [...withoutFree, FREE_LABEL];
})().map((s) => (
<option key={s} value={s}>{s}</option>
))}
</select>

{subCategorySelect === FREE_LABEL && (
<div style={{ marginTop: 8 }}>
<div style={styles.label}>自由入力（必須）</div>
<input
value={memo}
onChange={(e) => setMemo(e.target.value)}
onBlur={() => setTouched((t) => ({ ...t, subCategory: true }))}
placeholder="例: コストコ / 交際費 / 雑費 など"
style={{ ...styles.input, ...(touched.subCategory && missing.subCategory ? styles.errorBorder : {}) }}
/>
</div>
)}
</div>

{/* memo optional */}
{subCategorySelect !== FREE_LABEL && (
<div style={{ gridColumn: wide ? "1 / -1" : undefined }}>
<div style={styles.label}>メモ（任意）</div>
<input
value={memo}
onChange={(e) => setMemo(e.target.value)}
style={{ ...styles.input, height: 40 }}
placeholder="任意"
/>
</div>
)}
</div>
</div>

<div style={styles.modalFoot}>
<button style={styles.btnDanger} onClick={onDeleteEdit}>削除</button>
<button style={styles.btnSub} onClick={closeEdit}>キャンセル</button>
<button style={styles.btnPrimary} onClick={onSaveEdit}>更新</button>
</div>
</div>
</div>
)}

{/* ✅ ヘッダー選択モーダル */}
{pickerOpen && (
<div style={styles.pickerOverlay} onClick={closePicker} role="button">
<div style={styles.pickerCard} onClick={(e) => e.stopPropagation()}>
<div style={styles.pickerHeader}>
{pickerKind === "category"
? "カテゴリを選択"
: pickerKind === "subCategory"
? "内訳を選択"
: pickerKind === "registrant"
? "登録者を選択"
: "金額範囲を選択"}
</div>

<div style={styles.pickerList}>
{pickerOptions.map((opt, idx) => (
<div
key={idx}
style={styles.pickerItem}
onClick={() => applyPickerValue(opt.value)}
role="button"
>
{opt.label}
</div>
))}
</div>

<div style={{ padding: 10 }}>
<button style={styles.closeBtn} onClick={closePicker}>閉じる</button>
</div>
</div>
</div>
)}
{bottomPickerOpen && (
<div style={styles.pickerOverlay} onClick={closeBottomPicker} role="button">
<div style={styles.pickerCard} onClick={(e) => e.stopPropagation()}>
<div style={styles.pickerHeader}>
{bottomPickerKind === "subCategory"
? "内訳で絞り込み"
: bottomPickerKind === "registrant"
? "登録者で絞り込み"
: bottomPickerKind === "amount"
? "金額範囲で絞り込み"
: "選択"}
</div>

<div style={styles.pickerList}>
{bottomPickerOptions.map((opt, idx) => (
<div
key={idx}
style={styles.pickerItem}
onClick={() => applyBottomPickerValue(opt.value)}
role="button"
>
{opt.label}
</div>
))}
</div>

<div style={{ padding: 10 }}>
<button style={styles.closeBtn} onClick={closeBottomPicker}>
閉じる
</button>
</div>
</div>
</div>
)}
</div>
);
}

// ===== LineChart 改修：点クリックcallback + 土日丸印の色（枠と同じ色） =====


// ===== Part3 ここまで =====
// ===== Part4（不足分のヘルパー + LineChart “完成版(元の機能100%復元)+今回追加分”）=====
// ✅やること：
// 1) Part3 の下にこのヘルパー群を「そのまま」追加
// 2) Part3 の LineChart を “丸ごとこの LineChart に置き換え”

/** ---------- 期間モード：月の目安上限（当月だけ日割り、それ以外は月予算そのまま） ---------- */
function guidelineOfMonth(ym: string, budgetOfMonth: number, guideFactor: number) {
if (!budgetOfMonth || budgetOfMonth <= 0) return 0;

const isCurrent = ym === ymToday();
if (!isCurrent) {
return Math.round(budgetOfMonth * guideFactor);
}

const dim = daysInMonth(ym);
const today = clamp(new Date().getDate(), 1, dim);
return Math.round((budgetOfMonth / dim) * today * guideFactor);
}
function subGuidelineDiffInfo(params: {
month: string;
subBudget: number;
subActual: number;
guideFactor: number;
}) {
const { month, subBudget, subActual, guideFactor } = params;

if (!subBudget || subBudget <= 0) {
const diff = -subActual;
const info = diffStyleAndText(diff);
return { guideline: 0, diff, color: info.color, text: info.text };
}

const dim = daysInMonth(month);
const today = clamp(new Date().getDate(), 1, dim);
const guideline = Math.round((subBudget / dim) * today * guideFactor);
const diff = Math.round(guideline - subActual);
const info = diffStyleAndText(diff);

return { guideline, diff, color: info.color, text: info.text };
}

/**
* ✅単月：目安線（初日実績起点 + 外食土日20倍配分対応）
* - end = baseBudget * guideFactor
* - firstDayActual > 0 のとき：
* day1 = firstDayActual
* 残り(end - day1) を day2..end に配分
* - 通常：直線（線形）
* - 外食土日20倍：重み付き配分（平日=1, 土日=20）
* - firstDayActual === 0 のとき：
* day1..end を 0→end で配分
* - 通常：直線
* - 外食土日20倍：重み付き配分
*
* mode:
* - "cumulative": 累計目安
* - "daily": 日別目安（累計の差分）
*/
function buildGuidelineSeriesWithFirstDayActual(params: {
ym: string; // "YYYY-MM"
dates: string[]; // ["YYYY-MM-01"...]
mode: "daily" | "cumulative";
baseBudget: number;
guideFactor: number;
firstDayActual: number; // 1日合計実績（lineFocus適用済み）
useGaisyokuWeekendBoost: boolean; // 食費/外食 選択中だけ true
}) {
const { ym, dates, mode, baseBudget, guideFactor, firstDayActual, useGaisyokuWeekendBoost } = params;

const dim = dates.length;
const endVal = (Number(baseBudget) || 0) * (Number(guideFactor) || 0);
// ✅ 日別（daily）は「初日実績起点」を使わない（従来の1日予算にする）
if (mode === "daily") {
// 外食（土日20倍）
if (useGaisyokuWeekendBoost) {
const weights = dates.map((date) => {
const [ys, ms, ds] = (date ?? "").split("-");
const y = Number(ys);
const m = Number(ms);
const d = Number(ds);

const yy = Number.isFinite(y) ? y : 1970;
const mm = Number.isFinite(m) ? m : 1;
const dd = Number.isFinite(d) ? d : 1;

const dow = new Date(yy, mm - 1, dd).getDay();
const isWeekend = dow === 0 || dow === 6;
return isWeekend ? 20 : 1;
});
const sumW = weights.reduce((a, b) => a + b, 0) || 1;
return dates.map((date, i) => {
const w = weights[i] ?? 1; // ✅ undefined保険
const v = (endVal * w) / sumW; // 月予算を重みで日割り
return { date, value: Math.round(v) };
});
}

// 通常：毎日同額
const perDay = endVal / (dates.length || 1);
return dates.map((date) => ({ date, value: Math.round(perDay) }));
}
// 予算0は0固定
if (!endVal || endVal <= 0) {
return dates.map((date) => ({ date, value: 0 }));
}

// 重み（外食：土日=20, 平日=1）
const weightOf = (date: string) => {
if (!useGaisyokuWeekendBoost) return 1;
const parts = date.split("-");
const yy = Number(parts[0] ?? 1970);
const mm = Number(parts[1] ?? 1);
const dd = Number(parts[2] ?? 1);
const dow = new Date(yy, mm - 1, dd).getDay(); // 0=日,6=土
const isWeekend = dow === 0 || dow === 6;
return isWeekend ? 20 : 1;
};

// 累計目安を作る
const cumulative: number[] = new Array(dim).fill(0);

const startVal = Math.round(Number(firstDayActual) || 0);

// firstDayActual がある場合：day1固定 + 残りを配分
if (startVal > 0) {
cumulative[0] = startVal;

// 直線（通常）
if (!useGaisyokuWeekendBoost) {
if (dim === 1) {
cumulative[0] = startVal;
} else {
const slope = (endVal - startVal) / (dim - 1);
for (let i = 0; i < dim; i++) {
cumulative[i] = Math.round(startVal + slope * i);
}
}
} else {
// 重み付き配分（day2..end）
const remain = endVal - startVal;

if (dim === 1) {
cumulative[0] = startVal;
} else {
const weights = dates.slice(1).map(weightOf); // day2..end
const sumW = weights.reduce((a, b) => a + b, 0) || 1;

let acc = startVal;
for (let i = 1; i < dim; i++) {
const w = weights[i - 1] ?? 0; // ✅ undefined保険
const add = (remain * w) / sumW;
acc += add;
cumulative[i] = Math.round(acc);
}
}
}
} else {
// firstDayActual が無い（0）：0→endValを配分
if (!useGaisyokuWeekendBoost) {
if (dim === 1) {
cumulative[0] = Math.round(endVal);
} else {
const slope = endVal / (dim - 1);
for (let i = 0; i < dim; i++) {
cumulative[i] = Math.round(slope * i);
}
}
} else {
// 重み付き配分（day1..end）
const weights = dates.map(weightOf);
const sumW = weights.reduce((a, b) => a + b, 0) || 1;

let acc = 0;
for (let i = 0; i < dim; i++) {
const w = weights[i] ?? 0; // ✅ undefined保険
const add = (endVal * w) / sumW;
acc += add;
cumulative[i] = Math.round(acc);
}
}
}



// cumulative
return dates.map((date, i) => ({ date, value: Math.round(cumulative[i] ?? 0) }));
}

/** ---------- LineChart（元の完成版を復元 + 今回追加：土日丸印色/クリックモーダル） ---------- */
function KakeiboLineChart({
month,
data,
guideline,
forecast,
maxValue,
minValue,
showDots,
mode,
onPointClick,
}: {
month: string;
data: { date: string; value: number }[];
guideline: { date: string; value: number }[];
forecast: null | {
today: number;
monthEndValue: number;
budget: number;
remaining: number;
diffInfo: { color: string; text: string };
};
maxValue: number;
minValue: number;
showDots: boolean;
mode: "daily" | "cumulative";
onPointClick?: (key: string, isMonthly: boolean) => void;
}) {
const W = 600;
const H = 200;
const padX = 24;
const padY = 18;

function roundTo1stDigit(n: number) {
const x = Math.abs(Number(n) || 0);
if (x <= 0) return 0;
const digits = Math.floor(Math.log10(x)) + 1;
const unit = Math.pow(10, digits - 1);
return Math.round(x / unit) * unit;
}

function buildNiceGridValues(maxV: number) {
const maxAbs = Math.abs(Number(maxV) || 0);
if (maxAbs <= 0) return [0];

const rawStep = maxAbs / 4;
const step = roundTo1stDigit(rawStep);
if (step <= 0) return [maxAbs];

const vals: number[] = [];
for (let v = step; v < maxAbs; v += step) {
vals.push(v);
if (vals.length > 20) break;
}
vals.push(maxAbs);
return vals;
}

function valueToY(v: number, minV: number, maxV: number) {
const range = (maxV - minV) || 1;
const ratio = (v - minV) / range;
return H - padY - ratio * (H - padY * 2);
}

const n = data.length;
const xStep = n <= 1 ? 0 : (W - padX * 2) / (n - 1);

const toXY = (arr: { date: string; value: number }[]) => {
return arr.map((p, i) => {
const x = padX + xStep * i;
const y = valueToY(Number(p.value) || 0, minValue, maxValue);
return { ...p, x, y };
});
};

const pts = toXY(data);
const gPts = toXY(guideline);

const pathOf = (points: { x: number; y: number }[]) =>
points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

const dMain = pathOf(pts);
const dGuide = pathOf(gPts);

// ===== 期間（月別）モード判定 =====
const isMonthly = data[0]?.date?.length === 7; // "YYYY-MM"

// ===== 年をまたいでいるか =====
const yearsInData = React.useMemo(() => {
if (!isMonthly) return [];
return Array.from(new Set(data.map((d) => Number(d.date.slice(0, 4)))));
}, [isMonthly, data]);

const crossesYear = isMonthly && yearsInData.length >= 2;

// ===== 「年が切り替わる index」と「各年の最初の月 index」 =====
const { yearChangeIdxs, yearFirstIdxs } = React.useMemo(() => {
if (!crossesYear) return { yearChangeIdxs: [] as number[], yearFirstIdxs: [] as number[] };

const change: number[] = [];
const firstByYear = new Map<number, number>();

for (let i = 0; i < data.length; i++) {
const item = data[i];
if (!item) continue;
const y = Number(item.date.slice(0, 4));
if (!firstByYear.has(y)) firstByYear.set(y, i);

if (i > 0) {
const prevItem = data[i - 1];
if (!prevItem) continue;

const prevY = Number(prevItem.date.slice(0, 4));

if (y !== prevY) change.push(i);
}
}

return {
yearChangeIdxs: change,
yearFirstIdxs: Array.from(firstByYear.values()),
};
}, [crossesYear, data]);

// forecast line (today -> end)（単月のみ）
const fLine = React.useMemo(() => {
if (!forecast) return null;

const dim = data.length;
const todayIdx = clamp(forecast.today - 1, 0, dim - 1);

const p0 = pts[0];
const pt = pts[todayIdx];
const pLast = pts[dim - 1];
if (!p0 || !pt || !pLast) return null;
const pend = {
...pLast,
y: valueToY(Number(forecast.monthEndValue) || 0, minValue, maxValue),
};

const start = p0;
const mid = forecast.today === 1 ? { ...pt, y: p0.y } : pt;

const path = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} L ${mid.x.toFixed(1)} ${mid.y.toFixed(
1
)} L ${pend.x.toFixed(1)} ${pend.y.toFixed(1)}`;

return { path, end: pend };
}, [forecast, pts, data.length, minValue, maxValue]);

const gridValues = React.useMemo(() => buildNiceGridValues(maxValue), [maxValue]);
const gridY = React.useMemo(() => gridValues.map((v) => valueToY(v, minValue, maxValue)), [gridValues, minValue, maxValue]);

// y labels（元のロジック復元 + 日別は目安金額も表示）
const yLabels = React.useMemo(() => {
const maxAbs = Math.abs(Number(maxValue) || 0);
if (maxAbs <= 0) return [];

const vals = buildNiceGridValues(maxAbs);
const interior = vals.slice(0, -1);

const labelVals: number[] = [];

if (interior.length === 3) {
const v = interior[1];
if (v != null) labelVals.push(v);
} else if (interior.length >= 4) {
const v1 = interior[1];
const v2 = interior[3];
if (v1 != null) labelVals.push(v1);
if (v2 != null) labelVals.push(v2);
} else if (interior.length === 2) {
const v = interior[1];
if (v != null) labelVals.push(v);
} else if (interior.length === 1) {
const v = interior[0];
if (v != null) labelVals.push(v);
}

// MAX
labelVals.push(maxAbs);

// min がマイナスなら minValue も入れる
if (minValue < 0) labelVals.push(minValue);

// ✅ 日別だけ：目安線の金額も縦軸に出す（単月=YYYY-MM-DD のときだけ）
if (mode === "daily" && !isMonthly) {
const guideV = Math.round(Number(guideline?.[0]?.value ?? 0));
if (guideV > 0) {
const tooClose = labelVals.some((v) => Math.abs(v - guideV) <= Math.max(200, maxAbs * 0.05));
if (!tooClose) labelVals.push(guideV);
}
}

const uniq = Array.from(new Set(labelVals)).sort((a, b) => a - b);

return uniq.map((v) => ({
v,
y: valueToY(v, minValue, maxValue) + 4,
}));
}, [maxValue, minValue, mode, guideline, isMonthly]);

const forecastBudgetText = React.useMemo(() => {
if (!forecast) return null;

const diff = forecast.budget - forecast.monthEndValue;
const info = diffStyleAndText(diff);

return {
color: info.color,
text: `予測 ${fmtYen(forecast.monthEndValue)}（予算差 ${info.text}）`,
};
}, [forecast]);

return (
<div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 10 }}>
<svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 200, display: "block" }}>
{/* grid */}
{gridY.map((y, idx) => (
<line
key={idx}
x1={padX}
x2={W - padX}
y1={y}
y2={y}
stroke="#9e9c9c"
strokeDasharray="4 6"
strokeWidth="0.8"
/>
))}

{/* 0 line */}
<line
x1={padX}
x2={W - padX}
y1={valueToY(0, minValue, maxValue)}
y2={valueToY(0, minValue, maxValue)}
stroke="#334155"
strokeWidth="1"
/>

{/* year boundary vertical guides (range mode only) */}
{crossesYear &&
yearChangeIdxs.map((idx) => {
const x = pts[idx]?.x;
if (x == null) return null;
return (
<line
key={"year_v_" + idx}
x1={x}
x2={x}
y1={padY}
y2={H - padY}
stroke="#64748b"
strokeDasharray="4 4"
strokeWidth="2"
/>
);
})}

{/* y labels */}
{yLabels.map((l, i) => (
<text key={i} x={4} y={l.y} fontSize="10" fill="#64748b" fontWeight="700">
¥{Number(l.v).toLocaleString("ja-JP")}
</text>
))}

{/* guideline dotted */}
<path d={dGuide} fill="none" stroke="#94a3b8" strokeWidth="2" />

{/* forecast */}
{fLine && forecast && forecastBudgetText && (
<>
<path d={fLine.path} fill="none" stroke="#f97316" strokeWidth="2.5" strokeDasharray="10 6" />
<text
x={fLine.end.x - 6}
y={fLine.end.y - 18}
textAnchor="end"
fontSize="18"
fill={forecastBudgetText.color}
fontWeight="900"
>
{forecastBudgetText.text}
</text>
</>
)}

{/* main line */}
<path d={dMain} fill="none" stroke="#0b4aa2" strokeWidth="3" />

{/* ✅ dots：タップ判定を広げる（透明ヒット領域 + 見た目の丸） */}
{showDots &&
pts.map((p) => {
// 期間（月別）
if (isMonthly) {
return (
<g
key={p.date}
style={{ cursor: "pointer" }}
onClick={() => onPointClick?.(p.date, true)}
>
{/* ヒット領域（透明で大きい） */}
<circle cx={p.x} cy={p.y} r={14} fill="transparent" />

{/* 見た目の丸（今まで通り） */}
<circle
cx={p.x}
cy={p.y}
r={3.2}
fill="#0b4aa2"
stroke="#ffffff"
strokeWidth={1.5}
style={{ pointerEvents: "none" }}
/>
</g>
);
}

// 単月（日別）
const parts = (p.date ?? "").split("-");
const yy = Number(parts[0] ?? 1970);
const mm = Number(parts[1] ?? 1);
const dd = Number(parts[2] ?? 1);
const dow = new Date(yy, mm - 1, dd).getDay();
const isWeekend = dow === 0 || dow === 6;

const isCurrentMonth = month.length >= 7 && month.slice(0, 7) === ymToday();
const today = new Date().getDate();
const isToday = isCurrentMonth && dd === today;

// 今日（赤丸）
if (isToday) {
return (
<g
key={p.date}
style={{ cursor: "pointer" }}
onClick={() => onPointClick?.(p.date, false)}
>
{/* ヒット領域 */}
<circle cx={p.x} cy={p.y} r={16} fill="transparent" />

{/* 見た目 */}
<circle
cx={p.x}
cy={p.y}
r={8}
fill="#ed0b0b"
stroke="#ffffff"
strokeWidth={1.8}
style={{ pointerEvents: "none" }}
/>
</g>
);
}

const weekendColor = "#fca5a5";
const fill = isWeekend ? weekendColor : "#0b4aa2";
const stroke = isWeekend ? weekendColor : "#ffffff";
const strokeWidth = isWeekend ? 2.0 : 1.5;

return (
<g
key={p.date}
style={{ cursor: "pointer" }}
onClick={() => onPointClick?.(p.date, false)}
>
{/* ヒット領域 */}
<circle cx={p.x} cy={p.y} r={14} fill="transparent" />

{/* 見た目 */}
<circle
cx={p.x}
cy={p.y}
r={3.2}
fill={fill}
stroke={stroke}
strokeWidth={strokeWidth}
style={{ pointerEvents: "none" }}
/>
</g>
);
})}


{/* x labels（元の完成版復元） */}
{pts.map((p, i) => {
const pos = i + 1;

// 表示間引き（従来）
const defaultSkip = n > 10 && pos % 5 !== 0 && pos !== 1 && pos !== n;

// 期間モードで「各年の最初の月」は必ず表示
const forceShowYearFirst = crossesYear && yearFirstIdxs.includes(i);

if (defaultSkip && !forceShowYearFirst) return null;

const label = (() => {
// 単月: YYYY-MM-DD → 01 を 1 に
if (p.date.length >= 10) return String(Number(p.date.slice(8)));

// 期間: YYYY-MM
if (p.date.length === 7) {
const yy = String(p.date.slice(0, 4)).slice(2); // "2024" -> "24"
const m = String(Number(p.date.slice(5))); // "03" -> "3"

// 年またぎ：各年の最初の月だけ YY/M
if (crossesYear && yearFirstIdxs.includes(i)) return `${yy}/${m}`;

// それ以外は月
return m;
}
return p.date;
})();

return (
<text
key={p.date + "_x"}
x={p.x}
y={H - 4}
textAnchor="middle"
fontSize="10"
fill="#64748b"
fontWeight="700"
>
{label}
</text>
);
})}
</svg>
</div>
);
}
// ===== Part4 ここまで =====