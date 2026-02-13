import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";

type IncomeDoc = {
registrant: string; // あれば
date: string; // YYYY-MM-DD
amount: number; // 正の整数想定
source: string; // 収入元（将哉/未有/その他）
memo?: string;
};

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
function ymdStartOfMonth(ym: string) {
return `${ym}-01`;
}
function ymdStartOfNextMonth(ym: string) {
const { y, m } = parseYM(ym);
const d = new Date(y, m, 1); // next month 1st
const yy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, "0");
return `${yy}-${mm}-01`;
}

function csvEscape(v: any) {
const s = String(v ?? "");
if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
return s;
}
function downloadCsv(filename: string, csv: string) {
const bom = "\uFEFF";
const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = filename;
a.click();
URL.revokeObjectURL(url);
}

export default function ExportIncomeCsvPage() {
const [wide, setWide] = useState(false);
useEffect(() => {
const on = () => setWide(window.innerWidth >= 768);
on();
window.addEventListener("resize", on);
return () => window.removeEventListener("resize", on);
}, []);

const [month, setMonth] = useState(ymToday());
const [loading, setLoading] = useState(false);
const [rows, setRows] = useState<IncomeDoc[]>([]);
const [err, setErr] = useState<string>("");

const load = async () => {
setLoading(true);
setErr("");
try {
const start = ymdStartOfMonth(month);
const next = ymdStartOfNextMonth(month);

const q = query(
collection(db, "incomes"),
where("date", ">=", start),
where("date", "<", next),
orderBy("date", "asc")
);
const snap = await getDocs(q);
const list: IncomeDoc[] = snap.docs
.map((d) => d.data() as any)
.map((x) => ({
registrant: x.registrant ?? "",
date: x.date ?? "",
amount: Number(x.amount ?? 0),
source: x.source ?? "",
memo: x.memo ?? "",
}))
.filter((x) => Number.isFinite(x.amount)); // 念のため
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
const header = ["date", "source", "amount", "memo"];
const lines = [header.join(",")];
for (const r of rows) {
lines.push([csvEscape(r.date), csvEscape(r.source), csvEscape(r.amount), csvEscape(r.memo ?? "")].join(","));
}
downloadCsv(`incomes_${month}.csv`, lines.join("\n"));
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
title: { fontSize: 18, fontWeight: 900, color: "#c2410c", marginBottom: 10 } as React.CSSProperties,
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
background: "linear-gradient(180deg, #fff7ed 0%, #ffffff 100%)",
border: "1px solid #fed7aa",
fontVariantNumeric: "tabular-nums",
whiteSpace: "nowrap",
} as React.CSSProperties,
btn: (disabled: boolean): React.CSSProperties => ({
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid #fdba74",
background: disabled ? "#fdba74" : "#ea580c",
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
gridTemplateColumns: wide ? "90px 110px 130px 1fr" : "70px 86px 96px 1fr",
gap: 4,
padding: "8px 8px",
background: "#fff7ed",
borderBottom: "1px solid #fed7aa",
fontWeight: 900,
fontSize: 11,
color: "#7c2d12",
} as React.CSSProperties,
row: {
display: "grid",
gridTemplateColumns: wide ? "90px 110px 130px 1fr" : "70px 86px 96px 1fr",
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
<div style={styles.title}>収入CSV出力</div>

<div style={styles.card}>
<div style={styles.top}>
<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={styles.input} />
<div style={styles.total}>件数 {rows.length} / 合計 {new Intl.NumberFormat("ja-JP").format(total)} 円</div>
<button style={styles.btn(loading || rows.length === 0)} onClick={onExport} disabled={loading || rows.length === 0}>
CSV出力
</button>
</div>
{err && <div style={styles.err}>{err}</div>}
<div style={styles.note}>※ incomes は date 範囲（選択月）で取得してCSV化します。</div>
</div>

<div style={styles.table}>
<div style={styles.head}>
<div style={styles.c}>日付</div>
<div style={styles.c}>収入元</div>
<div style={styles.c}>金額</div>
<div style={styles.l}>メモ</div>
</div>
{rows.slice(0, 50).map((r, idx) => (
<div key={idx} style={styles.row}>
<div style={styles.c}>{(r.date || "").slice(5).replace("-", "/")}</div>
<div style={styles.c}>{r.source}</div>
<div style={styles.c}>{new Intl.NumberFormat("ja-JP").format(r.amount)}</div>
<div style={styles.l}>{r.memo || ""}</div>
</div>
))}
</div>

<div style={styles.note}>※ プレビューは最大50件だけ表示（CSVは全件出力）</div>
</div>
);
}