// pages/expense.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
addDoc,
collection,
deleteDoc,
doc,
getDocs,
limit,
orderBy,
query,
serverTimestamp,
updateDoc,
where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { CATEGORIES, SUBCATEGORIES, EXPENSE_SOURCES, REGISTRANTS } from "../lib/masterData";

/**
* 支出ページ（完成版 / 置き換え用）
*
* 追加仕様（今回）:
* - 1段目：登録者ごとの「最終登録日」カード（将哉/未有）
* - 3日以上空いてたら赤
* - タップで登録者フィルター（既存のフィルター解除で解除）
* - 登録フォームの「登録者」はプルダウン → 将哉/未有カード選択
* - 登録後も登録者は保持（他の入力欄はクリア）
* - 一番直近で登録/更新した明細行をハイライト
* - 2段目：← / 月ホイール / → / 登録ボタン（矢印で1ヶ月移動）
* - 3段目：合計（フィルター結果の合計）
* - 1〜3段目は固定表示、明細リストだけスクロール
*
* 既存必須:
* - 登録項目: registrant/date/amount(整数・マイナス可)/category/subCategory/source/memo?
* - month(YYYY-MM) を必ず保存
* - 青基調 / iPhone14幅に収まる / 数値は3桁カンマ&中央揃え
* - 一覧: 月で取得、明細タップで編集モーダル、削除はアラート必須
* - 「自由入力」内訳: 選択時は自由入力欄を表示し、その文字列を subCategory として保存
* - フィルター: ヘッダー(列タイトル)タップでUI、解除ボタンは登録ボタン横、合計はフィルター後で再計算
*/

type ExpenseDoc = {
id: string;
registrant: string;
date: string; // YYYY-MM-DD
month: string; // YYYY-MM
amount: number;
category: string;
subCategory: string;
source: string;
memo?: string;
};

const FREE_LABEL = "自由入力";

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
function tsToYMD(ts: any) {
if (!ts) return "";
try {
// Firestore Timestamp
if (typeof ts.toDate === "function") {
const d = ts.toDate() as Date;
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
const dd = String(d.getDate()).padStart(2, "0");
return `${y}-${m}-${dd}`;
}
// Date
if (ts instanceof Date) {
const y = ts.getFullYear();
const m = String(ts.getMonth() + 1).padStart(2, "0");
const dd = String(ts.getDate()).padStart(2, "0");
return `${y}-${m}-${dd}`;
}
} catch {}
return "";
}
function todayYMD() {
const d = new Date();
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
const dd = String(d.getDate()).padStart(2, "0");
return `${y}-${m}-${dd}`;
}
function fmtYen(n: number) {
const r = Math.round(Number(n) || 0);
const sign = r < 0 ? "▲" : "";
const abs = Math.abs(r);
return `${sign}¥${new Intl.NumberFormat("ja-JP").format(abs)}`;
}
function toMonth(ymd: string) {
return (ymd || "").slice(0, 7);
}
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
function addMonthsYM(ym: string, diff: number) {
const [y, m] = ym.split("-").map((x) => Number(x));
const d = new Date(y, (m - 1) + diff, 1);
const yy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, "0");
return `${yy}-${mm}`;
}
function fmtMD(ymd: string) {
if (!ymd || ymd.length < 10) return "";
return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}
function diffDays(fromYMD: string, toYMD: string) {
// from/to: YYYY-MM-DD
if (!fromYMD || !toYMD) return Infinity;
const [fy, fm, fd] = fromYMD.split("-").map(Number);
const [ty, tm, td] = toYMD.split("-").map(Number);
const a = new Date(fy, fm - 1, fd).getTime();
const b = new Date(ty, tm - 1, td).getTime();
const ms = b - a;
return Math.floor(ms / (1000 * 60 * 60 * 24));
}

type HeaderKey = "date" | "amount" | "category" | "subCategory" | "source" | null;

export default function ExpensePage() {
// responsive
const [wide, setWide] = useState(false);
useEffect(() => {
const on = () => setWide(window.innerWidth >= 768);
on();
window.addEventListener("resize", on);
return () => window.removeEventListener("resize", on);
}, []);

// month select
const [month, setMonth] = useState(ymToday());

// data
const [rows, setRows] = useState<ExpenseDoc[]>([]);
const [loading, setLoading] = useState(true);

// create/edit modal
const [open, setOpen] = useState(false);
const [editingId, setEditingId] = useState<string | null>(null);

// form
const [registrant, setRegistrant] = useState<string>(() => {
// 初期は将哉優先（REGISTRANTSに無ければ先頭）
if (REGISTRANTS.includes("将哉")) return "将哉";
if (REGISTRANTS.length) return REGISTRANTS[0];
return "";
});
const [date, setDate] = useState<string>(todayYMD());
const [amountText, setAmountText] = useState<string>("");
const [isMinus, setIsMinus] = useState<boolean>(false);
const [category, setCategory] = useState<string>("");
const [subCategorySelect, setSubCategorySelect] = useState<string>("");
const [source, setSource] = useState<string>("");
const [memo, setMemo] = useState<string>("");

// validation
const [touched, setTouched] = useState<Record<string, boolean>>({});

// filter UI (header tap)
const [filterHeader, setFilterHeader] = useState<HeaderKey>(null);
const [filterOpen, setFilterOpen] = useState(false);

// filters
const [filterDateFrom, setFilterDateFrom] = useState("");
const [filterDateTo, setFilterDateTo] = useState("");
const [filterAmountMin, setFilterAmountMin] = useState("");
const [filterAmountMax, setFilterAmountMax] = useState("");
const [filterCategory, setFilterCategory] = useState<string>("");
const [filterSubCategory, setFilterSubCategory] = useState<string>("");
const [filterSource, setFilterSource] = useState<string>("");
const [filterRegistrant, setFilterRegistrant] = useState<string>("");

const filterActive = useMemo(() => {
return Boolean(
filterDateFrom ||
filterDateTo ||
filterAmountMin ||
filterAmountMax ||
filterCategory ||
filterSubCategory ||
filterSource ||
filterRegistrant
);
}, [
filterDateFrom,
filterDateTo,
filterAmountMin,
filterAmountMax,
filterCategory,
filterSubCategory,
filterSource,
filterRegistrant,
]);

const clearFilters = () => {
setFilterDateFrom("");
setFilterDateTo("");
setFilterAmountMin("");
setFilterAmountMax("");
setFilterCategory("");
setFilterSubCategory("");
setFilterSource("");
setFilterRegistrant("");
setFilterHeader(null);
setFilterOpen(false);
};

const openFilter = (key: HeaderKey) => {
setFilterHeader(key);
setFilterOpen(true);
};
const closeFilter = () => setFilterOpen(false);

// options
const subCategoryOptions = useMemo(() => {
if (!category) return [];
const list = SUBCATEGORIES?.[category] ?? [];
const withoutFree = list.filter((s) => s !== FREE_LABEL);
return [...withoutFree, FREE_LABEL];
}, [category]);

const filterSubOptions = useMemo(() => {
if (!filterCategory) return [];
const list = SUBCATEGORIES?.[filterCategory] ?? [];
const withoutFree = list.filter((s) => s !== FREE_LABEL);
return ["", ...withoutFree, FREE_LABEL];
}, [filterCategory]);

// load expenses by month
const load = async (targetMonth: string) => {
setLoading(true);
try {
const qExp = query(collection(db, "expenses"), where("month", "==", targetMonth));
const snap = await getDocs(qExp);
const list: ExpenseDoc[] = snap.docs
.map((d) => {
const data = d.data() as any;
return {
id: d.id,
registrant: data.registrant ?? "",
date: data.date ?? "",
month: data.month ?? "",
amount: Number(data.amount ?? 0),
category: data.category ?? "",
subCategory: data.subCategory ?? "",
source: data.source ?? "",
memo: data.memo ?? "",
} as ExpenseDoc;
})
.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // 新しい順
setRows(list);
} catch (e) {
console.error(e);
setRows([]);
} finally {
setLoading(false);
}
};

useEffect(() => {
load(month);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [month]);

// filtered rows
const filteredRows = useMemo(() => {
return rows.filter((r) => {
if (filterRegistrant && r.registrant !== filterRegistrant) return false;
if (filterCategory && r.category !== filterCategory) return false;

if (filterSubCategory) {
if (filterSubCategory === FREE_LABEL) {
if (!r.category) return false;
const master = SUBCATEGORIES?.[r.category] ?? [];
const masterWithoutFree = master.filter((s) => s !== FREE_LABEL);
if (masterWithoutFree.includes(r.subCategory)) return false;
if (!r.subCategory || r.subCategory === FREE_LABEL) return false;
} else {
if (r.subCategory !== filterSubCategory) return false;
}
}

if (filterSource && r.source !== filterSource) return false;

if (filterDateFrom && r.date < filterDateFrom) return false;
if (filterDateTo && r.date > filterDateTo) return false;

const abs = Math.abs(Number(r.amount) || 0);
if (filterAmountMin) {
const mn = Number(digitsOnly(filterAmountMin));
if (Number.isFinite(mn) && abs < mn) return false;
}
if (filterAmountMax) {
const mx = Number(digitsOnly(filterAmountMax));
if (Number.isFinite(mx) && abs > mx) return false;
}

return true;
});
}, [
rows,
filterRegistrant,
filterCategory,
filterSubCategory,
filterSource,
filterDateFrom,
filterDateTo,
filterAmountMin,
filterAmountMax,
]);

const total = useMemo(
() => filteredRows.reduce((a, b) => a + (Number(b.amount) || 0), 0),
[filteredRows]
);

// ---- 最終登録日カード（将哉/未有） ----
const PERSONS = useMemo(() => {
const base = ["将哉", "未有"];
// masterDataが違っても壊れないように保険（存在するやつだけ出す）
return base.filter((x) => REGISTRANTS.includes(x));
}, []);
const [lastDates, setLastDates] = useState<Record<string, string>>({}); // registrant -> YYYY-MM-DD

const fetchLatestDateFor = async (name: string) => {
try {
const q = query(
collection(db, "expenses"),
where("registrant", "==", name)
);
const snap = await getDocs(q);

// date(YYYY-MM-DD) の最大を取る（文字列比較でOK）
let latest = "";
for (const docSnap of snap.docs) {
const d = docSnap.data() as any;
const ymd = String(d?.date ?? "");
if (ymd && ymd.length >= 10) {
if (!latest || ymd > latest) latest = ymd;
}
}
return latest;
} catch (e) {
console.error(e);
return "";
}
};


const refreshLastDates = async () => {
const entries = await Promise.all(
PERSONS.map(async (p) => [p, await fetchLatestDateFor(p)] as const)
);
const out: Record<string, string> = {};
for (const [p, d] of entries) out[p] = d;
setLastDates(out);
};

useEffect(() => {
refreshLastDates();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// ---- 直近ハイライト ----
const [lastTouchedId, setLastTouchedId] = useState<string | null>(null);
const lastTouchedIdRef = useRef<string | null>(null);
useEffect(() => {
lastTouchedIdRef.current = lastTouchedId;
}, [lastTouchedId]);

// open new
const openNew = () => {
setEditingId(null);
setTouched({});
// ✅登録者は保持（要求）
setDate(todayYMD());
setAmountText("");
setIsMinus(false);
setCategory("");
setSubCategorySelect("");
setSource("");
setMemo("");
setOpen(true);
};

// open edit
const openEdit = (r: ExpenseDoc) => {
setEditingId(r.id);
setTouched({});
setRegistrant(r.registrant || registrant || "");
setDate(r.date || "");
setIsMinus((Number(r.amount) || 0) < 0);
setAmountText(formatWithCommaDigits(String(Math.abs(Number(r.amount) || 0))));
setCategory(r.category || "");

const list = SUBCATEGORIES?.[r.category] ?? [];
if (list.includes(r.subCategory)) {
setSubCategorySelect(r.subCategory);
setMemo(r.memo || "");
} else {
setSubCategorySelect(FREE_LABEL);
setMemo(r.subCategory || "");
}

setSource(r.source || "");
setOpen(true);
};

// required check
const finalSubCategory = useMemo(() => {
if (!subCategorySelect) return "";
if (subCategorySelect === FREE_LABEL) return (memo || "").trim();
return subCategorySelect;
}, [subCategorySelect, memo]);

const amountValue = useMemo(
() => parseAmountFromText(amountText, isMinus),
[amountText, isMinus]
);

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

const onSubmit = async () => {
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

const body = {
registrant,
date,
month: toMonth(date),
amount: Math.trunc(amountValue),
category,
subCategory: finalSubCategory,
source,
memo: memo || "",
updatedAt: serverTimestamp(),
};

try {
if (editingId) {
await updateDoc(doc(db, "expenses", editingId), body as any);
setLastTouchedId(editingId);
} else {
const ref = await addDoc(collection(db, "expenses"), {
...body,
createdAt: serverTimestamp(),
updatedAt: serverTimestamp(), // ← ★追加
} as any);
setLastTouchedId(ref.id);
}

setOpen(false);

// ✅最終登録日カード更新（要求：登録都度判定）
await refreshLastDates();

// ✅リスト再読込
await load(month);

// ✅登録者は保持、他はクリア（ただしモーダルは閉じるので次回openNewでクリア）
// ここでは何もしない（registrant stateは保持されてる）
} catch (e) {
console.error(e);
alert("保存に失敗しました。");
}
};

const onDelete = async () => {
if (!editingId) return;
const ok = confirm("この明細を削除しますか？");
if (!ok) return;
try {
await deleteDoc(doc(db, "expenses", editingId));
setOpen(false);

if (lastTouchedIdRef.current === editingId) setLastTouchedId(null);

await refreshLastDates();
await load(month);
} catch (e) {
console.error(e);
alert("削除に失敗しました。");
}
};

// amount input handlers
const onChangeAmount = (v: string) => {
const formatted = formatWithCommaDigits(v);
setAmountText(formatted);
if (!touched.amount) setTouched((t) => ({ ...t, amount: true }));
};

const toggleMinus = () => {
setIsMinus((p) => !p);
if (!touched.amount) setTouched((t) => ({ ...t, amount: true }));
};

// list grid
const LIST_GRID_MOBILE = "52px 78px 64px 64px 1fr";
const LIST_GRID_WIDE = "64px 96px 90px 110px 1fr";
const listGrid = wide ? LIST_GRID_WIDE : LIST_GRID_MOBILE;

// filter header highlight
const headerActive = (key: HeaderKey) => {
if (key === "date") return Boolean(filterDateFrom || filterDateTo);
if (key === "amount") return Boolean(filterAmountMin || filterAmountMax);
if (key === "category") return Boolean(filterCategory || filterRegistrant);
if (key === "subCategory") return Boolean(filterSubCategory);
if (key === "source") return Boolean(filterSource || filterRegistrant);
return false;
};

const styles = useMemo(() => {
const baseInput: React.CSSProperties = {
width: "100%",
height: 36,
borderRadius: 10,
border: "1px solid #cbd5e1",
padding: "0 10px",
fontSize: 13,
background: "#fff",
outline: "none",
};

const smallInput: React.CSSProperties = {
...baseInput,
height: 34,
padding: "0 8px",
fontSize: 12,
};

const errorBorder: React.CSSProperties = {
border: "2px solid #dc2626",
background: "#fff5f5",
};

const cellCenter: React.CSSProperties = {
textAlign: "center",
fontWeight: 900,
fontSize: wide ? 12 : 11,
padding: "0 2px",
whiteSpace: "nowrap",
fontVariantNumeric: "tabular-nums",
color: "#0f172a",
};

const stickyWrap: React.CSSProperties = {
position: "sticky",
top: 0,
zIndex: 5,
background: "#f8fafc",
paddingBottom: 10,
};

return {
page: {
padding: 12,
maxWidth: 1100,
margin: "0 auto",
fontFamily:
'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Arial',
color: "#0f172a",
height: "100dvh",
display: "flex",
flexDirection: "column",
background: "#f8fafc",
} as React.CSSProperties,

title: { fontSize: 18, fontWeight: 900, color: "#0b4aa2" } as React.CSSProperties,

card: {
background: "#fff",
border: "1px solid #e5e7eb",
borderRadius: 14,
padding: 10,
boxShadow: "0 6px 18px rgba(15, 23, 42, 0.05)",
} as React.CSSProperties,

// ===== fixed 1~3 rows =====
stickyWrap,

topBlock: {
...stickyWrap,
} as React.CSSProperties,

row1: {
...this,
} as any,

lastCardsRow: {
display: "grid",
gridTemplateColumns: "1fr 1fr",
gap: 8,
} as React.CSSProperties,

lastCard: (active: boolean, warn?: boolean): React.CSSProperties => {
if (warn) {
return {
position: "relative",
borderRadius: 16,
padding: 12,
border: "1px solid #fecaca",
background:
"linear-gradient(180deg, #fee2e2 0%, #ffffff 100%)",
boxShadow:
"0 6px 18px rgba(220,38,38,0.12)",
cursor: "pointer",
userSelect: "none",
transition: "all 0.2s ease",
};
}

return {
borderRadius: 14,
padding: 10,
border: "1px solid " + (active ? "#93c5fd" : "#dbeafe"),
background: active
? "linear-gradient(180deg, #dbeafe 0%, #ffffff 100%)"
: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
cursor: "pointer",
userSelect: "none",
transition: "all 0.2s ease",
};
},

lastName: {
fontSize: 12,
fontWeight: 900,
color: "#1e3a8a",
marginBottom: 4,
} as React.CSSProperties,

lastDate: (warn: boolean): React.CSSProperties => ({
fontSize: 16,
fontWeight: 900,
textAlign: "center",
color: warn ? "#dc2626" : "#0f172a",
fontVariantNumeric: "tabular-nums",
}),

// row2
navRow: {
display: "flex",
alignItems: "center",
gap: 4,
marginTop: 10,
} as React.CSSProperties,

squareBtn: {
width: 40,
height: 34,
borderRadius: 12,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
} as React.CSSProperties,

monthInput: {
height: 34,
width: "100%",
padding: "0 4px",
fontSize: 12,
fontWeight: 900,
borderRadius: 10,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#0f172a",
} as React.CSSProperties,

btnBlue: {
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid #93c5fd",
background: "#1d4ed8",
color: "#fff",
fontWeight: 900,
cursor: "pointer",
whiteSpace: "nowrap",
fontSize: 12,
} as React.CSSProperties,

btnGhost: {
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
whiteSpace: "nowrap",
fontSize: 12,
} as React.CSSProperties,

btnRowRight: {
display: "flex",
gap: 6,
alignItems: "center",
justifyContent: "flex-end",
} as React.CSSProperties,

// row3
totalRow: {
marginTop: 10,
borderRadius: 14,
padding: "10px 12px",
background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
border: "1px solid #dbeafe",
fontWeight: 900,
fontVariantNumeric: "tabular-nums",
textAlign: "center",
} as React.CSSProperties,

// list header + list scroll area
listHead: {
display: "grid",
gridTemplateColumns: listGrid,
gap: 4,
padding: "6px 6px",
borderRadius: 10,
background: "#eff6ff",
border: "1px solid #dbeafe",
marginBottom: 6,
} as React.CSSProperties,

headCell: (active: boolean): React.CSSProperties => ({
textAlign: "center",
fontSize: 11,
fontWeight: 900,
padding: "4px 2px",
borderRadius: 8,
cursor: "pointer",
color: active ? "#0b4aa2" : "#334155",
background: active ? "#dbeafe" : "transparent",
whiteSpace: "nowrap",
userSelect: "none",
}),

listScroll: {
flex: 1,
overflowY: "auto",
paddingBottom: 10,
} as React.CSSProperties,

row: (cat: string, isHot: boolean): React.CSSProperties => ({
display: "grid",
gridTemplateColumns: listGrid,
gap: 4,
padding: "6px 6px 6px 10px",
borderRadius: 10,
border: isHot ? "2px solid #93c5fd" : "1px solid #e2e8f0",
background: isHot ? "#eff6ff" : "#fff",
position: "relative",
cursor: "pointer",
marginBottom: 6,
overflow: "hidden",
boxShadow: "0 1px 0 rgba(15,23,42,0.04)",
}),

rowAccent: (cat: string): React.CSSProperties => ({
position: "absolute",
left: 0,
top: 0,
bottom: 0,
width: 6,
background: colorOfCategory(cat),
}),

cellCenter,
cellLeft: {
textAlign: "left",
fontWeight: 900,
fontSize: wide ? 12 : 11,
padding: "0 2px",
whiteSpace: "nowrap",
overflow: "hidden",
textOverflow: "ellipsis",
color: "#0f172a",
} as React.CSSProperties,

empty: {
padding: 12,
borderRadius: 14,
border: "1px solid #e2e8f0",
background: "#fff",
textAlign: "center",
color: "#0b4aa2",
fontWeight: 900,
} as React.CSSProperties,

// modal
overlay: {
position: "fixed",
inset: 0,
background: "rgba(2,6,23,0.45)",
zIndex: 50,
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

input: baseInput,
inputSmall: smallInput,
errorBorder,

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

// registrant cards in modal
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
background: active
? "linear-gradient(180deg, #dbeafe 0%, #ffffff 100%)"
: "#ffffff",
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

// filter modal
filterHint: { fontSize: 12, fontWeight: 800, color: "#334155" } as React.CSSProperties,
};
}, [wide, listGrid]);

// chips
const activeFilterChips = useMemo(() => {
const chips: { label: string }[] = [];
if (filterRegistrant) chips.push({ label: `登録者:${filterRegistrant}` });
if (filterCategory) chips.push({ label: `カテゴリ:${filterCategory}` });
if (filterSubCategory) chips.push({ label: `内訳:${filterSubCategory}` });
if (filterSource) chips.push({ label: `支出元:${filterSource}` });
if (filterDateFrom || filterDateTo)
chips.push({ label: `日付:${filterDateFrom || "…"}〜${filterDateTo || "…"}` });
if (filterAmountMin || filterAmountMax)
chips.push({ label: `金額:${filterAmountMin || "…"}〜${filterAmountMax || "…"}` });
return chips;
}, [
filterRegistrant,
filterCategory,
filterSubCategory,
filterSource,
filterDateFrom,
filterDateTo,
filterAmountMin,
filterAmountMax,
]);

const filterPanelTitle = useMemo(() => {
if (filterHeader === "date") return "日付（範囲）フィルター";
if (filterHeader === "amount") return "金額（範囲）フィルター";
if (filterHeader === "category") return "カテゴリ / 登録者 フィルター";
if (filterHeader === "subCategory") return "内訳 フィルター";
if (filterHeader === "source") return "支出元 / 登録者 フィルター";
return "フィルター";
}, [filterHeader]);

const stop = (e: React.MouseEvent) => e.stopPropagation();

// ---- 最終登録日カード表示用 ----
const today = useMemo(() => todayYMD(), []);
const lastInfo = useMemo(() => {
return PERSONS.map((p) => {
const d = lastDates[p] || "";
const gap = d ? diffDays(d, today) : Infinity;
const warn = gap >= 3;
return { p, d, warn };
});
}, [PERSONS, lastDates, today]);

const applyRegistrantFilterFromCard = (p: string) => {
setFilterRegistrant((prev) => (prev === p ? "" : p));
};

return (
<div style={styles.page}>
{/* ===== 固定エリア（1〜3段 + リストヘッダ） ===== */}
<div style={styles.topBlock}>
<div style={styles.title}>支出</div>

<div style={{ ...styles.card, marginTop: 10 }}>
{/* 1段目：最終登録日 */}
<div style={styles.lastCardsRow}>
{lastInfo.map(({ p, d, warn }) => {
const active = filterRegistrant === p;
return (
<div
key={p}
style={styles.lastCard(active,warn)}
onClick={() => applyRegistrantFilterFromCard(p)}
role="button"
>
{warn && (
<div
style={{
position: "absolute",
left: 0,
top: 0,
bottom: 0,
width: 6,
background: "#dc2626",
borderTopLeftRadius: 16,
borderBottomLeftRadius: 16,
}}
/>
)}
<div style={styles.lastName}>{p} 最終登録日</div>
<div style={styles.lastDate(warn)}>
{d ? fmtMD(d) : "—"}
</div>
</div>
);
})}
</div>

{/* 2段目：← 月 → 登録（＋フィルター解除） */}
<div style={styles.navRow}>
<button
style={styles.squareBtn}
onClick={() => setMonth((m) => addMonthsYM(m, -1))}
aria-label="prev-month"
>
←
</button>

<input
type="month"
value={month}
onChange={(e) => setMonth(e.target.value)}
style={styles.monthInput}
aria-label="month"
/>

<button
style={styles.squareBtn}
onClick={() => setMonth((m) => addMonthsYM(m, 1))}
aria-label="next-month"
>
→
</button>

<div style={styles.btnRowRight}>
{filterActive && (
<button style={styles.btnGhost} onClick={clearFilters}>
フィルター解除
</button>
)}
<button style={styles.btnBlue} onClick={openNew}>
登録
</button>
</div>
</div>

{/* 3段目：合計 */}
<div style={styles.totalRow}>合計 {fmtYen(total)}</div>

{/* フィルター適用チップ（任意だけど便利） */}
{filterActive && activeFilterChips.length > 0 && (
<div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
{activeFilterChips.map((c, i) => (
<div
key={i}
style={{
borderRadius: 999,
padding: "6px 10px",
border: "1px solid #93c5fd",
background: "#dbeafe",
color: "#0b4aa2",
fontWeight: 900,
fontSize: 12,
}}
>
{c.label}
</div>
))}
</div>
)}
</div>

{/* List header */}
<div style={{ ...styles.listHead, marginTop: 10 }}>
<div style={styles.headCell(headerActive("date"))} onClick={() => openFilter("date")}>
日付
</div>
<div style={styles.headCell(headerActive("amount"))} onClick={() => openFilter("amount")}>
金額
</div>
<div style={styles.headCell(headerActive("category"))} onClick={() => openFilter("category")}>
カテゴリ
</div>
<div style={styles.headCell(headerActive("subCategory"))} onClick={() => openFilter("subCategory")}>
内訳
</div>
<div style={styles.headCell(headerActive("source"))} onClick={() => openFilter("source")}>
支出元
</div>
</div>
</div>

{/* ===== スクロールする明細リスト ===== */}
<div style={styles.listScroll}>
{loading ? (
<div style={styles.empty}>読み込み中…</div>
) : filteredRows.length === 0 ? (
<div style={styles.empty}>この月はデータがありません</div>
) : (
<div>
{filteredRows.map((r) => {
const isHot = !!lastTouchedId && r.id === lastTouchedId;
return (
<div
key={r.id}
style={styles.row(r.category, isHot)}
onClick={() => openEdit(r)}
role="button"
>
<div style={styles.rowAccent(r.category)} />
<div style={styles.cellCenter}>{r.date.slice(5).replace("-", "/")}</div>
<div style={styles.cellCenter}>{fmtYen(r.amount)}</div>
<div style={styles.cellCenter}>{r.category}</div>
<div style={styles.cellCenter}>{r.subCategory}</div>
<div style={styles.cellLeft}>{r.source}</div>
</div>
);
})}
</div>
)}
</div>

{/* ===== Create/Edit Modal ===== */}
{open && (
<div style={styles.overlay} onClick={() => setOpen(false)} role="dialog" aria-modal="true">
<div style={styles.modal} onClick={stop}>
<div style={styles.modalHead}>
<div style={styles.modalTitle}>{editingId ? "明細の編集" : "支出の登録"}</div>
<button style={styles.btnSub} onClick={() => setOpen(false)}>
閉じる
</button>
</div>

<div style={styles.modalBody}>
{/* 登録者カード（プルダウン廃止） */}
<div>
<div style={styles.label}>登録者（必須）</div>
<div style={styles.regCardRow}>
{["将哉", "未有"].map((p) => {
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
style={{
...styles.input,
...(touched.date && missing.date ? styles.errorBorder : {}),
}}
/>
</div>

{/* source */}
<div>
<div style={styles.label}>支出元（必須）</div>
<select
value={source}
onChange={(e) => setSource(e.target.value)}
onBlur={() => setTouched((t) => ({ ...t, source: true }))}
style={{
...styles.input,
...(touched.source && missing.source ? styles.errorBorder : {}),
}}
>
<option value="">選択</option>
{EXPENSE_SOURCES.map((s) => (
<option key={s} value={s}>
{s}
</option>
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
<div
style={{
marginTop: 4,
fontSize: 12,
fontWeight: 900,
textAlign: "center",
color: "#334155",
}}
>
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
style={{
...styles.input,
...(touched.category && missing.category ? styles.errorBorder : {}),
}}
>
<option value="">選択</option>
{CATEGORIES.map((c) => (
<option key={c} value={c}>
{c}
</option>
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
{subCategoryOptions.map((s) => (
<option key={s} value={s}>
{s}
</option>
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
style={{
...styles.input,
...(touched.subCategory && missing.subCategory ? styles.errorBorder : {}),
}}
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
{editingId && (
<button style={styles.btnDanger} onClick={onDelete}>
削除
</button>
)}
<button style={styles.btnSub} onClick={() => setOpen(false)}>
キャンセル
</button>
<button style={styles.btnPrimary} onClick={onSubmit}>
{editingId ? "更新" : "登録"}
</button>
</div>
</div>
</div>
)}

{/* ===== Filter Modal ===== */}
{filterOpen && (
<div style={styles.overlay} onClick={closeFilter} role="dialog" aria-modal="true">
<div style={styles.modal} onClick={stop}>
<div style={styles.modalHead}>
<div style={styles.modalTitle}>{filterPanelTitle}</div>
<button style={styles.btnSub} onClick={closeFilter}>
閉じる
</button>
</div>

<div style={styles.modalBody}>
{filterHeader === "date" && (
<div>
<div style={styles.filterHint}>日付の範囲を指定できます</div>
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
<div>
<div style={styles.label}>FROM</div>
<input
type="date"
value={filterDateFrom}
onChange={(e) => setFilterDateFrom(e.target.value)}
style={styles.input}
/>
</div>
<div>
<div style={styles.label}>TO</div>
<input
type="date"
value={filterDateTo}
onChange={(e) => setFilterDateTo(e.target.value)}
style={styles.input}
/>
</div>
</div>
</div>
)}

{filterHeader === "amount" && (
<div>
<div style={styles.filterHint}>金額の範囲（絶対値）を指定できます</div>
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
<div>
<div style={styles.label}>最小</div>
<input
inputMode="numeric"
value={filterAmountMin}
onChange={(e) => setFilterAmountMin(formatWithCommaDigits(e.target.value))}
style={{ ...styles.input, textAlign: "center", fontWeight: 900 }}
placeholder="例: 1,000"
/>
</div>
<div>
<div style={styles.label}>最大</div>
<input
inputMode="numeric"
value={filterAmountMax}
onChange={(e) => setFilterAmountMax(formatWithCommaDigits(e.target.value))}
style={{ ...styles.input, textAlign: "center", fontWeight: 900 }}
placeholder="例: 20,000"
/>
</div>
</div>
</div>
)}

{filterHeader === "category" && (
<div>
<div style={styles.label}>カテゴリ</div>
<select
value={filterCategory}
onChange={(e) => {
const v = e.target.value;
setFilterCategory(v);
setFilterSubCategory("");
}}
style={styles.input}
>
<option value="">（指定なし）</option>
{CATEGORIES.map((c) => (
<option key={c} value={c}>
{c}
</option>
))}
</select>

<div style={{ marginTop: 10 }}>
<div style={styles.label}>登録者</div>
<select value={filterRegistrant} onChange={(e) => setFilterRegistrant(e.target.value)} style={styles.input}>
<option value="">（指定なし）</option>
{REGISTRANTS.map((r) => (
<option key={r} value={r}>
{r}
</option>
))}
</select>
</div>
</div>
)}

{filterHeader === "subCategory" && (
<div>
<div style={styles.filterHint}>内訳フィルターはカテゴリ選択後が便利です</div>

<div style={{ marginTop: 10 }}>
<div style={styles.label}>カテゴリ</div>
<select
value={filterCategory}
onChange={(e) => {
const v = e.target.value;
setFilterCategory(v);
setFilterSubCategory("");
}}
style={styles.input}
>
<option value="">（指定なし）</option>
{CATEGORIES.map((c) => (
<option key={c} value={c}>
{c}
</option>
))}
</select>
</div>

<div style={{ marginTop: 10 }}>
<div style={styles.label}>内訳</div>
<select
value={filterSubCategory}
onChange={(e) => setFilterSubCategory(e.target.value)}
style={styles.input}
disabled={!filterCategory}
>
<option value="">（指定なし）</option>
{filterSubOptions.map((s) => (
<option key={s || "(none)"} value={s}>
{s || "（指定なし）"}
</option>
))}
</select>
</div>
</div>
)}

{filterHeader === "source" && (
<div>
<div style={styles.label}>支出元</div>
<select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} style={styles.input}>
<option value="">（指定なし）</option>
{EXPENSE_SOURCES.map((s) => (
<option key={s} value={s}>
{s}
</option>
))}
</select>

<div style={{ marginTop: 10 }}>
<div style={styles.label}>登録者</div>
<select value={filterRegistrant} onChange={(e) => setFilterRegistrant(e.target.value)} style={styles.input}>
<option value="">（指定なし）</option>
{REGISTRANTS.map((r) => (
<option key={r} value={r}>
{r}
</option>
))}
</select>
</div>
</div>
)}
</div>

<div style={styles.modalFoot}>
{filterActive && (
<button style={styles.btnDanger} onClick={clearFilters}>
解除
</button>
)}
<button style={styles.btnSub} onClick={closeFilter}>
OK
</button>
</div>
</div>
</div>
)}
</div>
);
}