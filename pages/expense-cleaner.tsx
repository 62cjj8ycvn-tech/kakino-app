// pages/expense-cleaner.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
collection,
deleteDoc,
doc,
getDocs,
limit,
orderBy,
query,
where,
Timestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { CATEGORIES, REGISTRANTS } from "../lib/masterData";
type Category = (typeof CATEGORIES)[number];

function isCategory(x: string): x is Category {
return (CATEGORIES as readonly string[]).includes(x);
}
type Registrant = (typeof REGISTRANTS)[number];

function isRegistrant(x: string): x is Registrant {
return (REGISTRANTS as readonly string[]).includes(x);
}
/**
* Expense Cleaner（ゴミデータ捜索＆削除）
*
* 探索ルート（Firestoreの制約対策）
* 1) month == "YYYY-MM"（通常）
* 2) date >= "YYYY-MM-01" and date < "YYYY-MM+1-01"（文字列日付が正しいもの）
* 3) createdAt 範囲（Timestampがあるもの）
*
* “壊れてそう”判定（reasonsを表示）
* - month が無い/形式不正
* - date が無い/形式不正
* - month と date(YYYY-MM) が一致しない
* - amount が number じゃない / NaN
* - category が無い/マスタ外
* - registrant が無い/マスタ外
*
* 削除
* - 「削除を有効化」 + DELETE入力 が必要
* - 個別削除 / 選択一括削除
*/

type ExpenseAny = {
registrant?: any;
date?: any; // "YYYY-MM-DD"
month?: any; // "YYYY-MM"
amount?: any;
category?: any;
subCategory?: any;
source?: any;
memo?: any;
createdAt?: any;
updatedAt?: any;
};

type Row = {
id: string;
data: ExpenseAny;
reasons: string[];
};

function ymToday() {
const d = new Date();
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
return `${y}-${m}`;
}

function addMonthsYM(ym: string, diff: number) {
const [ys, ms] = (ym ?? "").split("-");
const y = Number(ys);
const m = Number(ms);

// ✅ 不正な ym が来ても落とさない（ビルドも通す）
if (!Number.isFinite(y) || !Number.isFinite(m)) return "1970-01";

const d = new Date(y, (m - 1) + diff, 1);
const yy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, "0");
return `${yy}-${mm}`;
}

function toYmdStart(ym: string) {
return `${ym}-01`;
}

function toYmdNextStart(ym: string) {
const next = addMonthsYM(ym, 1);
return `${next}-01`;
}

function isValidYM(s: string) {
return /^\d{4}-\d{2}$/.test(s);
}
function isValidYMD(s: string) {
return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function safeStr(v: any) {
return typeof v === "string" ? v : v == null ? "" : String(v);
}
function safeNum(v: any) {
const n = typeof v === "number" ? v : Number(v);
return Number.isFinite(n) ? n : NaN;
}
function fmtYen(n: number) {
const r = Math.round(Number(n) || 0);
const sign = r < 0 ? "▲" : "";
return `${sign}¥${Math.abs(r).toLocaleString("ja-JP")}`;
}

function tsFromLocalStartOfMonth(ym: string) {
// local time → Date (00:00)
const [ys, ms] = (ym ?? "").split("-");
const y = Number(ys);
const m = Number(ms);

// ✅ 不正な ym でも落とさない（ビルド通す）
if (!Number.isFinite(y) || !Number.isFinite(m)) {
return Timestamp.fromDate(new Date(1970, 0, 1, 0, 0, 0));
}

const d = new Date(y, m - 1, 1, 0, 0, 0);
return Timestamp.fromDate(d);
}
function tsFromLocalStartOfNextMonth(ym: string) {
const [ys, ms] = (ym ?? "").split("-");
const y = Number(ys);
const m = Number(ms);

if (!Number.isFinite(y) || !Number.isFinite(m)) {
return Timestamp.fromDate(new Date(1970, 0, 1, 0, 0, 0));
}

const d = new Date(y, m, 1, 0, 0, 0); // ✅ 次月なので m のまま
return Timestamp.fromDate(d);
}

type Mode = "month" | "date" | "createdAt" | "all";

export default function ExpenseCleanerPage() {
const [targetYM, setTargetYM] = useState<string>(ymToday());
const [mode, setMode] = useState<Mode>("all");
const [busy, setBusy] = useState(false);
const [rows, setRows] = useState<Row[]>([]);
const [msg, setMsg] = useState<string>("");
// responsive（SSR対策：windowを直接触らない）
const [wide, setWide] = useState(false);
useEffect(() => {
const on = () => setWide(window.innerWidth >= 768);
on();
window.addEventListener("resize", on);
return () => window.removeEventListener("resize", on);
}, []);
// filters
const [onlyBroken, setOnlyBroken] = useState(true);
const [filterRegistrant, setFilterRegistrant] = useState<string>("");
const [filterCategory, setFilterCategory] = useState<string>("");
const [textSearch, setTextSearch] = useState<string>(""); // id/source/memo/subCategory etc

// deletion safety
const [armDelete, setArmDelete] = useState(false);
const [deleteWord, setDeleteWord] = useState("");

// selection
const [selected, setSelected] = useState<Record<string, boolean>>({});

const deleteEnabled = armDelete && deleteWord.trim().toUpperCase() === "DELETE";

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
width: "100%",
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
title: { fontSize: 18, fontWeight: 900, color: "#0b4aa2" } as React.CSSProperties,
row: { display: "grid", gap: 8 } as React.CSSProperties,
controls: {
display: "grid",
gridTemplateColumns: "1fr",
gap: 8,
marginTop: 10,
} as React.CSSProperties,
controlsWide: {
gridTemplateColumns: "140px 1fr 1fr 1fr",
alignItems: "center",
} as React.CSSProperties,
select: selectBase,
input: {
...selectBase,
fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
fontWeight: 800,
} as React.CSSProperties,
btn: (primary: boolean, danger?: boolean): React.CSSProperties => ({
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid " + (danger ? "#fecaca" : primary ? "#93c5fd" : "#cbd5e1"),
background: danger ? "#fee2e2" : primary ? "#dbeafe" : "#fff",
color: danger ? "#b91c1c" : "#0b4aa2",
fontWeight: 900,
cursor: "pointer",
whiteSpace: "nowrap",
}),
tiny: {
fontSize: 12,
fontWeight: 800,
color: "#64748b",
lineHeight: 1.4,
} as React.CSSProperties,
badge: (warn: boolean): React.CSSProperties => ({
display: "inline-flex",
alignItems: "center",
gap: 6,
borderRadius: 999,
padding: "4px 10px",
border: "1px solid " + (warn ? "#fecaca" : "#cbd5e1"),
background: warn ? "#fff1f2" : "#f8fafc",
color: warn ? "#991b1b" : "#334155",
fontWeight: 900,
fontSize: 12,
}),
tableHead: {
display: "grid",
gridTemplateColumns: "34px 120px 90px 90px 1fr 110px",
gap: 6,
padding: "8px 8px",
borderRadius: 12,
background: "#eff6ff",
border: "1px solid #dbeafe",
fontWeight: 900,
color: "#334155",
fontSize: 12,
} as React.CSSProperties,
tableRow: (warn: boolean): React.CSSProperties => ({
display: "grid",
gridTemplateColumns: "34px 120px 90px 90px 1fr 110px",
gap: 6,
padding: "8px 8px",
borderRadius: 12,
border: "1px solid " + (warn ? "#fecaca" : "#e2e8f0"),
background: warn ? "#fff7f8" : "#fff",
marginTop: 8,
alignItems: "center",
}),
mono: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, fontWeight: 800 } as React.CSSProperties,
cell: { fontSize: 12, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as React.CSSProperties,
reasonBox: {
marginTop: 6,
display: "flex",
flexWrap: "wrap",
gap: 6,
} as React.CSSProperties,
reason: {
borderRadius: 999,
padding: "4px 10px",
border: "1px solid #fecaca",
background: "#fff1f2",
color: "#991b1b",
fontWeight: 900,
fontSize: 12,
} as React.CSSProperties,
};
}, []);

function buildReasons(d: ExpenseAny, id: string): string[] {
const reasons: string[] = [];

const month = safeStr(d.month);
const date = safeStr(d.date);
const registrant = safeStr(d.registrant);
const category = safeStr(d.category);
const amount = safeNum(d.amount);

if (!month) reasons.push("monthなし");
if (month && !isValidYM(month)) reasons.push(`month形式不正: ${month}`);

if (!date) reasons.push("dateなし");
if (date && !isValidYMD(date)) reasons.push(`date形式不正: ${date}`);

if (month && isValidYM(month) && date && isValidYMD(date)) {
const ymFromDate = date.slice(0, 7);
if (ymFromDate !== month) reasons.push(`month/date不一致: ${month} vs ${ymFromDate}`);
}

if (!Number.isFinite(amount)) reasons.push(`amount不正: ${safeStr(d.amount)}`);
if (category && !isCategory(category))
    reasons.push(`categoryマスタ外: ${category}`);

if (!category) reasons.push("categoryなし");

if (!registrant) reasons.push("registrantなし");
if (registrant && REGISTRANTS.length > 0 && !isRegistrant(registrant)) {

reasons.push(`registrantマスタ外: ${registrant}`);
}

// 参考：source/memo などは壊れてても致命傷じゃないので理由には入れない（必要なら追加OK）
// idも参考として
if (!id) reasons.push("docIdなし(あり得ない)");

return reasons;
}

async function fetchByMonth(ym: string) {
// month == ym
const q1 = query(collection(db, "expenses"), where("month", "==", ym), limit(2000));
const snap = await getDocs(q1);
return snap.docs.map((d) => ({ id: d.id, data: d.data() as ExpenseAny }));
}

async function fetchByDateRange(ym: string) {
// date in [ym-01, nextYm-01)
const start = toYmdStart(ym);
const next = toYmdNextStart(ym);

// dateはstring比較が効く前提（YYYY-MM-DD）
const q2 = query(
collection(db, "expenses"),
where("date", ">=", start),
where("date", "<", next),
limit(2000)
);
const snap = await getDocs(q2);
return snap.docs.map((d) => ({ id: d.id, data: d.data() as ExpenseAny }));
}

async function fetchByCreatedAtRange(ym: string) {
// createdAt in [monthStart, nextMonthStart)
// ※ createdAtが無い古いデータは拾えない
const start = tsFromLocalStartOfMonth(ym);
const next = tsFromLocalStartOfNextMonth(ym);

const q3 = query(
collection(db, "expenses"),
where("createdAt", ">=", start),
where("createdAt", "<", next),
orderBy("createdAt", "asc"),
limit(2000)
);
const snap = await getDocs(q3);
return snap.docs.map((d) => ({ id: d.id, data: d.data() as ExpenseAny }));
}

function uniqMerge(list: { id: string; data: ExpenseAny }[]) {
const m = new Map<string, ExpenseAny>();
for (const x of list) {
if (!m.has(x.id)) m.set(x.id, x.data);
}
return Array.from(m.entries()).map(([id, data]) => ({ id, data }));
}

const runSearch = async () => {
setBusy(true);
setMsg("");
setRows([]);
setSelected({});
try {
const ym = targetYM;

const packs: { id: string; data: ExpenseAny }[] = [];

if (mode === "month" || mode === "all") {
const a = await fetchByMonth(ym);
packs.push(...a);
}
if (mode === "date" || mode === "all") {
const b = await fetchByDateRange(ym);
packs.push(...b);
}
if (mode === "createdAt" || mode === "all") {
const c = await fetchByCreatedAtRange(ym);
packs.push(...c);
}

const merged = uniqMerge(packs);

const out: Row[] = merged.map((x) => ({
id: x.id,
data: x.data,
reasons: buildReasons(x.data, x.id),
}));

setRows(out);
setMsg(`取得: ${out.length}件（mode=${mode}）`);
} catch (e: any) {
console.error(e);
setMsg(`失敗: ${String(e?.message ?? e)}`);
} finally {
setBusy(false);
}
};

useEffect(() => {
// 初回は当月を軽く走らせる
runSearch();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

const filtered = useMemo(() => {
const t = textSearch.trim();
const tLower = t.toLowerCase();

return rows.filter((r) => {
if (onlyBroken && r.reasons.length === 0) return false;

const registrant = safeStr(r.data.registrant);
const category = safeStr(r.data.category);

if (filterRegistrant && registrant !== filterRegistrant) return false;
if (filterCategory && category !== filterCategory) return false;

if (t) {
const blob = [
r.id,
safeStr(r.data.date),
safeStr(r.data.month),
safeStr(r.data.registrant),
safeStr(r.data.category),
safeStr(r.data.subCategory),
safeStr(r.data.source),
safeStr(r.data.memo),
safeStr(r.data.amount),
]
.join(" ")
.toLowerCase();
if (!blob.includes(tLower)) return false;
}

return true;
});
}, [rows, onlyBroken, filterRegistrant, filterCategory, textSearch]);

const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
const allChecked = useMemo(() => filtered.length > 0 && filtered.every((r) => selected[r.id]), [filtered, selected]);

const toggleAll = () => {
if (!filtered.length) return;
const next: Record<string, boolean> = { ...selected };
if (allChecked) {
for (const r of filtered) delete next[r.id];
} else {
for (const r of filtered) next[r.id] = true;
}
setSelected(next);
};

const deleteOne = async (id: string) => {
if (!deleteEnabled) {
alert("削除は無効です。『削除を有効化』＋ DELETE 入力が必要です。");
return;
}
const ok = confirm(`このドキュメントを削除しますか？\n\nexpenses/${id}`);
if (!ok) return;

try {
await deleteDoc(doc(db, "expenses", id));
setRows((prev) => prev.filter((x) => x.id !== id));
setSelected((prev) => {
const n = { ...prev };
delete n[id];
return n;
});
} catch (e) {
console.error(e);
alert("削除に失敗しました。");
}
};

const deleteSelected = async () => {
if (!deleteEnabled) {
alert("削除は無効です。『削除を有効化』＋ DELETE 入力が必要です。");
return;
}
if (selectedIds.length === 0) {
alert("削除する対象が選択されていません。");
return;
}
const ok = confirm(
`選択中の ${selectedIds.length} 件を削除しますか？\n\n※取り消しできません`
);
if (!ok) return;

setBusy(true);
try {
for (const id of selectedIds) {
await deleteDoc(doc(db, "expenses", id));
}
setRows((prev) => prev.filter((x) => !selectedIds.includes(x.id)));
setSelected({});
setMsg(`削除: ${selectedIds.length} 件`);
} catch (e) {
console.error(e);
alert("一括削除に失敗しました（途中まで消えてる可能性あり）。");
} finally {
setBusy(false);
}
};

return (
<div style={styles.page}>
<div style={styles.card}>
<div style={styles.title}>支出ゴミデータ捜索（expenses）</div>
<div style={{ ...styles.tiny, marginTop: 6 }}>
Firestoreの「古い形式/欠損フィールド」データを拾うため、探索ルートを複数用意しています。
<br />
<b>削除は危険</b>なので、スイッチ＋DELETE入力がないと実行できません。
</div>

<div style={{ ...(styles.controls as any), ...(wide ? (styles.controlsWide as any) : {}) }}>
<input type="month" value={targetYM} onChange={(e) => setTargetYM(e.target.value)} style={styles.select} />
<select value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={styles.select}>
<option value="all">探索: ALL（おすすめ）</option>
<option value="month">探索: month一致</option>
<option value="date">探索: date範囲</option>
<option value="createdAt">探索: createdAt範囲</option>
</select>

<button style={styles.btn(true)} onClick={runSearch} disabled={busy}>
{busy ? "検索中…" : "検索"}
</button>

<button
style={styles.btn(false)}
onClick={() => {
setRows([]);
setSelected({});
setMsg("");
}}
disabled={busy}
>
クリア
</button>
</div>

<div style={{ marginTop: 10, display: "grid", gap: 8 }}>
<div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
<label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 900, color: "#334155" }}>
<input type="checkbox" checked={onlyBroken} onChange={(e) => setOnlyBroken(e.target.checked)} />
壊れてそうなものだけ表示
</label>

<span style={styles.badge(rows.some((r) => r.reasons.length > 0))}>
表示中 {filtered.length} / 取得 {rows.length}
</span>

{msg && <span style={{ ...styles.tiny, fontWeight: 900 }}>{msg}</span>}
</div>

<div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
<select value={filterRegistrant} onChange={(e) => setFilterRegistrant(e.target.value)} style={styles.select}>
<option value="">登録者（全て）</option>
{REGISTRANTS.map((r) => (
<option key={r} value={r}>
{r}
</option>
))}
</select>
<select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={styles.select}>
<option value="">カテゴリ（全て）</option>
{CATEGORIES.map((c) => (
<option key={c} value={c}>
{c}
</option>
))}
</select>
</div>

<input
value={textSearch}
onChange={(e) => setTextSearch(e.target.value)}
placeholder="検索（docId / source / memo / subCategory / amount / date など）"
style={styles.input}
/>
</div>
</div>
</div>

{/* Delete safety */}
<div style={{ ...styles.card, marginTop: 10 }}>
<div style={{ fontWeight: 900, color: "#0b4aa2" }}>削除（危険）</div>
<div style={{ ...styles.tiny, marginTop: 6 }}>
削除を有効化し、入力欄に <b>DELETE</b> と打つと削除ボタンが有効になります。
</div>

<div style={{ marginTop: 10, display: "grid", gap: 8 }}>
<label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 900, color: "#334155" }}>
<input type="checkbox" checked={armDelete} onChange={(e) => setArmDelete(e.target.checked)} />
削除を有効化
</label>

<input
value={deleteWord}
onChange={(e) => setDeleteWord(e.target.value)}
placeholder="DELETE と入力"
style={{
...styles.input,
border: deleteEnabled ? "2px solid #16a34a" : "1px solid #cbd5e1",
background: deleteEnabled ? "#f0fdf4" : "#fff",
}}
/>

<div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
<button style={styles.btn(false)} onClick={toggleAll} disabled={busy || filtered.length === 0}>
{allChecked ? "全解除" : "全選択"}
</button>

<span style={styles.badge(selectedIds.length > 0)}>
選択 {selectedIds.length} 件
</span>

<button
style={styles.btn(false, true)}
onClick={deleteSelected}
disabled={busy || !deleteEnabled || selectedIds.length === 0}
>
選択を一括削除
</button>
</div>
</div>
</div>

{/* Table */}
<div style={{ ...styles.card, marginTop: 10 }}>
<div style={styles.tableHead}>
<div style={{ textAlign: "center" }}>☑</div>
<div>docId</div>
<div>month</div>
<div>date</div>
<div>概要</div>
<div style={{ textAlign: "center" }}>削除</div>
</div>

{filtered.length === 0 ? (
<div style={{ marginTop: 10, fontWeight: 900, color: "#64748b", textAlign: "center", padding: 14 }}>
（表示対象なし）
</div>
) : (
filtered.map((r) => {
const d = r.data;
const warn = r.reasons.length > 0;

const amount = safeNum(d.amount);
const amountText = Number.isFinite(amount) ? fmtYen(amount) : safeStr(d.amount);

const summary = [
`registrant:${safeStr(d.registrant) || "—"}`,
`category:${safeStr(d.category) || "—"}`,
`sub:${safeStr(d.subCategory) || "—"}`,
`amount:${amountText || "—"}`,
`source:${safeStr(d.source) || "—"}`,
].join(" / ");

return (
<div key={r.id}>
<div style={styles.tableRow(warn)}>
<div style={{ textAlign: "center" }}>
<input
type="checkbox"
checked={!!selected[r.id]}
onChange={(e) => setSelected((p) => ({ ...p, [r.id]: e.target.checked }))}
/>
</div>

<div style={{ ...styles.mono, overflow: "hidden", textOverflow: "ellipsis" }}>{r.id}</div>

<div style={styles.cell}>{safeStr(d.month) || "—"}</div>
<div style={styles.cell}>{safeStr(d.date) || "—"}</div>

<div style={{ ...styles.cell, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
{summary}
</div>

<div style={{ textAlign: "center" }}>
<button
style={styles.btn(false, true)}
onClick={() => deleteOne(r.id)}
disabled={busy || !deleteEnabled}
title={!deleteEnabled ? "削除は無効（有効化＋DELETE入力が必要）" : "削除"}
>
削除
</button>
</div>
</div>

{warn && (
<div style={styles.reasonBox}>
{r.reasons.map((x, i) => (
<div key={i} style={styles.reason}>
{x}
</div>
))}
</div>
)}
</div>
);
})
)}
</div>

<div style={{ ...styles.tiny, marginTop: 12 }}>
ヒント：
<br />・<b>mode=ALL</b> で見つからない場合、該当データは date/createdAt が壊れてる可能性が高いです（その場合はConsoleで目視が一番早い）。
<br />・削除前に、docIdをコピーしてConsoleで中身を確認すると安全です。
</div>
</div>
);
}