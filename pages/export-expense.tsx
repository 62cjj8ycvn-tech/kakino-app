import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";

type ExpenseDoc = {
registrant: string;
date: string; // YYYY-MM-DD
month: string; // YYYY-MM
amount: number;
category: string;
subCategory: string;
source: string;
memo?: string;
};

function ymToday() {
const d = new Date();
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
return `${y}-${m}`;
}

function csvEscape(v: any) {
const s = String(v ?? "");
if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
return s;
}

function downloadCsv(filename: string, csv: string) {
// UTF-8 BOM (Excelで文字化けしにくい)
const bom = "\uFEFF";
const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = filename;
a.click();
URL.revokeObjectURL(url);
}

export default function ExportExpenseCsvPage() {
const [wide, setWide] = useState(false);
useEffect(() => {
const on = () => setWide(window.innerWidth >= 768);
on();
window.addEventListener("resize", on);
return () => window.removeEventListener("resize", on);
}, []);

const [month, setMonth] = useState(ymToday());
const [loading, setLoading] = useState(false);
const [rows, setRows] = useState<ExpenseDoc[]>([]);
const [err, setErr] = useState<string>("");

const load = async () => {
setLoading(true);
setErr("");
try {
const q = query(collection(db, "expenses"), where("month", "==", month));
const snap = await getDocs(q);
const list: ExpenseDoc[] = snap.docs
.map((d) => d.data() as any)
.map((x) => ({
registrant: x.registrant ?? "",
date: x.date ?? "",
month: x.month ?? "",
amount: Number(x.amount ?? 0),
category: x.category ?? "",
subCategory: x.subCategory ?? "",
source: x.source ?? "",
memo: x.memo ?? "",
}))
.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
setRows(list);
} catch (e: any) {
console.error(e);
setErr("読み込みに失敗しました。");
setRows([]);
} finally {
setLoading(false);
}
};

useEffect(() => {
load();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [month]);

const total = useMemo(() => rows.reduce((a, b) => a + (Number(b.amount) || 0), 0), [rows]);

const onExport = () => {
const header = ["date", "registrant", "amount", "category", "subCategory", "source", "memo"];
const lines = [header.join(",")];

for (const r of rows) {
const line = [
csvEscape(r.date),
csvEscape(r.registrant),
csvEscape(r.amount),
csvEscape(r.category),
csvEscape(r.subCategory),
csvEscape(r.source),
csvEscape(r.memo ?? ""),
].join(",");
lines.push(line);
}

const csv = lines.join("\n");
downloadCsv(`expenses_${month}.csv`, csv);
};

const styles = useMemo(() => {
const input: React.CSSProperties = {
height: 34,
width: wide ? 170 : 145,
padding: "0 6px",
fontSize: 12,
fontWeight: 900,
borderRadius: 10,
border: "1px solid #cbd5e1",
background: "#fff",
color: "#0f172a",
outline: "none",
};
return {
page: {
padding: 12,
maxWidth: 900,
margin: "0 auto",
fontFamily:
'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Arial',
color: "#0f172a",
} as React.CSSProperties,
title: { fontSize: 18, fontWeight: 900, color: "#0b4aa2", marginBottom: 10 } as React.CSSProperties,
card: {
background: "#fff",
border: "1px solid #e5e7eb",
borderRadius: 14,
padding: 10,
boxShadow: "0 6px 18px rgba(15, 23, 42, 0.06)",
} as React.CSSProperties,
top: {
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: 8,
} as React.CSSProperties,
input,
total: {
flex: 1,
textAlign: "center",
fontWeight: 900,
borderRadius: 12,
padding: "8px 10px",
background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)",
border: "1px solid #dbeafe",
fontVariantNumeric: "tabular-nums",
whiteSpace: "nowrap",
} as React.CSSProperties,
btn: (disabled: boolean): React.CSSProperties => ({
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid #93c5fd",
background: disabled ? "#93c5fd" : "#1d4ed8",
color: "#fff",
fontWeight: 900,
cursor: disabled ? "not-allowed" : "pointer",
fontSize: 12,
whiteSpace: "nowrap",
}),
table: {
marginTop: 10,
border: "1px solid #e2e8f0",
borderRadius: 14,
overflow: "hidden",
} as React.CSSProperties,
head: {
display: "grid",
gridTemplateColumns: wide ? "90px 80px 120px 90px 1fr" : "70px 56px 96px 70px 1fr",
gap: 4,
padding: "8px 8px",
background: "#eff6ff",
borderBottom: "1px solid #dbeafe",
fontWeight: 900,
fontSize: 11,
color: "#334155",
} as React.CSSProperties,
row: {
display: "grid",
gridTemplateColumns: wide ? "90px 80px 120px 90px 1fr" : "70px 56px 96px 70px 1fr",
gap: 4,
padding: "8px 8px",
borderBottom: "1px solid #e2e8f0",
fontSize: 11,
fontWeight: 800,
color: "#0f172a",
} as React.CSSProperties,
c: { textAlign: "center", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as React.CSSProperties,
l: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as React.CSSProperties,
note: { marginTop: 8, fontSize: 12, color: "#64748b", fontWeight: 800 } as React.CSSProperties,
err: { marginTop: 8, fontSize: 12, color: "#b91c1c", fontWeight: 900 } as React.CSSProperties,
};
}, [wide]);

return (
<div style={styles.page}>
<div style={styles.title}>支出CSV出力</div>

<div style={styles.card}>
<div style={styles.top}>
<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={styles.input} />
<div style={styles.total}>件数 {rows.length} / 合計 {new Intl.NumberFormat("ja-JP").format(total)} 円</div>
<button style={styles.btn(loading || rows.length === 0)} onClick={onExport} disabled={loading || rows.length === 0}>
CSV出力
</button>
</div>
{err && <div style={styles.err}>{err}</div>}
<div style={styles.note}>※ expenses の month == 選択月 で取得してCSV化します。</div>
</div>

<div style={styles.table}>
<div style={styles.head}>
<div style={styles.c}>日付</div>
<div style={styles.c}>登録者</div>
<div style={styles.c}>金額</div>
<div style={styles.c}>カテゴリ</div>
<div style={styles.l}>内訳 / 支出元</div>
</div>
{rows.slice(0, 50).map((r, idx) => (
<div key={idx} style={styles.row}>
<div style={styles.c}>{(r.date || "").slice(5).replace("-", "/")}</div>
<div style={styles.c}>{r.registrant}</div>
<div style={styles.c}>{new Intl.NumberFormat("ja-JP").format(r.amount)}</div>
<div style={styles.c}>{r.category}</div>
<div style={styles.l}>
{r.subCategory} / {r.source}
</div>
</div>
))}
</div>

<div style={styles.note}>※ プレビューは最大50件だけ表示（CSVは全件出力）</div>
</div>
);
}