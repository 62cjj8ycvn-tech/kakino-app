// pages/todo.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
addDoc,
collection,
deleteDoc,
doc,
getDocs,
serverTimestamp,
updateDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";

/**
* TODOページ（完成版）
* - やること / ほしい物：登録・一覧・編集・削除
* - チェックで完了（completedAt付与）
* - 並び順
* - やること：未完了は期日が近い順、完了は完了日時が新しい順で下
* - ほしい物：未完了は登録順（createdAtが古い順）、完了は完了日時が新しい順で下
* - 7日以内のやることは薄赤
* - フィルター：ヘッダーをタップ → モーダル（全項目対応）
* - フィルター中はそのヘッダーを色変更
* - フィルター解除は、そのヘッダーをタップ（即解除）
* - 表示
* - 期日：MM/DD（0埋めなし）
* - ほしい物：未完了合計金額を表示
*/

type Registrant = "将哉" | "未有";
type Mode = "todo" | "wish" | null;

type TodoDoc = {
id: string;
type: "todo" | "wish";
registrant: Registrant;
text: string;
dueDate?: string; // todo: YYYY-MM-DD
amount?: number; // wish
completed: boolean;
completedAt?: any;
createdAt?: any;
updatedAt?: any;
};

type HeaderKeyTodo = "text" | "due" | "registrant" | "status" | null;
type HeaderKeyWish = "text" | "amount" | "registrant" | "status" | null;

function fmtYen(n: number) {
return `¥${Math.round(Number(n) || 0).toLocaleString("ja-JP")}`;
}
function digitsOnly(s: string) {
return (s || "").replace(/[^\d]/g, "");
}
function formatWithComma(s: string) {
const d = digitsOnly(s);
if (!d) return "";
return Number(d).toLocaleString("ja-JP");
}
function ymdToMD(ymd: string) {
if (!ymd || ymd.length < 10) return "";
const m = Number(ymd.slice(5, 7));
const d = Number(ymd.slice(8, 10));
return `${m}/${d}`; // 0埋めなし
}
function toMillisMaybe(v: any): number {
if (!v) return 0;
// Firestore Timestamp
if (typeof v?.toMillis === "function") return v.toMillis();
// Date
if (v instanceof Date) return v.getTime();
// number
if (typeof v === "number") return v;
return 0;
}
function diffDaysFromToday(ymd: string) {
if (!ymd || ymd.length < 10) return Infinity;
const parts = (ymd ?? "").split("-");
const y = Number(parts[0] ?? 1970);
const m = Number(parts[1] ?? 1);
const d = Number(parts[2] ?? 1);

const y0 = Number.isFinite(y) ? y : 1970;
const m0 = Number.isFinite(m) ? m : 1;
const d0 = Number.isFinite(d) ? d : 1;

const due = new Date(y0, m0 - 1, d0);
const now = new Date();
const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
const b = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}
function clamp(n: number, min: number, max: number) {
return Math.max(min, Math.min(max, n));
}

export default function TodoPage() {
// ========= data =========
const [rows, setRows] = useState<TodoDoc[]>([]);
const [loading, setLoading] = useState(true);

const load = async () => {
setLoading(true);
try {
const snap = await getDocs(collection(db, "todos"));
const list: TodoDoc[] = snap.docs.map((d) => {
const data = d.data() as any;
return {
id: d.id,
type: data.type,
registrant: data.registrant,
text: data.text ?? "",
dueDate: data.dueDate ?? "",
amount: Number(data.amount ?? 0),
completed: !!data.completed,
completedAt: data.completedAt ?? null,
createdAt: data.createdAt ?? null,
updatedAt: data.updatedAt ?? null,
};
});
setRows(list);
} catch (e) {
console.error(e);
setRows([]);
} finally {
setLoading(false);
}
};

useEffect(() => {
load();
}, []);

// ========= modal =========
const [mode, setMode] = useState<Mode>(null);
const [editingId, setEditingId] = useState<string | null>(null);

// ========= form =========
const [registrant, setRegistrant] = useState<Registrant>("将哉");

const [todoText, setTodoText] = useState("");
const [todoDue, setTodoDue] = useState("");

const [wishText, setWishText] = useState("");
const [wishAmountText, setWishAmountText] = useState("");
const wishAmount = useMemo(() => Number(digitsOnly(wishAmountText) || 0), [wishAmountText]);

const resetForm = () => {
setEditingId(null);
setTodoText("");
setTodoDue("");
setWishText("");
setWishAmountText("");
};

const openNew = (m: Mode) => {
setMode(m);
setEditingId(null);
resetForm();
};

const openEdit = (r: TodoDoc) => {
setMode(r.type);
setEditingId(r.id);
setRegistrant(r.registrant);
if (r.type === "todo") {
setTodoText(r.text || "");
setTodoDue(r.dueDate || "");
setWishText("");
setWishAmountText("");
} else {
setWishText(r.text || "");
setWishAmountText(formatWithComma(String(r.amount || 0)));
setTodoText("");
setTodoDue("");
}
};

const closeModal = () => {
setMode(null);
resetForm();
};

const submitTodo = async () => {
if (!todoText || !todoDue) {
alert("未入力の項目があります");
return;
}

const body = {
type: "todo" as const,
registrant,
text: todoText,
dueDate: todoDue,
updatedAt: serverTimestamp(),
};

try {
if (editingId) {
await updateDoc(doc(db, "todos", editingId), body as any);
} else {
await addDoc(collection(db, "todos"), {
...body,
completed: false,
completedAt: null,
createdAt: serverTimestamp(),
} as any);
}
closeModal();
await load();
} catch (e) {
console.error(e);
alert("保存に失敗しました");
}
};

const submitWish = async () => {
if (!wishText || wishAmount <= 0) {
alert("未入力の項目があります（0不可）");
return;
}

const body = {
type: "wish" as const,
registrant,
text: wishText,
amount: Math.trunc(wishAmount),
updatedAt: serverTimestamp(),
};

try {
if (editingId) {
await updateDoc(doc(db, "todos", editingId), body as any);
} else {
await addDoc(collection(db, "todos"), {
...body,
completed: false,
completedAt: null,
createdAt: serverTimestamp(),
} as any);
}
closeModal();
await load();
} catch (e) {
console.error(e);
alert("保存に失敗しました");
}
};

const onDelete = async () => {
if (!editingId) return;
const ok = confirm("この明細を削除しますか？");
if (!ok) return;
try {
await deleteDoc(doc(db, "todos", editingId));
closeModal();
await load();
} catch (e) {
console.error(e);
alert("削除に失敗しました");
}
};

const toggleCompleted = async (r: TodoDoc) => {
try {
const next = !r.completed;
await updateDoc(doc(db, "todos", r.id), {
completed: next,
completedAt: next ? serverTimestamp() : null,
updatedAt: serverTimestamp(),
} as any);
await load();
} catch (e) {
console.error(e);
alert("更新に失敗しました");
}
};

// ========= split =========
const todosAll = useMemo(() => rows.filter((r) => r.type === "todo"), [rows]);
const wishesAll = useMemo(() => rows.filter((r) => r.type === "wish"), [rows]);

// ========= filters =========
// TODO filters
const [todoHeader, setTodoHeader] = useState<HeaderKeyTodo>(null);
const [todoFilterOpen, setTodoFilterOpen] = useState(false);
const [fTodoText, setFTodoText] = useState("");
const [fTodoDueFrom, setFTodoDueFrom] = useState("");
const [fTodoDueTo, setFTodoDueTo] = useState("");
const [fTodoRegistrant, setFTodoRegistrant] = useState<"" | Registrant>("");
const [fTodoStatus, setFTodoStatus] = useState<"all" | "open" | "done">("all");

// WISH filters
const [wishHeader, setWishHeader] = useState<HeaderKeyWish>(null);
const [wishFilterOpen, setWishFilterOpen] = useState(false);
const [fWishText, setFWishText] = useState("");
const [fWishAmountMin, setFWishAmountMin] = useState("");
const [fWishAmountMax, setFWishAmountMax] = useState("");
const [fWishRegistrant, setFWishRegistrant] = useState<"" | Registrant>("");
const [fWishStatus, setFWishStatus] = useState<"all" | "open" | "done">("all");

// header active check
const todoHeaderActive = (k: HeaderKeyTodo) => {
if (k === "text") return !!fTodoText.trim();
if (k === "due") return !!fTodoDueFrom || !!fTodoDueTo;
if (k === "registrant") return !!fTodoRegistrant;
if (k === "status") return fTodoStatus !== "all";
return false;
};
const wishHeaderActive = (k: HeaderKeyWish) => {
if (k === "text") return !!fWishText.trim();
if (k === "amount") return !!fWishAmountMin || !!fWishAmountMax;
if (k === "registrant") return !!fWishRegistrant;
if (k === "status") return fWishStatus !== "all";
return false;
};

// header tap behavior: active -> clear; inactive -> open modal
const tapTodoHeader = (k: HeaderKeyTodo) => {
if (!k) return;
if (todoHeaderActive(k)) {
// clear that filter
if (k === "text") setFTodoText("");
if (k === "due") {
setFTodoDueFrom("");
setFTodoDueTo("");
}
if (k === "registrant") setFTodoRegistrant("");
if (k === "status") setFTodoStatus("all");
setTodoHeader(null);
setTodoFilterOpen(false);
return;
}
setTodoHeader(k);
setTodoFilterOpen(true);
};

const tapWishHeader = (k: HeaderKeyWish) => {
if (!k) return;
if (wishHeaderActive(k)) {
if (k === "text") setFWishText("");
if (k === "amount") {
setFWishAmountMin("");
setFWishAmountMax("");
}
if (k === "registrant") setFWishRegistrant("");
if (k === "status") setFWishStatus("all");
setWishHeader(null);
setWishFilterOpen(false);
return;
}
setWishHeader(k);
setWishFilterOpen(true);
};

const closeTodoFilter = () => setTodoFilterOpen(false);
const closeWishFilter = () => setWishFilterOpen(false);

// ========= apply filters =========
const todosFiltered = useMemo(() => {
return todosAll.filter((r) => {
if (fTodoText.trim()) {
const q = fTodoText.trim().toLowerCase();
if (!(r.text || "").toLowerCase().includes(q)) return false;
}
if (fTodoRegistrant && r.registrant !== fTodoRegistrant) return false;

if (fTodoStatus === "open" && r.completed) return false;
if (fTodoStatus === "done" && !r.completed) return false;

// due range
const due = r.dueDate || "";
if (fTodoDueFrom && (!due || due < fTodoDueFrom)) return false;
if (fTodoDueTo && (!due || due > fTodoDueTo)) return false;

return true;
});
}, [todosAll, fTodoText, fTodoRegistrant, fTodoStatus, fTodoDueFrom, fTodoDueTo]);

const wishesFiltered = useMemo(() => {
const mn = fWishAmountMin ? Number(digitsOnly(fWishAmountMin)) : NaN;
const mx = fWishAmountMax ? Number(digitsOnly(fWishAmountMax)) : NaN;

return wishesAll.filter((r) => {
if (fWishText.trim()) {
const q = fWishText.trim().toLowerCase();
if (!(r.text || "").toLowerCase().includes(q)) return false;
}
if (fWishRegistrant && r.registrant !== fWishRegistrant) return false;

if (fWishStatus === "open" && r.completed) return false;
if (fWishStatus === "done" && !r.completed) return false;

const amt = Number(r.amount || 0);
if (Number.isFinite(mn) && amt < mn) return false;
if (Number.isFinite(mx) && amt > mx) return false;

return true;
});
}, [wishesAll, fWishText, fWishRegistrant, fWishStatus, fWishAmountMin, fWishAmountMax]);

// ========= sorting =========
const todosSorted = useMemo(() => {
const open = todosFiltered
.filter((r) => !r.completed)
.sort((a, b) => {
const da = a.dueDate || "9999-12-31";
const db2 = b.dueDate || "9999-12-31";
return da < db2 ? -1 : da > db2 ? 1 : 0;
});
const done = todosFiltered
.filter((r) => r.completed)
.sort((a, b) => toMillisMaybe(b.completedAt) - toMillisMaybe(a.completedAt)); // 完了日時 desc
return [...open, ...done];
}, [todosFiltered]);

const wishesSorted = useMemo(() => {
const open = wishesFiltered
.filter((r) => !r.completed)
.sort((a, b) => toMillisMaybe(a.createdAt) - toMillisMaybe(b.createdAt)); // 登録順 asc
const done = wishesFiltered
.filter((r) => r.completed)
.sort((a, b) => toMillisMaybe(b.completedAt) - toMillisMaybe(a.completedAt)); // 完了日時 desc
return [...open, ...done];
}, [wishesFiltered]);

// ========= wish sum (unchecked only) =========
const wishSumOpen = useMemo(() => {
return wishesFiltered
.filter((r) => !r.completed)
.reduce((a, b) => a + (Number(b.amount) || 0), 0);
}, [wishesFiltered]);

// ========= styles（支出ページ寄せ） =========
const styles = useMemo(() => {
const selectBase: React.CSSProperties = {
width: "100%",
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

const headCell = (active: boolean): React.CSSProperties => ({
textAlign: "center",
fontSize: 11,
fontWeight: 900,
padding: "6px 4px",
borderRadius: 8,
cursor: "pointer",
color: active ? "#0b4aa2" : "#334155",
background: active ? "#dbeafe" : "transparent",
whiteSpace: "nowrap",
userSelect: "none",
});

return {
page: {
padding: 12,
maxWidth: 1100,
margin: "0 auto",
fontFamily:
'ui-sans-serif, system-ui, -apple-system, "Noto Sans JP"',
color: "#0f172a",
} as React.CSSProperties,

card: {
background: "#fff",
border: "1px solid #e5e7eb",
borderRadius: 14,
padding: 12,
boxShadow: "0 6px 18px rgba(15,23,42,0.05)",
} as React.CSSProperties,

titleRow: {
display: "flex",
justifyContent: "space-between",
alignItems: "center",
gap: 8,
flexWrap: "wrap",
} as React.CSSProperties,

title: { fontSize: 18, fontWeight: 900, color: "#0b4aa2" } as React.CSSProperties,

btn: {
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid #93c5fd",
background: "#1d4ed8",
color: "#fff",
fontWeight: 900,
cursor: "pointer",
fontSize: 12,
whiteSpace: "nowrap",
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
fontSize: 12,
whiteSpace: "nowrap",
} as React.CSSProperties,

sectionTitleRow: {
display: "flex",
justifyContent: "space-between",
alignItems: "baseline",
gap: 10,
marginTop: 12,
marginBottom: 6,
} as React.CSSProperties,

sectionTitle: {
fontSize: 14,
fontWeight: 900,
color: "#0b4aa2",
} as React.CSSProperties,

sumText: {
fontSize: 13,
fontWeight: 900,
color: "#0f172a",
fontVariantNumeric: "tabular-nums",
} as React.CSSProperties,

// headers (todo: 4 cols)
headRowTodo: {
display: "grid",
gridTemplateColumns: "46px 1fr 78px 64px",
gap: 6,
padding: "6px 6px",
borderRadius: 12,
background: "#eff6ff",
border: "1px solid #dbeafe",
} as React.CSSProperties,

// headers (wish: 4 cols)
headRowWish: {
display: "grid",
gridTemplateColumns: "46px 1fr 96px 64px",
gap: 6,
padding: "6px 6px",
borderRadius: 12,
background: "#eff6ff",
border: "1px solid #dbeafe",
} as React.CSSProperties,

headCell,

list: {
display: "grid",
gap: 8,
marginTop: 8,
} as React.CSSProperties,

rowTodo: (urgent: boolean, done: boolean): React.CSSProperties => ({
display: "grid",
gridTemplateColumns: "46px 1fr 78px 64px",
gap: 6,
padding: "10px 8px",
borderRadius: 14,
border: "1px solid #e2e8f0",
background: urgent && !done ? "#fff1f2" : "#fff",
cursor: "pointer",
alignItems: "center",
}),

rowWish: (done: boolean): React.CSSProperties => ({
display: "grid",
gridTemplateColumns: "46px 1fr 96px 64px",
gap: 6,
padding: "10px 8px",
borderRadius: 14,
border: "1px solid #e2e8f0",
background: "#fff",
cursor: "pointer",
alignItems: "center",
}),

cellCenter: {
textAlign: "center",
fontWeight: 900,
fontSize: 12,
whiteSpace: "nowrap",
fontVariantNumeric: "tabular-nums",
} as React.CSSProperties,

cellLeft: {
textAlign: "left",
fontWeight: 900,
fontSize: 12,
overflow: "hidden",
textOverflow: "ellipsis",
whiteSpace: "nowrap",
} as React.CSSProperties,

checkbox: {
width: 18,
height: 18,
cursor: "pointer",
} as React.CSSProperties,

empty: {
marginTop: 10,
padding: 12,
borderRadius: 14,
border: "1px solid #e2e8f0",
background: "#fff",
textAlign: "center",
color: "#0b4aa2",
fontWeight: 900,
} as React.CSSProperties,

// modal
modalOverlay: {
position: "fixed",
inset: 0,
background: "rgba(15,23,42,0.45)",
display: "flex",
justifyContent: "center",
alignItems: "flex-end",
padding: 12,
zIndex: 50,
} as React.CSSProperties,

modal: {
width: "100%",
maxWidth: 560,
background: "#fff",
borderRadius: 16,
border: "1px solid #e5e7eb",
overflow: "hidden",
} as React.CSSProperties,

modalHead: {
padding: "10px 12px",
borderBottom: "1px solid #e5e7eb",
fontWeight: 900,
color: "#0b4aa2",
background: "linear-gradient(180deg,#eff6ff,#fff)",
display: "flex",
justifyContent: "space-between",
alignItems: "center",
} as React.CSSProperties,

modalBody: {
padding: 12,
display: "grid",
gap: 12,
} as React.CSSProperties,

label: {
fontSize: 12,
fontWeight: 900,
color: "#334155",
marginBottom: 6,
} as React.CSSProperties,

input: {
height: 36,
borderRadius: 10,
border: "1px solid #cbd5e1",
padding: "0 10px",
fontSize: 13,
fontWeight: 900,
outline: "none",
} as React.CSSProperties,

regRow: {
display: "grid",
gridTemplateColumns: "1fr 1fr",
gap: 8,
} as React.CSSProperties,

regCard: (active: boolean): React.CSSProperties => ({
borderRadius: 12,
padding: 10,
textAlign: "center",
fontWeight: 900,
cursor: "pointer",
border: "1px solid " + (active ? "#93c5fd" : "#e2e8f0"),
background: active ? "linear-gradient(180deg,#dbeafe,#fff)" : "#fff",
color: active ? "#0b4aa2" : "#334155",
userSelect: "none",
}),

modalFoot: {
display: "flex",
gap: 8,
justifyContent: "flex-end",
padding: 12,
borderTop: "1px solid #e5e7eb",
} as React.CSSProperties,

btnDanger: {
height: 34,
padding: "0 12px",
borderRadius: 999,
border: "1px solid #fecaca",
background: "#fee2e2",
color: "#b91c1c",
fontWeight: 900,
cursor: "pointer",
} as React.CSSProperties,

// filter modal helpers
filterHint: { fontSize: 12, fontWeight: 800, color: "#334155" } as React.CSSProperties,
selectBase,
};
}, []);

// ========= filter panel titles =========
const todoFilterTitle = useMemo(() => {
if (todoHeader === "text") return "やること（部分一致）";
if (todoHeader === "due") return "期日（範囲）";
if (todoHeader === "registrant") return "登録者";
if (todoHeader === "status") return "状態（未完了/完了）";
return "フィルター";
}, [todoHeader]);

const wishFilterTitle = useMemo(() => {
if (wishHeader === "text") return "ほしい物（部分一致）";
if (wishHeader === "amount") return "金額（範囲）";
if (wishHeader === "registrant") return "登録者";
if (wishHeader === "status") return "状態（未完了/完了）";
return "フィルター";
}, [wishHeader]);

// ========= render =========
const stop = (e: React.MouseEvent) => e.stopPropagation();

return (
<div style={styles.page}>
{/* ===== header ===== */}
<div style={styles.card}>
<div style={styles.titleRow}>
<div style={styles.title}>TODO</div>
<div style={{ display: "flex", gap: 8 }}>
<button style={styles.btn} onClick={() => openNew("todo")}>
やること登録
</button>
<button style={styles.btn} onClick={() => openNew("wish")}>
ほしい物登録
</button>
</div>
</div>
</div>

{/* ===== TODO list ===== */}
<div style={styles.sectionTitleRow}>
<div style={styles.sectionTitle}>やることリスト</div>
</div>

<div style={styles.headRowTodo}>
<div style={styles.headCell(todoHeaderActive("status"))} onClick={() => tapTodoHeader("status")}>
☑︎
</div>
<div style={styles.headCell(todoHeaderActive("text"))} onClick={() => tapTodoHeader("text")}>
やること
</div>
<div style={styles.headCell(todoHeaderActive("due"))} onClick={() => tapTodoHeader("due")}>
期日
</div>
<div style={styles.headCell(todoHeaderActive("registrant"))} onClick={() => tapTodoHeader("registrant")}>
登録者
</div>
</div>

{loading ? (
<div style={styles.empty}>読み込み中…</div>
) : todosSorted.length === 0 ? (
<div style={styles.empty}>（やることなし）</div>
) : (
<div style={styles.list}>
{todosSorted.map((r) => {
const urgent = diffDaysFromToday(r.dueDate || "") <= 7;
return (
<div
key={r.id}
style={styles.rowTodo(urgent, r.completed)}
onClick={() => openEdit(r)}
role="button"
>
<div style={styles.cellCenter}>
<input
type="checkbox"
checked={!!r.completed}
onClick={(e) => e.stopPropagation()}
onChange={() => toggleCompleted(r)}
style={styles.checkbox}
/>
</div>
<div style={{ ...styles.cellLeft, color: r.completed ? "#64748b" : "#0f172a" }}>
{r.text}
</div>
<div style={{ ...styles.cellCenter, color: r.completed ? "#64748b" : "#0f172a" }}>
{ymdToMD(r.dueDate || "")}
</div>
<div style={{ ...styles.cellCenter, color: r.completed ? "#64748b" : "#0f172a" }}>
{r.registrant}
</div>
</div>
);
})}
</div>
)}

{/* ===== WISH list ===== */}
<div style={styles.sectionTitleRow}>
<div style={styles.sectionTitle}>ほしい物リスト</div>
<div style={styles.sumText}>合計 {fmtYen(wishSumOpen)}</div>
</div>

<div style={styles.headRowWish}>
<div style={styles.headCell(wishHeaderActive("status"))} onClick={() => tapWishHeader("status")}>
☑︎
</div>
<div style={styles.headCell(wishHeaderActive("text"))} onClick={() => tapWishHeader("text")}>
ほしい物
</div>
<div style={styles.headCell(wishHeaderActive("amount"))} onClick={() => tapWishHeader("amount")}>
金額
</div>
<div style={styles.headCell(wishHeaderActive("registrant"))} onClick={() => tapWishHeader("registrant")}>
登録者
</div>
</div>

{loading ? (
<div style={styles.empty}>読み込み中…</div>
) : wishesSorted.length === 0 ? (
<div style={styles.empty}>（ほしい物なし）</div>
) : (
<div style={styles.list}>
{wishesSorted.map((r) => {
return (
<div
key={r.id}
style={styles.rowWish(r.completed)}
onClick={() => openEdit(r)}
role="button"
>
<div style={styles.cellCenter}>
<input
type="checkbox"
checked={!!r.completed}
onClick={(e) => e.stopPropagation()}
onChange={() => toggleCompleted(r)}
style={styles.checkbox}
/>
</div>
<div style={{ ...styles.cellLeft, color: r.completed ? "#64748b" : "#0f172a" }}>
{r.text}
</div>
<div style={{ ...styles.cellCenter, color: r.completed ? "#64748b" : "#0f172a" }}>
{fmtYen(Number(r.amount || 0))}
</div>
<div style={{ ...styles.cellCenter, color: r.completed ? "#64748b" : "#0f172a" }}>
{r.registrant}
</div>
</div>
);
})}
</div>
)}

{/* ===== create/edit modal ===== */}
{mode && (
<div style={styles.modalOverlay} onClick={closeModal} role="dialog" aria-modal="true">
<div style={styles.modal} onClick={stop}>
<div style={styles.modalHead}>
<div>{editingId ? "編集" : "登録"}：{mode === "todo" ? "やること" : "ほしい物"}</div>
<button style={styles.btnGhost} onClick={closeModal}>閉じる</button>
</div>

<div style={styles.modalBody}>
{/* registrant */}
<div>
<div style={styles.label}>登録者</div>
<div style={styles.regRow}>
{(["将哉", "未有"] as Registrant[]).map((r) => (
<div
key={r}
style={styles.regCard(registrant === r)}
onClick={() => setRegistrant(r)}
role="button"
>
{r}
</div>
))}
</div>
</div>

{mode === "todo" && (
<>
<div>
<div style={styles.label}>やること</div>
<input
value={todoText}
onChange={(e) => setTodoText(e.target.value)}
style={styles.input}
/>
</div>

<div>
<div style={styles.label}>期日</div>
<input
type="date"
value={todoDue}
onChange={(e) => setTodoDue(e.target.value)}
style={styles.input}
/>
</div>
</>
)}

{mode === "wish" && (
<>
<div>
<div style={styles.label}>ほしい物</div>
<input
value={wishText}
onChange={(e) => setWishText(e.target.value)}
style={styles.input}
/>
</div>

<div>
<div style={styles.label}>金額</div>
<input
inputMode="numeric"
value={wishAmountText}
onChange={(e) => setWishAmountText(formatWithComma(e.target.value))}
style={{ ...styles.input, textAlign: "center" }}
placeholder="例: 12,000"
/>
<div style={{ textAlign: "center", fontWeight: 900, marginTop: 6 }}>
{fmtYen(wishAmount)}
</div>
</div>
</>
)}
</div>

<div style={styles.modalFoot}>
{editingId && (
<button style={styles.btnDanger} onClick={onDelete}>
削除
</button>
)}
<button style={styles.btnGhost} onClick={closeModal}>
キャンセル
</button>
<button
style={styles.btn}
onClick={mode === "todo" ? submitTodo : submitWish}
>
{editingId ? "更新" : "登録"}
</button>
</div>
</div>
</div>
)}

{/* ===== TODO filter modal ===== */}
{todoFilterOpen && (
<div style={styles.modalOverlay} onClick={closeTodoFilter} role="dialog" aria-modal="true">
<div style={styles.modal} onClick={stop}>
<div style={styles.modalHead}>
<div>{todoFilterTitle}</div>
<button style={styles.btnGhost} onClick={closeTodoFilter}>OK</button>
</div>

<div style={styles.modalBody}>
{todoHeader === "text" && (
<div>
<div style={styles.filterHint}>部分一致で絞り込み</div>
<input
value={fTodoText}
onChange={(e) => setFTodoText(e.target.value)}
style={styles.input}
placeholder="例: 病院 / 書類 / 支払い"
/>
</div>
)}

{todoHeader === "due" && (
<div>
<div style={styles.filterHint}>期日の範囲</div>
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
<div>
<div style={styles.label}>FROM</div>
<input type="date" value={fTodoDueFrom} onChange={(e) => setFTodoDueFrom(e.target.value)} style={styles.input} />
</div>
<div>
<div style={styles.label}>TO</div>
<input type="date" value={fTodoDueTo} onChange={(e) => setFTodoDueTo(e.target.value)} style={styles.input} />
</div>
</div>
</div>
)}

{todoHeader === "registrant" && (
<div>
<div style={styles.filterHint}>登録者</div>
<select
value={fTodoRegistrant}
onChange={(e) => setFTodoRegistrant(e.target.value as any)}
style={styles.selectBase}
>
<option value="">（指定なし）</option>
<option value="将哉">将哉</option>
<option value="未有">未有</option>
</select>
</div>
)}

{todoHeader === "status" && (
<div>
<div style={styles.filterHint}>状態</div>
<select
value={fTodoStatus}
onChange={(e) => setFTodoStatus(e.target.value as any)}
style={styles.selectBase}
>
<option value="all">（指定なし）</option>
<option value="open">未完了</option>
<option value="done">完了</option>
</select>
</div>
)}
</div>
</div>
</div>
)}

{/* ===== WISH filter modal ===== */}
{wishFilterOpen && (
<div style={styles.modalOverlay} onClick={closeWishFilter} role="dialog" aria-modal="true">
<div style={styles.modal} onClick={stop}>
<div style={styles.modalHead}>
<div>{wishFilterTitle}</div>
<button style={styles.btnGhost} onClick={closeWishFilter}>OK</button>
</div>

<div style={styles.modalBody}>
{wishHeader === "text" && (
<div>
<div style={styles.filterHint}>部分一致で絞り込み</div>
<input
value={fWishText}
onChange={(e) => setFWishText(e.target.value)}
style={styles.input}
placeholder="例: Switch / 靴 / 釣り"
/>
</div>
)}

{wishHeader === "amount" && (
<div>
<div style={styles.filterHint}>金額の範囲</div>
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
<div>
<div style={styles.label}>最小</div>
<input
inputMode="numeric"
value={fWishAmountMin}
onChange={(e) => setFWishAmountMin(formatWithComma(e.target.value))}
style={{ ...styles.input, textAlign: "center" }}
placeholder="例: 1,000"
/>
</div>
<div>
<div style={styles.label}>最大</div>
<input
inputMode="numeric"
value={fWishAmountMax}
onChange={(e) => setFWishAmountMax(formatWithComma(e.target.value))}
style={{ ...styles.input, textAlign: "center" }}
placeholder="例: 50,000"
/>
</div>
</div>
</div>
)}

{wishHeader === "registrant" && (
<div>
<div style={styles.filterHint}>登録者</div>
<select
value={fWishRegistrant}
onChange={(e) => setFWishRegistrant(e.target.value as any)}
style={styles.selectBase}
>
<option value="">（指定なし）</option>
<option value="将哉">将哉</option>
<option value="未有">未有</option>
</select>
</div>
)}

{wishHeader === "status" && (
<div>
<div style={styles.filterHint}>状態</div>
<select
value={fWishStatus}
onChange={(e) => setFWishStatus(e.target.value as any)}
style={styles.selectBase}
>
<option value="all">（指定なし）</option>
<option value="open">未完了</option>
<option value="done">完了</option>
</select>
</div>
)}
</div>

</div>
</div>
)}
</div>
);
}