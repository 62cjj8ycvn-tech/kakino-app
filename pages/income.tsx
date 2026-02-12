// pages/income.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
addDoc,
collection,
deleteDoc,
doc,
getDocs,
query,
serverTimestamp,
updateDoc,
where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { REGISTRANTS } from "../lib/masterData";

/**
* 収入ページ（支出ページUI準拠 / 置き換え用）
*
* 追加（今回）:
* - ナビを「←、カレンダー(ホイール)、→、登録」に変更
* - 2段目に合計金額を表示
* - 明細一覧に「メモ」を追加（収入元と登録者の間）
*
* 既存:
* - オレンジ基調
* - iPhone14幅に収まる（横スクロールなし）
* - 登録はモーダル、必須未入力は alert + 赤枠
* - 削除は confirm 必須
* - フィルターはヘッダー(列タイトル)タップ → フィルターモーダル
* 日付/金額は範囲指定、フィルター解除は「登録」横
* - Firestore:
* collection: incomes
* fields: registrant/date/amount/source/memo?/createdAt/updatedAt
*/

type IncomeDoc = {
id: string;
registrant: string; // 登録者（将哉/未有）
date: string; // YYYY-MM-DD
amount: number; // 正の整数のみ
source: string; // 収入元（将哉/未有/その他）
memo?: string;
};

const INCOME_SOURCES = ["将哉", "未有", "その他"] as const;

function ymToday() {
const d = new Date();
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
return `${y}-${m}`;
}
function fmtYen(n: number) {
const r = Math.round(Number(n) || 0);
const abs = Math.abs(r);
return `¥${new Intl.NumberFormat("ja-JP").format(abs)}`;
}
function digitsOnly(s: string) {
return (s || "").replace(/[^\d]/g, "");
}
function formatWithCommaDigits(s: string) {
const d = digitsOnly(s);
if (!d) return "";
return new Intl.NumberFormat("ja-JP").format(Number(d));
}
function parsePositiveInt(amountText: string) {
const d = digitsOnly(amountText);
if (!d) return NaN;
const n = Number(d);
if (!Number.isFinite(n)) return NaN;
const i = Math.trunc(n);
if (i <= 0) return NaN;
return i;
}
function monthOfYMD(ymd: string) {
return (ymd || "").slice(0, 7);
}
function addMonthsYM(ym: string, diff: number) {
const [y, m] = ym.split("-").map((x) => Number(x));
const d = new Date(y, (m - 1) + diff, 1);
const yy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, "0");
return `${yy}-${mm}`;
}

type HeaderKey = "date" | "amount" | "source" | "memo" | "registrant" | null;

export default function IncomePage() {
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
const [rows, setRows] = useState<IncomeDoc[]>([]);
const [loading, setLoading] = useState(true);

// modal
const [open, setOpen] = useState(false);
const [editingId, setEditingId] = useState<string | null>(null);

// form
const [registrant, setRegistrant] = useState<string>("");
const [date, setDate] = useState<string>("");
const [amountText, setAmountText] = useState<string>("");
const [source, setSource] = useState<string>("");
const [memo, setMemo] = useState<string>("");

// validation
const [touched, setTouched] = useState<Record<string, boolean>>({});

// filter UI
const [filterHeader, setFilterHeader] = useState<HeaderKey>(null);
const [filterOpen, setFilterOpen] = useState(false);

// filters
const [filterDateFrom, setFilterDateFrom] = useState("");
const [filterDateTo, setFilterDateTo] = useState("");
const [filterAmountMin, setFilterAmountMin] = useState("");
const [filterAmountMax, setFilterAmountMax] = useState("");
const [filterSource, setFilterSource] = useState<string>("");
const [filterRegistrant, setFilterRegistrant] = useState<string>("");

const filterActive = useMemo(() => {
return Boolean(
filterDateFrom ||
filterDateTo ||
filterAmountMin ||
filterAmountMax ||
filterSource ||
filterRegistrant
);
}, [filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax, filterSource, filterRegistrant]);

const clearFilters = () => {
setFilterDateFrom("");
setFilterDateTo("");
setFilterAmountMin("");
setFilterAmountMax("");
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

// load
const load = async (targetMonth: string) => {
setLoading(true);
try {
const start = `${targetMonth}-01`;
const [y, m] = targetMonth.split("-").map((x) => Number(x));
const dNext = new Date(y, (m - 1) + 1, 1);
const yy = dNext.getFullYear();
const mm = String(dNext.getMonth() + 1).padStart(2, "0");
const next = `${yy}-${mm}-01`;

const qInc = query(
collection(db, "incomes"),
where("date", ">=", start),
where("date", "<", next)
);
const snap = await getDocs(qInc);
const list: IncomeDoc[] = snap.docs
.map((d) => {
const data = d.data() as any;
return {
id: d.id,
registrant: data.registrant ?? "",
date: data.date ?? "",
amount: Number(data.amount ?? 0),
source: data.source ?? "",
memo: data.memo ?? "",
} as IncomeDoc;
})
.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
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
if (filterSource && r.source !== filterSource) return false;

if (filterDateFrom && r.date < filterDateFrom) return false;
if (filterDateTo && r.date > filterDateTo) return false;

const v = Number(r.amount) || 0;
if (filterAmountMin) {
const mn = Number(digitsOnly(filterAmountMin));
if (Number.isFinite(mn) && v < mn) return false;
}
if (filterAmountMax) {
const mx = Number(digitsOnly(filterAmountMax));
if (Number.isFinite(mx) && v > mx) return false;
}
return true;
});
}, [rows, filterRegistrant, filterSource, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax]);

const total = useMemo(
() => filteredRows.reduce((a, b) => a + (Number(b.amount) || 0), 0),
[filteredRows]
);

// modal open new
const openNew = () => {
setEditingId(null);
setTouched({});
setRegistrant("");
setDate("");
setAmountText("");
setSource("");
setMemo("");
setOpen(true);
};

// modal open edit
const openEdit = (r: IncomeDoc) => {
setEditingId(r.id);
setTouched({});
setRegistrant(r.registrant || "");
setDate(r.date || "");
setAmountText(formatWithCommaDigits(String(Math.abs(Number(r.amount) || 0))));
setSource(r.source || "");
setMemo(r.memo || "");
setOpen(true);
};

// validation
const amountValue = useMemo(() => parsePositiveInt(amountText), [amountText]);

const missing = useMemo(() => {
const m: Record<string, boolean> = {};
m.registrant = !registrant;
m.date = !date;
m.amount = !amountText || !Number.isFinite(amountValue);
m.source = !source;
return m;
}, [registrant, date, amountText, amountValue, source]);

const hasMissing = useMemo(() => Object.values(missing).some(Boolean), [missing]);

const markAllTouched = () => {
setTouched({
registrant: true,
date: true,
amount: true,
source: true,
});
};

const onSubmit = async () => {
if (hasMissing) {
markAllTouched();
alert("未入力の必須項目があります。赤枠の項目を入力してください。");
return;
}
if (!Number.isFinite(amountValue) || amountValue <= 0) {
setTouched((t) => ({ ...t, amount: true }));
alert("金額が不正です（0不可・整数のみ・マイナス不可）。");
return;
}

const body = {
registrant,
date,
amount: Math.trunc(amountValue),
source,
memo: memo || "",
updatedAt: serverTimestamp(),
};

try {
if (editingId) {
await updateDoc(doc(db, "incomes", editingId), body as any);
} else {
await addDoc(collection(db, "incomes"), { ...body, createdAt: serverTimestamp() } as any);
}
setOpen(false);
await load(monthOfYMD(date) || month);
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
await deleteDoc(doc(db, "incomes", editingId));
setOpen(false);
await load(month);
} catch (e) {
console.error(e);
alert("削除に失敗しました。");
}
};

const onChangeAmount = (v: string) => {
setAmountText(formatWithCommaDigits(v));
if (!touched.amount) setTouched((t) => ({ ...t, amount: true }));
};

// list grid（メモ追加：日付/金額/収入元/メモ/登録者）
const LIST_GRID_MOBILE = "52px 78px 64px 1fr 54px";
const LIST_GRID_WIDE = "64px 96px 90px 1fr 70px";
const listGrid = wide ? LIST_GRID_WIDE : LIST_GRID_MOBILE;

const headerActive = (key: HeaderKey) => {
if (key === "date") return Boolean(filterDateFrom || filterDateTo);
if (key === "amount") return Boolean(filterAmountMin || filterAmountMax);
if (key === "source") return Boolean(filterSource);
if (key === "registrant") return Boolean(filterRegistrant);
// memo はフィルターなし（今は表示のみ）
return false;
};

const filterPanelTitle = useMemo(() => {
if (filterHeader === "date") return "日付（範囲）フィルター";
if (filterHeader === "amount") return "金額（範囲）フィルター";
if (filterHeader === "source") return "収入元 フィルター";
if (filterHeader === "registrant") return "登録者 フィルター";
return "フィルター";
}, [filterHeader]);

const stop = (e: React.MouseEvent) => e.stopPropagation();

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

return {
page: {
padding: 12,
maxWidth: 1100,
margin: "0 auto",
fontFamily:
'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Arial',
color: "#0f172a",
} as React.CSSProperties,

title: { fontSize: 18, fontWeight: 900, color: "#c2410c" } as React.CSSProperties,

card: {
background: "#fff",
border: "1px solid #e5e7eb",
borderRadius: 14,
padding: 10,
boxShadow: "0 6px 18px rgba(15, 23, 42, 0.05)",
} as React.CSSProperties,

// ✅ 1段目：← / month / → / buttons
navRow: {
display: "flex",
alignItems:"center",
gap: 4,
} as React.CSSProperties,

squareBtn: {
width: 40,
height: 34,
borderRadius: 12,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#c2410c",
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

btnOrange: {
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid #fdba74",
background: "#f97316",
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
color: "#c2410c",
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

// ✅ 2段目：合計
totalRow: {
marginTop: 10,
borderRadius: 14,
padding: "10px 12px",
background: "linear-gradient(180deg, #fff7ed 0%, #ffffff 100%)",
border: "1px solid #fed7aa",
fontWeight: 900,
fontVariantNumeric: "tabular-nums",
textAlign: "center",
} as React.CSSProperties,

listHead: {
display: "grid",
gridTemplateColumns: listGrid,
gap: 4,
padding: "6px 6px",
borderRadius: 10,
background: "#fff7ed",
border: "1px solid #fed7aa",
marginBottom: 6,
marginTop: 10,
} as React.CSSProperties,

headCell: (active: boolean): React.CSSProperties => ({
textAlign: "center",
fontSize: 11,
fontWeight: 900,
padding: "4px 2px",
borderRadius: 8,
cursor: "pointer",
color: active ? "#c2410c" : "#334155",
background: active ? "#ffedd5" : "transparent",
whiteSpace: "nowrap",
userSelect: "none",
}),

row: {
display: "grid",
gridTemplateColumns: listGrid,
gap: 4,
padding: "6px 6px",
borderRadius: 10,
border: "1px solid #e2e8f0",
background: "#fff",
cursor: "pointer",
marginBottom: 6,
overflow: "hidden",
boxShadow: "0 1px 0 rgba(15,23,42,0.04)",
} as React.CSSProperties,

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
color: "#c2410c",
fontWeight: 900,
marginTop: 10,
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
background: "linear-gradient(180deg, #fff7ed 0%, #ffffff 100%)",
borderBottom: "1px solid #fed7aa",
} as React.CSSProperties,

modalTitle: { fontSize: 14, fontWeight: 900, color: "#c2410c" } as React.CSSProperties,

modalBody: { padding: 12 } as React.CSSProperties,

grid: {
display: "grid",
gridTemplateColumns: wide ? "1fr 1fr" : "1fr",
gap: 10,
} as React.CSSProperties,

label: { fontSize: 12, fontWeight: 900, color: "#334155", marginBottom: 4 } as React.CSSProperties,

input: baseInput,
errorBorder,

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
border: "1px solid #fdba74",
background: "#f97316",
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
color: "#c2410c",
fontWeight: 900,
cursor: "pointer",
} as React.CSSProperties,

filterHint: { fontSize: 12, fontWeight: 800, color: "#334155" } as React.CSSProperties,
};
}, [wide, listGrid]);

return (
<div style={styles.page}>
<div style={styles.title}>収入</div>

{/* ✅ 1段目ナビ + 2段目合計 */}
<div style={{ ...styles.card, marginTop: 10 }}>
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
<button style={styles.btnOrange} onClick={openNew}>
登録
</button>
</div>
</div>

<div style={styles.totalRow}>合計 {fmtYen(total)}</div>
</div>

{/* header */}
<div style={styles.listHead}>
<div style={styles.headCell(headerActive("date"))} onClick={() => openFilter("date")}>
日付
</div>
<div style={styles.headCell(headerActive("amount"))} onClick={() => openFilter("amount")}>
金額
</div>
<div style={styles.headCell(headerActive("source"))} onClick={() => openFilter("source")}>
収入元
</div>
<div style={styles.headCell(false)}>{/* memoはフィルター無し */}メモ</div>
<div style={styles.headCell(headerActive("registrant"))} onClick={() => openFilter("registrant")}>
登録者
</div>
</div>

{/* list */}
{loading ? (
<div style={styles.empty}>読み込み中…</div>
) : filteredRows.length === 0 ? (
<div style={styles.empty}>この月はデータがありません</div>
) : (
<div style={{ marginTop: 6 }}>
{filteredRows.map((r) => (
<div key={r.id} style={styles.row} onClick={() => openEdit(r)} role="button">
<div style={styles.cellCenter}>{r.date.slice(5).replace("-", "/")}</div>
<div style={styles.cellCenter}>{fmtYen(r.amount)}</div>
<div style={styles.cellCenter}>{r.source}</div>
<div style={styles.cellLeft}>{(r.memo || "").trim() ? r.memo : "—"}</div>
<div style={styles.cellCenter}>{r.registrant}</div>
</div>
))}
</div>
)}

{/* modal */}
{open && (
<div style={styles.overlay} onClick={() => setOpen(false)} role="dialog" aria-modal="true">
<div style={styles.modal} onClick={(e) => e.stopPropagation()}>
<div style={styles.modalHead}>
<div style={styles.modalTitle}>{editingId ? "明細の編集" : "収入の登録"}</div>
<button style={styles.btnSub} onClick={() => setOpen(false)}>
閉じる
</button>
</div>

<div style={styles.modalBody}>
<div style={styles.grid}>
{/* registrant */}
<div>
<div style={styles.label}>登録者（必須）</div>
<select
value={registrant}
onChange={(e) => setRegistrant(e.target.value)}
onBlur={() => setTouched((t) => ({ ...t, registrant: true }))}
style={{
...styles.input,
...(touched.registrant && missing.registrant ? styles.errorBorder : {}),
}}
>
<option value="">選択</option>
{REGISTRANTS.map((r) => (
<option key={r} value={r}>
{r}
</option>
))}
</select>
</div>

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

{/* amount */}
<div>
<div style={styles.label}>金額（必須）</div>
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
<div style={{ marginTop: 4, fontSize: 12, fontWeight: 900, textAlign: "center", color: "#334155" }}>
{Number.isFinite(amountValue) ? fmtYen(amountValue) : "¥0"}
</div>
</div>

{/* source */}
<div>
<div style={styles.label}>収入元（必須）</div>
<select
value={source}
onChange={(e) => setSource(e.target.value)}
onBlur={() => setTouched((t) => ({ ...t, source: true }))}
style={{ ...styles.input, ...(touched.source && missing.source ? styles.errorBorder : {}) }}
>
<option value="">選択</option>
{INCOME_SOURCES.map((s) => (
<option key={s} value={s}>
{s}
</option>
))}
</select>
</div>

{/* memo */}
<div style={{ gridColumn: wide ? "1 / -1" : undefined }}>
<div style={styles.label}>メモ（任意）</div>
<input
value={memo}
onChange={(e) => setMemo(e.target.value)}
style={{ ...styles.input, height: 40 }}
placeholder="任意"
/>
</div>
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

{/* filter modal */}
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
<div style={styles.filterHint}>金額の範囲を指定できます</div>
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

{filterHeader === "source" && (
<div>
<div style={styles.label}>収入元</div>
<select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} style={styles.input}>
<option value="">（指定なし）</option>
{INCOME_SOURCES.map((s) => (
<option key={s} value={s}>
{s}
</option>
))}
</select>
</div>
)}

{filterHeader === "registrant" && (
<div>
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