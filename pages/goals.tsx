// pages/goals.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
collection,
doc,
getDocs,
addDoc,
updateDoc,
deleteDoc,
serverTimestamp,
query,
where,
getDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useRouter } from "next/router";

// =====================
// Types
// =====================
type GoalDoc = {
id: string;
title: string; // 表示名（例：旅行）
keyword: string; // 部分一致で拾うキーワード（例：旅行）
targetAmount: number; // 目標金額
startMonth: string; // "YYYY-MM"
endMonth: string; // "YYYY-MM"
archived?: boolean;
createdAt?: any;
updatedAt?: any;
};

type ExpenseDoc = {
id: string;
registrant: string;
date: string; // "YYYY-MM-DD"
month: string; // "YYYY-MM"
amount: number;
category: string;
subCategory: string; // 自由入力の場合はここに文字列が入る
source: string;
memo?: string;
};

// =====================
// Helpers
// =====================
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
function clamp(n: number, min: number, max: number) {
return Math.max(min, Math.min(max, n));
}
function fmtYen(n: number) {
const r = Math.round(Number(n) || 0);
const sign = r < 0 ? "▲" : "";
return `${sign}¥${Math.abs(r).toLocaleString("ja-JP")}`;
}
function digitsOnly(s: string) {
return (s || "").replace(/[^\d]/g, "");
}
function formatWithCommaDigits(s: string) {
const d = digitsOnly(s);
if (!d) return "";
return new Intl.NumberFormat("ja-JP").format(Number(d));
}
function parseAmountFromText(amountText: string) {
const d = digitsOnly(amountText);
if (!d) return NaN;
const n = Number(d);
if (!Number.isFinite(n)) return NaN;
return Math.trunc(n);
}
function isValidYM(ym: string) {
return /^\d{4}-\d{2}$/.test(ym);
}
function isValidYMD(ymd: string) {
return /^\d{4}-\d{2}-\d{2}$/.test(ymd);
}
function ymdStartOfMonth(ym: string) {
return `${ym}-01`;
}
function ymdStartOfNextMonth(ym: string) {
const { y, m } = parseYM(ym);
const d = new Date(y, m, 1); // 次月1日
const yy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, "0");
return `${yy}-${mm}-01`;
}
function monthLabelJP(ym: string) {
const { y, m } = parseYM(ym);
return `${y}年${m}月`;
}

// =====================
// Caches (10min)
// =====================
const expensesCacheByMonth = new Map<string, { rows: ExpenseDoc[]; cachedAt: number }>();
const EXP_TTL = 1000 * 60 * 10;
function isFresh(ts: number, ttl: number) {
return Date.now() - ts <= ttl;
}

// =====================
// LineChart (月別・累計) 目標用
// =====================
function KakeiboLineChart({
data,
maxValue,
minValue,
showDots,
onPointClick,
}: {
data: { date: string; value: number }[]; // date="YYYY-MM"
maxValue: number;
minValue: number;
showDots: boolean;
onPointClick?: (key: string) => void;
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
const range = maxV - minV || 1;
const ratio = (v - minV) / range;
return H - padY - ratio * (H - padY * 2);
}

const n = data.length;
const xStep = n <= 1 ? 0 : (W - padX * 2) / (n - 1);

const pts = data.map((p, i) => {
const x = padX + xStep * i;
const y = valueToY(Number(p.value) || 0, minValue, maxValue);
return { ...p, x, y };
});

const path = pts
.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
.join(" ");

const gridValues = buildNiceGridValues(maxValue);
const gridY = gridValues.map((v) => valueToY(v, minValue, maxValue));

// y labels
const yLabels = (() => {
const maxAbs = Math.abs(Number(maxValue) || 0);
if (maxAbs <= 0) return [];
const vals = buildNiceGridValues(maxAbs);
const interior = vals.slice(0, -1);
const labelVals: number[] = [];
if (interior.length >= 4) {
labelVals.push(interior[1] ?? 0);
labelVals.push(interior[3] ?? 0);
} else if (interior.length === 3) {
labelVals.push(interior[1] ?? 0);
} else if (interior.length === 2) {
labelVals.push(interior[1] ?? 0);
} else if (interior.length === 1) {
labelVals.push(interior[0] ?? 0);
}
labelVals.push(maxAbs);
if (minValue < 0) labelVals.push(minValue);

const uniq = Array.from(new Set(labelVals)).sort((a, b) => a - b);
return uniq.map((v) => ({
v,
y: valueToY(v, minValue, maxValue) + 4,
}));
})();

// x label（間引き）
const xSkip = n > 10 ? 2 : 1;

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

{/* y labels */}
{yLabels.map((l, i) => (
<text key={i} x={4} y={l.y} fontSize="10" fill="#64748b" fontWeight="700">
¥{Number(l.v).toLocaleString("ja-JP")}
</text>
))}

{/* main line */}
<path d={path} fill="none" stroke="#0b4aa2" strokeWidth="3" />

{/* dots */}
{showDots &&
pts.map((p, i) => (
<g key={p.date} style={{ cursor: "pointer" }} onClick={() => onPointClick?.(p.date)}>
{/* hit */}
<circle cx={p.x} cy={p.y} r={14} fill="transparent" />
{/* visible */}
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
))}

{/* x labels */}
{pts.map((p, i) => {
if (i % xSkip !== 0 && i !== 0 && i !== pts.length - 1) return null;
const yy = String(p.date.slice(0, 4)).slice(2);
const m = String(Number(p.date.slice(5)));
const label = i === 0 || i === pts.length - 1 ? `${yy}/${m}` : m;
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

// =====================
// Page
// =====================
export default function GoalsPage() {
const router = useRouter();

// list
const [goals, setGoals] = useState<GoalDoc[]>([]);
const [loading, setLoading] = useState(true);

// add/edit modal
const [editGoalOpen, setEditGoalOpen] = useState(false);
const [editingGoalId, setEditingGoalId] = useState<string | null>(null);

const [title, setTitle] = useState("");
const [keyword, setKeyword] = useState("");
const [targetText, setTargetText] = useState("");
const [startMonth, setStartMonth] = useState(ymToday());
const [endMonth, setEndMonth] = useState(ymToday());
const [archived, setArchived] = useState(false);

const [touched, setTouched] = useState<Record<string, boolean>>({});

// drilldown modal
const [drillOpen, setDrillOpen] = useState(false);
const [drillGoal, setDrillGoal] = useState<GoalDoc | null>(null);
const [drillMode, setDrillMode] = useState<"monthly" | "cumulative">("monthly"); // 月別 / 累計
const [drillPickedMonth, setDrillPickedMonth] = useState<string>(""); // 明細用の月
const [drillDetailOpen, setDrillDetailOpen] = useState(false);

// expenses in drill range (client-filtered)
const [drillExpenses, setDrillExpenses] = useState<ExpenseDoc[]>([]);
const [drillExpensesLoading, setDrillExpensesLoading] = useState(false);

// responsive
const [wide, setWide] = useState(false);
useEffect(() => {
const on = () => setWide(window.innerWidth >= 768);
on();
window.addEventListener("resize", on);
return () => window.removeEventListener("resize", on);
}, []);

// =====================
// Load goals
// =====================
const loadGoals = async () => {
setLoading(true);
try {
const snap = await getDocs(collection(db, "goals"));
const rows = snap.docs.map((d) => {
const raw = d.data() as any;
const g: GoalDoc = {
id: d.id,
title: String(raw.title ?? ""),
keyword: String(raw.keyword ?? ""),
targetAmount: Number(raw.targetAmount ?? 0),
startMonth: String(raw.startMonth ?? ymToday()),
endMonth: String(raw.endMonth ?? ymToday()),
archived: Boolean(raw.archived ?? false),
createdAt: raw.createdAt,
updatedAt: raw.updatedAt,
};
return g;
});

// 表示順：未アーカイブ→アーカイブ、開始月→新しい順
rows.sort((a, b) => {
const aa = a.archived ? 1 : 0;
const bb = b.archived ? 1 : 0;
if (aa !== bb) return aa - bb;
return ymToIndex(b.startMonth) - ymToIndex(a.startMonth);
});

setGoals(rows);
} catch (e) {
console.error(e);
setGoals([]);
} finally {
setLoading(false);
}
};

useEffect(() => {
loadGoals();
}, []);

// =====================
// Compute progress for each goal
// - 期間内の「積立」(category) を month in で取って
// - subCategory が keyword を含むものだけ合計
// =====================
const [goalProgress, setGoalProgress] = useState<
Record<
string,
{
saved: number;
monthly: Record<string, number>;
matchedCount: number;
}
>
>({});

useEffect(() => {
let alive = true;

(async () => {
if (goals.length === 0) {
if (!alive) return;
setGoalProgress({});
return;
}

// 目標ごとに読むと重いので、まず「必要な月」をまとめる（ただしin最大10なので結局chunkする）
// ここでは「全部の目標の月範囲」をunionして読む（積立だけ、後で目標ごとにfilter）
const allMonths = new Set<string>();
for (const g of goals) {
if (!isValidYM(g.startMonth) || !isValidYM(g.endMonth)) continue;
monthsBetween(g.startMonth, g.endMonth).forEach((m) => allMonths.add(m));
}
const monthsList = Array.from(allMonths);
if (monthsList.length === 0) {
if (!alive) return;
setGoalProgress({});
return;
}

// 月ごとに expenses を取る（キャッシュ利用）
const byMonth: Record<string, ExpenseDoc[]> = {};
const missing: string[] = [];

for (const ym of monthsList) {
const cached = expensesCacheByMonth.get(ym);
if (cached && isFresh(cached.cachedAt, EXP_TTL)) {
byMonth[ym] = cached.rows;
} else {
missing.push(ym);
}
}

for (const ym of missing) byMonth[ym] = [];

for (const part of chunk(missing, 10)) {
// month in は最大10
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
};
const ym = row.month;
if (!byMonth[ym]) byMonth[ym] = [];
byMonth[ym].push(row);
});
}

// キャッシュ保存
if (missing.length > 0) {
const now = Date.now();
for (const ym of missing) {
expensesCacheByMonth.set(ym, { rows: byMonth[ym] ?? [], cachedAt: now });
}
}

// 目標ごとに集計
const next: Record<string, { saved: number; monthly: Record<string, number>; matchedCount: number }> = {};

for (const g of goals) {
if (!isValidYM(g.startMonth) || !isValidYM(g.endMonth)) {
next[g.id] = { saved: 0, monthly: {}, matchedCount: 0 };
continue;
}

const months = monthsBetween(g.startMonth, g.endMonth);

const key = (g.keyword || g.title || "").trim();
const monthlyMap: Record<string, number> = {};
let sum = 0;
let cnt = 0;

for (const ym of months) {
const rows = (byMonth[ym] ?? []).filter((r) => r.category === "積立");
// 部分一致
const matched = key
? rows.filter((r) => String(r.subCategory ?? "").includes(key))
: rows;

const mSum = matched.reduce((a, b) => a + (Number(b.amount) || 0), 0);
monthlyMap[ym] = mSum;
sum += mSum;
cnt += matched.length;
}

next[g.id] = { saved: sum, monthly: monthlyMap, matchedCount: cnt };
}

if (!alive) return;
setGoalProgress(next);
})();

return () => {
alive = false;
};
}, [goals]);

// 「積立」合計（ページ上部に表示）… 各目標の saved を単純合算（仕様としてこれでOK）
const totalSavedAcrossGoals = useMemo(() => {
return Object.values(goalProgress).reduce((a, b) => a + (Number(b.saved) || 0), 0);
}, [goalProgress]);

// =====================
// Add / Edit Goal
// =====================
const openAddGoal = () => {
setEditingGoalId(null);
setTouched({});
setTitle("");
setKeyword("");
setTargetText("");
const now = ymToday();
setStartMonth(now);
setEndMonth(now);
setArchived(false);
setEditGoalOpen(true);
};

const openEditGoal = (g: GoalDoc) => {
setEditingGoalId(g.id);
setTouched({});
setTitle(g.title || "");
setKeyword(g.keyword || "");
setTargetText(formatWithCommaDigits(String(g.targetAmount || 0)));
setStartMonth(g.startMonth || ymToday());
setEndMonth(g.endMonth || ymToday());
setArchived(Boolean(g.archived));
setEditGoalOpen(true);
};

const closeEditGoal = () => {
setEditGoalOpen(false);
setEditingGoalId(null);
};

const targetAmount = useMemo(() => parseAmountFromText(targetText), [targetText]);

const missing = useMemo(() => {
const m: Record<string, boolean> = {};
m.title = !(title || "").trim();
m.keyword = !((keyword || "").trim() || (title || "").trim()); // keyword空ならタイトル使えるのでここは実質OK
m.target = !targetText || !Number.isFinite(targetAmount) || targetAmount <= 0;
m.startMonth = !isValidYM(startMonth);
m.endMonth = !isValidYM(endMonth);
// start <= end 推奨（逆でも monthsBetween が吸収するけど、登録は揃えたい）
const a = isValidYM(startMonth) ? ymToIndex(startMonth) : 0;
const b = isValidYM(endMonth) ? ymToIndex(endMonth) : 0;
m.range = isValidYM(startMonth) && isValidYM(endMonth) ? a > b : false;
return m;
}, [title, keyword, targetText, targetAmount, startMonth, endMonth]);

const hasMissing = useMemo(() => Object.values(missing).some(Boolean), [missing]);

const markAllTouched = () => {
setTouched({
title: true,
target: true,
startMonth: true,
endMonth: true,
});
};

const onSaveGoal = async () => {
if (hasMissing) {
markAllTouched();
alert("未入力/不正な項目があります。赤枠の項目を修正してください。");
return;
}

const safeTitle = (title || "").trim();
const safeKeyword = (keyword || "").trim() || safeTitle;

try {
if (!editingGoalId) {
await addDoc(collection(db, "goals"), {
title: safeTitle,
keyword: safeKeyword,
targetAmount: Math.trunc(targetAmount),
startMonth,
endMonth,
archived: Boolean(archived),
createdAt: serverTimestamp(),
updatedAt: serverTimestamp(),
});
} else {
await updateDoc(doc(db, "goals", editingGoalId), {
title: safeTitle,
keyword: safeKeyword,
targetAmount: Math.trunc(targetAmount),
startMonth,
endMonth,
archived: Boolean(archived),
updatedAt: serverTimestamp(),
});
}

closeEditGoal();
await loadGoals();
} catch (e) {
console.error(e);
alert("保存に失敗しました。");
}
};

const onDeleteGoal = async () => {
if (!editingGoalId) return;
const ok = confirm("この目標を削除しますか？");
if (!ok) return;

try {
await deleteDoc(doc(db, "goals", editingGoalId));
closeEditGoal();
await loadGoals();
} catch (e) {
console.error(e);
alert("削除に失敗しました。");
}
};

const onArchiveToggle = async (g: GoalDoc, nextArchived: boolean) => {
try {
await updateDoc(doc(db, "goals", g.id), {
archived: nextArchived,
updatedAt: serverTimestamp(),
});
await loadGoals();
} catch (e) {
console.error(e);
alert("更新に失敗しました。");
}
};

// =====================
// Drilldown
// =====================
const openDrill = async (g: GoalDoc) => {
setDrillGoal(g);
setDrillMode("monthly");
setDrillOpen(true);

const months = monthsBetween(g.startMonth, g.endMonth);
setDrillPickedMonth(months[months.length - 1] ?? g.endMonth); // デフォは最終月

// ドリル用の expenses をロード（範囲の積立だけ）
setDrillExpenses([]);
setDrillExpensesLoading(true);

try {
const monthsList = months;
const byMonth: Record<string, ExpenseDoc[]> = {};
const missing: string[] = [];

for (const ym of monthsList) {
const cached = expensesCacheByMonth.get(ym);
if (cached && isFresh(cached.cachedAt, EXP_TTL)) {
byMonth[ym] = cached.rows;
} else {
missing.push(ym);
byMonth[ym] = [];
}
}

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
};
const ym = row.month;
if (!byMonth[ym]) byMonth[ym] = [];
byMonth[ym].push(row);
});
}

if (missing.length > 0) {
const now = Date.now();
for (const ym of missing) expensesCacheByMonth.set(ym, { rows: byMonth[ym] ?? [], cachedAt: now });
}

const key = (g.keyword || g.title || "").trim();
const all = monthsList
.flatMap((ym) => byMonth[ym] ?? [])
.filter((r) => r.category === "積立")
.filter((r) => (key ? String(r.subCategory ?? "").includes(key) : true));

setDrillExpenses(all);
} catch (e) {
console.error(e);
setDrillExpenses([]);
} finally {
setDrillExpensesLoading(false);
}
};

const closeDrill = () => {
setDrillOpen(false);
setDrillGoal(null);
setDrillExpenses([]);
setDrillDetailOpen(false);
};

// drill series
const drillMonths = useMemo(() => {
if (!drillGoal) return [];
if (!isValidYM(drillGoal.startMonth) || !isValidYM(drillGoal.endMonth)) return [];
return monthsBetween(drillGoal.startMonth, drillGoal.endMonth);
}, [drillGoal]);

const drillMonthlySeries = useMemo(() => {
if (!drillGoal) return [];
const p = goalProgress[drillGoal.id];
const monthly = p?.monthly ?? {};
return drillMonths.map((ym) => ({ date: ym, value: Number(monthly?.[ym] ?? 0) }));
}, [drillGoal, goalProgress, drillMonths]);

const drillCumulativeSeries = useMemo(() => {
let acc = 0;
return drillMonthlySeries.map((x) => {
acc += Number(x.value) || 0;
return { date: x.date, value: acc };
});
}, [drillMonthlySeries]);

const drillSeries = useMemo(() => {
return drillMode === "monthly" ? drillMonthlySeries : drillCumulativeSeries;
}, [drillMode, drillMonthlySeries, drillCumulativeSeries]);

const drillSaved = useMemo(() => {
if (!drillGoal) return 0;
return Number(goalProgress[drillGoal.id]?.saved ?? 0);
}, [drillGoal, goalProgress]);

const drillRemain = useMemo(() => {
if (!drillGoal) return 0;
const t = Number(drillGoal.targetAmount ?? 0);
return Math.max(0, t - drillSaved);
}, [drillGoal, drillSaved]);

const drillProgressPct = useMemo(() => {
if (!drillGoal) return 0;
const t = Number(drillGoal.targetAmount ?? 0);
if (!t || t <= 0) return 0;
return clamp((drillSaved / t) * 100, 0, 100);
}, [drillGoal, drillSaved]);

const drillMonthsLeft = useMemo(() => {
if (!drillGoal) return 0;
const a = ymToIndex(ymToday());
const b = ymToIndex(drillGoal.endMonth);
return Math.max(0, b - a + 1);
}, [drillGoal]);

const drillNeedPerMonth = useMemo(() => {
if (!drillGoal) return 0;
const left = drillMonthsLeft || 0;
if (left <= 0) return drillRemain;
return Math.ceil(drillRemain / left);
}, [drillRemain, drillMonthsLeft, drillGoal]);

// drill chart max/min
const { lineMax, lineMin } = useMemo(() => {
const values = drillSeries.map((x) => x.value);
const max = Math.max(...values, 0);
const min = Math.min(...values, 0);
if (max === 0 && min === 0) return { lineMax: 1, lineMin: 0 };
return { lineMax: max, lineMin: min };
}, [drillSeries]);

// drill month detail rows
const drillMonthRows = useMemo(() => {
if (!drillPickedMonth) return [];
return drillExpenses
.filter((r) => r.month === drillPickedMonth)
.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}, [drillExpenses, drillPickedMonth]);

const drillMonthTotal = useMemo(() => {
return drillMonthRows.reduce((a, b) => a + (Number(b.amount) || 0), 0);
}, [drillMonthRows]);

// =====================
// Styles
// =====================
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

card: {
background: "#ffffff",
border: "1px solid #e5e7eb",
borderRadius: 14,
padding: 12,
boxShadow: "0 6px 18px rgba(15, 23, 42, 0.05)",
} as React.CSSProperties,

headerRow: {
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: 10,
} as React.CSSProperties,

title: {
fontSize: 16,
fontWeight: 900,
color: "#0b4aa2",
} as React.CSSProperties,

subTitle: {
marginTop: 6,
fontSize: 12,
fontWeight: 900,
color: "#334155",
} as React.CSSProperties,

pillBtn: {
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid #93c5fd",
background: "#ffffff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
whiteSpace: "nowrap",
} as React.CSSProperties,

primaryBtn: {
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid #93c5fd",
background: "#1d4ed8",
color: "#fff",
fontWeight: 900,
cursor: "pointer",
whiteSpace: "nowrap",
} as React.CSSProperties,

grid: {
display: "grid",
gridTemplateColumns: wide ? "1fr 1fr" : "1fr",
gap: 10,
marginTop: 10,
} as React.CSSProperties,

goalCard: {
border: "1px solid #e5e7eb",
borderRadius: 14,
background: "#fff",
padding: 12,
boxShadow: "0 6px 18px rgba(15, 23, 42, 0.04)",
cursor: "pointer",
} as React.CSSProperties,

goalTop: {
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: 8,
} as React.CSSProperties,

goalName: {
fontSize: 15,
fontWeight: 900,
color: "#0f172a",
overflow: "hidden",
textOverflow: "ellipsis",
whiteSpace: "nowrap",
} as React.CSSProperties,

smallBtn: {
height: 30,
padding: "0 10px",
borderRadius: 999,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
fontSize: 11,
} as React.CSSProperties,

progressBarWrap: {
marginTop: 10,
position: "relative",
height: 18,
borderRadius: 999,
overflow: "hidden",
background: "#f1f5f9",
border: "1px solid #e2e8f0",
} as React.CSSProperties,

progressBar: (pct: number): React.CSSProperties => ({
position: "absolute",
inset: 0,
width: `${clamp(pct, 0, 100)}%`,
background: "linear-gradient(90deg, #16a34a 0%, #22c55e 100%)",
}),

progressText: {
marginTop: 6,
fontSize: 12,
fontWeight: 900,
color: "#334155",
} as React.CSSProperties,

// overlay modal
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
fontWeight: 900,
} as React.CSSProperties,

errorBorder: {
border: "2px solid #dc2626",
background: "#fff5f5",
} as React.CSSProperties,

monthInput: {
...selectBase,
width: 160,
} as React.CSSProperties,

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

// drill modal (center)
drillOverlay: {
position: "fixed",
inset: 0,
background: "rgba(15,23,42,0.55)",
display: "flex",
justifyContent: "center",
alignItems: "center",
padding: 12,
zIndex: 90,
} as React.CSSProperties,

drillCard: {
width: "min(980px, 100%)",
maxHeight: "88vh",
background: "#fff",
borderRadius: 16,
border: "1px solid #e5e7eb",
boxShadow: "0 20px 60px rgba(15,23,42,0.25)",
overflow: "hidden",
display: "flex",
flexDirection: "column",
} as React.CSSProperties,

drillHeader: {
padding: 12,
borderBottom: "1px solid #e5e7eb",
background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
} as React.CSSProperties,

drillHeaderTop: {
display: "flex",
justifyContent: "space-between",
alignItems: "center",
gap: 8,
} as React.CSSProperties,

drillTitle: { fontSize: 15, fontWeight: 900, color: "#0b4aa2" } as React.CSSProperties,

drillBody: {
padding: 12,
overflow: "auto",
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

statRow: {
marginTop: 10,
display: "grid",
gridTemplateColumns: wide ? "repeat(4, 1fr)" : "repeat(2, 1fr)",
gap: 8,
} as React.CSSProperties,

statCard: {
border: "1px solid #e5e7eb",
borderRadius: 14,
background: "#fff",
padding: 10,
textAlign: "center",
fontWeight: 900,
} as React.CSSProperties,

statLabel: { fontSize: 11, color: "#64748b" } as React.CSSProperties,
statValue: { marginTop: 4, fontSize: 14, color: "#0f172a" } as React.CSSProperties,

// detail month list
tableHeader: {
display: "grid",
gridTemplateColumns: "92px 1fr 110px",
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
fontSize: 11,
} as React.CSSProperties,

tableRow: {
display: "grid",
gridTemplateColumns: "92px 1fr 110px",
gap: 8,
padding: "7px 0",
borderBottom: "1px dashed #e2e8f0",
alignItems: "center",
textAlign: "center",
fontWeight: 900,
fontSize: 11,
} as React.CSSProperties,
};
}, [wide]);

// =====================
// UI derived
// =====================
const activeGoals = useMemo(() => goals.filter((g) => !g.archived), [goals]);
const archivedGoals = useMemo(() => goals.filter((g) => g.archived), [goals]);

// =====================
// Render
// =====================
return (
<div style={styles.page}>
{/* Header */}
<div style={{ ...styles.card, padding: 12 }}>
<div style={styles.headerRow}>
<div>
<div style={styles.title}>貯金目標</div>
<div style={styles.subTitle}>「積立」合計金額：{fmtYen(totalSavedAcrossGoals)}</div>
</div>

<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
<button style={styles.pillBtn} onClick={() => router.push("/expense")}>
＋支出登録へ
</button>
<button style={styles.primaryBtn} onClick={openAddGoal}>
＋ 目標を追加
</button>
</div>
</div>
</div>

{/* List */}
<div style={{ ...styles.card, marginTop: 10 }}>
<div style={{ fontSize: 13, fontWeight: 900, color: "#0b4aa2" }}>目標一覧</div>

{loading ? (
<div style={{ marginTop: 12, fontWeight: 900, color: "#64748b", textAlign: "center" }}>読み込み中…</div>
) : activeGoals.length === 0 && archivedGoals.length === 0 ? (
<div style={{ marginTop: 12, fontWeight: 900, color: "#64748b", textAlign: "center" }}>
まだ目標がありません。「＋ 目標を追加」から作れます。
</div>
) : (
<>
{/* Active */}
<div style={styles.grid}>
{activeGoals.map((g) => {
const p = goalProgress[g.id];
const saved = Number(p?.saved ?? 0);
const target = Number(g.targetAmount ?? 0);
const pct = target > 0 ? clamp((saved / target) * 100, 0, 100) : 0;
const remain = Math.max(0, target - saved);
const isDone = target > 0 && saved >= target;

return (
<div
key={g.id}
style={{ ...styles.goalCard, opacity: g.archived ? 0.6 : 1 }}
onClick={() => openDrill(g)}
role="button"
>
<div style={styles.goalTop}>
<div style={styles.goalName}>
{g.title}{" "}
<span style={{ fontSize: 11, color: "#64748b", fontWeight: 900 }}>
（{g.startMonth}〜{g.endMonth}）
</span>
</div>

<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
{isDone && (
<span
style={{
fontSize: 11,
fontWeight: 900,
padding: "4px 10px",
borderRadius: 999,
border: "1px solid #fde68a",
background: "#fef3c7",
color: "#92400e",
whiteSpace: "nowrap",
}}
>
達成！🎉
</span>
)}
<button
style={styles.smallBtn}
onClick={(e) => {
e.stopPropagation();
openEditGoal(g);
}}
>
編集
</button>
</div>
</div>

<div style={{ marginTop: 8, fontWeight: 900, color: "#334155", fontSize: 12 }}>
現在 {fmtYen(saved)} / {fmtYen(target)}
</div>

<div style={styles.progressBarWrap}>
<div style={styles.progressBar(pct)} />
</div>

<div style={styles.progressText}>
残り：{fmtYen(remain)} / キーワード：{" "}
<span style={{ color: "#0b4aa2" }}>{(g.keyword || g.title || "").trim()}</span>
</div>

{p?.matchedCount != null && (
<div style={{ marginTop: 6, fontSize: 11, fontWeight: 900, color: "#64748b" }}>
期間内ヒット明細：{p.matchedCount}件
</div>
)}
</div>
);
})}
</div>

{/* Archived */}
{archivedGoals.length > 0 && (
<div style={{ marginTop: 12 }}>
<div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>アーカイブ</div>
<div style={styles.grid}>
{archivedGoals.map((g) => {
const p = goalProgress[g.id];
const saved = Number(p?.saved ?? 0);
const target = Number(g.targetAmount ?? 0);
const pct = target > 0 ? clamp((saved / target) * 100, 0, 100) : 0;

return (
<div
key={g.id}
style={{ ...styles.goalCard, opacity: 0.7 }}
onClick={() => openDrill(g)}
role="button"
>
<div style={styles.goalTop}>
<div style={styles.goalName}>
{g.title}{" "}
<span style={{ fontSize: 11, color: "#64748b", fontWeight: 900 }}>
（{g.startMonth}〜{g.endMonth}）
</span>
</div>

<button
style={styles.smallBtn}
onClick={(e) => {
e.stopPropagation();
openEditGoal(g);
}}
>
編集
</button>
</div>

<div style={{ marginTop: 8, fontWeight: 900, color: "#334155", fontSize: 12 }}>
現在 {fmtYen(saved)} / {fmtYen(target)}
</div>

<div style={styles.progressBarWrap}>
<div style={styles.progressBar(pct)} />
</div>
</div>
);
})}
</div>
</div>
)}
</>
)}
</div>

{/* ===== Add/Edit Goal Modal ===== */}
{editGoalOpen && (
<div style={styles.overlay} onClick={closeEditGoal} role="dialog" aria-modal="true">
<div style={styles.modal} onClick={(e) => e.stopPropagation()}>
<div style={styles.modalHead}>
<div style={styles.modalTitle}>{editingGoalId ? "目標の編集" : "目標を追加"}</div>
<button style={styles.btnSub} onClick={closeEditGoal}>
閉じる
</button>
</div>

<div style={styles.modalBody}>
{/* title */}
<div>
<div style={styles.label}>目標名（必須）</div>
<input
value={title}
onChange={(e) => setTitle(e.target.value)}
onBlur={() => setTouched((t) => ({ ...t, title: true }))}
placeholder="例：旅行 / 車購入 / 教育資金"
style={{ ...styles.input, ...(touched.title && missing.title ? styles.errorBorder : {}) }}
/>
</div>

{/* keyword */}
<div style={{ marginTop: 10 }}>
<div style={styles.label}>紐付けキーワード（任意）</div>
<input
value={keyword}
onChange={(e) => setKeyword(e.target.value)}
placeholder="空なら目標名を使う（積立の自由入力に部分一致）"
style={styles.input}
/>
<div style={{ marginTop: 6, fontSize: 11, fontWeight: 900, color: "#64748b" }}>
例：「積立」カテゴリで自由入力に「旅行」が入っている明細を、この目標として合計します
</div>
</div>

{/* target */}
<div style={{ marginTop: 10 }}>
<div style={styles.label}>目標金額（必須）</div>
<input
inputMode="numeric"
value={targetText}
onChange={(e) => setTargetText(formatWithCommaDigits(e.target.value))}
onBlur={() => setTouched((t) => ({ ...t, target: true }))}
placeholder="例：500,000"
style={{ ...styles.input, textAlign: "center", ...(touched.target && missing.target ? styles.errorBorder : {}) }}
/>
<div style={{ marginTop: 4, fontSize: 12, fontWeight: 900, textAlign: "center", color: "#334155" }}>
{Number.isFinite(targetAmount) ? fmtYen(targetAmount) : "¥0"}
</div>
</div>

{/* period */}
<div style={{ marginTop: 10 }}>
<div style={styles.label}>期間（必須）</div>
<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
<input
type="month"
value={startMonth}
onChange={(e) => setStartMonth(e.target.value)}
onBlur={() => setTouched((t) => ({ ...t, startMonth: true }))}
style={{
...styles.monthInput,
...(touched.startMonth && (missing.startMonth || missing.range) ? styles.errorBorder : {}),
}}
/>
<span style={{ fontWeight: 900, color: "#64748b" }}>〜</span>
<input
type="month"
value={endMonth}
onChange={(e) => setEndMonth(e.target.value)}
onBlur={() => setTouched((t) => ({ ...t, endMonth: true }))}
style={{
...styles.monthInput,
...(touched.endMonth && (missing.endMonth || missing.range) ? styles.errorBorder : {}),
}}
/>
</div>

{missing.range && (
<div style={{ marginTop: 6, color: "#dc2626", fontWeight: 900, fontSize: 12 }}>
期間が逆です（開始月 ≤ 終了月）
</div>
)}
</div>

{/* archived */}
<div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
<input
type="checkbox"
checked={archived}
onChange={(e) => setArchived(e.target.checked)}
id="archived"
/>
<label htmlFor="archived" style={{ fontWeight: 900, color: "#334155" }}>
アーカイブにする
</label>
</div>
</div>

<div style={styles.modalFoot}>
{editingGoalId && (
<button style={styles.btnDanger} onClick={onDeleteGoal}>
削除
</button>
)}
<button style={styles.btnSub} onClick={closeEditGoal}>
キャンセル
</button>
<button style={styles.btnPrimary} onClick={onSaveGoal}>
{editingGoalId ? "更新" : "追加"}
</button>
</div>
</div>
</div>
)}

{/* ===== Drilldown Modal ===== */}
{drillOpen && drillGoal && (
<div style={styles.drillOverlay} onClick={closeDrill} role="button">
<div style={styles.drillCard} onClick={(e) => e.stopPropagation()}>
<div style={styles.drillHeader}>
<div style={styles.drillHeaderTop}>
<div style={styles.drillTitle}>
{drillGoal.title}{" "}
<span style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
（{drillGoal.startMonth}〜{drillGoal.endMonth}）
</span>
</div>

<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
<button
style={styles.pillBtn}
onClick={() => {
// 目標の編集へ（このモーダル閉じずに開く）
openEditGoal(drillGoal);
}}
>
編集
</button>
<button style={styles.btnSub} onClick={closeDrill}>
閉じる
</button>
</div>
</div>

<div style={{ marginTop: 8, fontWeight: 900, color: "#334155" }}>
キーワード：{" "}
<span style={{ color: "#0b4aa2" }}>{(drillGoal.keyword || drillGoal.title || "").trim()}</span>
</div>

{/* stats */}
<div style={styles.statRow}>
<div style={styles.statCard}>
<div style={styles.statLabel}>現在</div>
<div style={styles.statValue}>{fmtYen(drillSaved)}</div>
</div>
<div style={styles.statCard}>
<div style={styles.statLabel}>目標</div>
<div style={styles.statValue}>{fmtYen(drillGoal.targetAmount)}</div>
</div>
<div style={styles.statCard}>
<div style={styles.statLabel}>残り</div>
<div style={styles.statValue}>{fmtYen(drillRemain)}</div>
</div>
<div style={styles.statCard}>
<div style={styles.statLabel}>月必要額</div>
<div style={styles.statValue}>{fmtYen(drillNeedPerMonth)}</div>
</div>
</div>

{/* progress */}
<div style={{ marginTop: 10 }}>
<div style={{ fontWeight: 900, color: "#334155" }}>{Math.round(drillProgressPct)}%</div>
<div
style={{
marginTop: 6,
position: "relative",
height: 18,
borderRadius: 999,
overflow: "hidden",
background: "#f1f5f9",
border: "1px solid #e2e8f0",
}}
>
<div
style={{
position: "absolute",
inset: 0,
width: `${clamp(drillProgressPct, 0, 100)}%`,
background: "linear-gradient(90deg, #16a34a 0%, #22c55e 100%)",
}}
/>
</div>
</div>

{/* mode toggle */}
<div style={styles.toggleRow}>
<button style={styles.toggleBtn(drillMode === "monthly")} onClick={() => setDrillMode("monthly")}>
月別
</button>
<button style={styles.toggleBtn(drillMode === "cumulative")} onClick={() => setDrillMode("cumulative")}>
累計
</button>
</div>
</div>

<div style={styles.drillBody}>
{drillExpensesLoading ? (
<div style={{ fontWeight: 900, color: "#64748b", textAlign: "center", padding: 18 }}>
読み込み中…
</div>
) : (
<>
<KakeiboLineChart
data={drillSeries}
maxValue={lineMax}
minValue={lineMin}
showDots={true}
onPointClick={(ym) => {
setDrillPickedMonth(ym);
setDrillDetailOpen(true);
}}
/>

{/* detail trigger */}
<div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
<div style={{ fontWeight: 900, color: "#334155" }}>
タップした月の明細を見る（{drillPickedMonth ? monthLabelJP(drillPickedMonth) : "未選択"}）
</div>
<button
style={styles.primaryBtn}
onClick={() => setDrillDetailOpen(true)}
disabled={!drillPickedMonth}
>
明細を開く
</button>
</div>

{/* detail month modal (inside drill card like simple section) */}
{drillDetailOpen && (
<div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden" }}>
<div
style={{
padding: 10,
background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
borderBottom: "1px solid #e5e7eb",
display: "flex",
justifyContent: "space-between",
alignItems: "center",
gap: 8,
}}
>
<div style={{ fontWeight: 900, color: "#0b4aa2" }}>
{drillPickedMonth ? monthLabelJP(drillPickedMonth) : ""}
</div>

<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
<select
value={drillPickedMonth}
onChange={(e) => setDrillPickedMonth(e.target.value)}
style={{ height: 34, borderRadius: 10, border: "1px solid #cbd5e1", padding: "0 8px", fontWeight: 900 }}
>
{drillMonths.map((ym) => (
<option key={ym} value={ym}>
{ym}
</option>
))}
</select>

<button style={styles.btnSub} onClick={() => setDrillDetailOpen(false)}>
閉じる
</button>
</div>
</div>

<div style={{ padding: 10 }}>
<div style={{ fontWeight: 900, color: "#334155" }}>
件数 {drillMonthRows.length} / 合計 {fmtYen(drillMonthTotal)}
</div>

{drillMonthRows.length === 0 ? (
<div style={{ marginTop: 10, fontWeight: 900, color: "#64748b", textAlign: "center", padding: 18 }}>
該当明細なし
</div>
) : (
<div style={{ marginTop: 10 }}>
<div style={styles.tableHeader}>
<div>日付</div>
<div>内訳</div>
<div>金額</div>
</div>

{drillMonthRows.map((r) => (
<div key={r.id} style={styles.tableRow}>
<div style={{ whiteSpace: "nowrap" }}>{isValidYMD(r.date) ? r.date : "-"}</div>
<div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
{r.subCategory}
</div>
<div style={{ whiteSpace: "nowrap" }}>{fmtYen(r.amount)}</div>
</div>
))}

<div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8 }}>
<button style={styles.pillBtn} onClick={() => router.push("/expense")}>
支出ページで修正する
</button>
</div>
</div>
)}
</div>
</div>
)}

{/* quick archive */}
<div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
<div style={{ fontWeight: 900, color: "#64748b", fontSize: 12 }}>
※ この目標は「積立」カテゴリの自由入力（内訳）に、キーワードが含まれる明細を合算しています
</div>

<button
style={styles.smallBtn}
onClick={() => onArchiveToggle(drillGoal, !Boolean(drillGoal.archived))}
>
{drillGoal.archived ? "アーカイブ解除" : "アーカイブする"}
</button>
</div>
</>
)}
</div>
</div>
</div>
)}
</div>
);
}