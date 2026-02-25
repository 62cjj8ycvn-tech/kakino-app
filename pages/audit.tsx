// pages/audit.tsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";

type AuditDoc = {
id: string;
householdId?: string;
uid?: string;
email?: string;
action?: string; // page_view/create/update/delete
page?: string; // /expense etc
entity?: string; // expenses etc
docId?: string;
payload?: any;
ts?: any; // Firestore Timestamp
};

function tsToText(ts: any) {
try {
if (ts?.toDate) {
const d: Date = ts.toDate();
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, "0");
const dd = String(d.getDate()).padStart(2, "0");
const hh = String(d.getHours()).padStart(2, "0");
const mm = String(d.getMinutes()).padStart(2, "0");
const ss = String(d.getSeconds()).padStart(2, "0");
return `${y}/${m}/${dd} ${hh}:${mm}:${ss}`;
}
} catch {}
return "";
}

function splitDateTime(text: string) {
const s = String(text || "");
const [date, time] = s.split(" ");
return { date: date || "", time: time || "" };
}

function actionJP(action?: string) {
switch (action) {
case "page_view":
return "閲覧";
case "create":
return "登録";
case "update":
return "更新";
case "delete":
return "削除";
default:
return action || "不明";
}
}

function pageJP(page?: string) {
const p = page || "";
const map: Record<string, string> = {
"/expense": "支出",
"/graph": "グラフ",
"/budget": "予算",
"/income": "収入",
"/savings": "貯金",
"/todo": "TODO",
"/audit": "操作ログ",
"/settings": "設定",
};
if (map[p]) return map[p];
const fallback = p.replace("/", "");
return fallback || "不明";
}

function entityJP(entity?: string) {
const e = entity || "";
const map: Record<string, string> = {
expenses: "支出明細",
incomes: "収入明細",
budgets: "予算",
goals: "貯金目標",
};
return map[e] ?? e;
}

function fmtYen(n: any) {
const x = Number(n || 0);
const r = Math.round(x);
const sign = r < 0 ? "▲" : "";
return `${sign}¥${Math.abs(r).toLocaleString("ja-JP")}`;
}

function prettifyExpensePayload(payload: any) {
if (!payload || typeof payload !== "object") return null;
const keys = ["registrant", "date", "amount", "category", "subCategory", "source", "memo"];
const hasAny = keys.some((k) => payload?.[k] != null);
if (!hasAny) return null;

return {
registrant: payload.registrant ?? "",
date: payload.date ?? "",
amount: payload.amount ?? 0,
category: payload.category ?? "",
subCategory: payload.subCategory ?? "",
source: payload.source ?? "",
memo: payload.memo ?? "",
};
}

function chipColor(action?: string) {
if (action === "delete") return { bg: "#fee2e2", bd: "#fecaca", fg: "#991b1b" };
if (action === "update") return { bg: "#ffedd5", bd: "#fed7aa", fg: "#9a3412" };
if (action === "create") return { bg: "#dcfce7", bd: "#bbf7d0", fg: "#166534" };
if (action === "page_view") return { bg: "#dbeafe", bd: "#bfdbfe", fg: "#1e3a8a" };
return { bg: "#f1f5f9", bd: "#e2e8f0", fg: "#334155" };
}

function tsToMs(ts: any) {
try {
if (!ts) return 0;
if (typeof ts.toMillis === "function") return ts.toMillis();
if (typeof ts.toDate === "function") return (ts.toDate() as Date).getTime();
if (ts instanceof Date) return ts.getTime();
} catch {}
return 0;
}

// ✅ 2人想定：正反対の色（青 vs オレンジ）
const USER_PALETTE = [
{ tintBg: "#eff6ff", tintBd: "#93c5fd", accent: "#1d4ed8", text: "#0b4aa2" }, // BLUE
{ tintBg: "#fff7ed", tintBd: "#fdba74", accent: "#ea580c", text: "#9a3412" }, // ORANGE
] as const;

function buildEmailColorMap(emails: string[]) {
const uniq = Array.from(new Set(emails.filter(Boolean))).sort(); // 安定化
type UserPalette = (typeof USER_PALETTE)[number];

const map: Record<string, UserPalette> = {};

// ✅ “配列アクセスは undefined かも” を潰す（空配列でも落ちない）
const pickPalette = (i: number): UserPalette => {
const p = USER_PALETTE[i % USER_PALETTE.length];
return (p ?? USER_PALETTE[0]) as UserPalette;
};

uniq.forEach((email, i) => {
map[email] = pickPalette(i);
});

return map;
}

export default function AuditPage() {
const [rows, setRows] = useState<AuditDoc[]>([]);
const [loading, setLoading] = useState(true);
// responsive（iPhone/PCで表示崩れを防ぐ）
const [wide, setWide] = useState(false);
useEffect(() => {
const on = () => setWide(window.innerWidth >= 768);
on();
window.addEventListener("resize", on);
return () => window.removeEventListener("resize", on);
}, []);
// filters
const [fAction, setFAction] = useState<string>("");
const [fPage, setFPage] = useState<string>("");
const [qText, setQText] = useState<string>(""); // email/docId/メモ検索

// details open
const [openId, setOpenId] = useState<string | null>(null);

const load = async () => {
setLoading(true);
try {
// ✅ まずは “インデックス不要” に寄せたいので householdId で絞らずに読む（簡単）
// もし householdId を where で絞りたい場合は、最後に書いた「インデックス作成」も見てね。
const q = query(collection(db, "auditLogs"), orderBy("ts", "desc"), limit(300));
const snap = await getDocs(q);
const list: AuditDoc[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
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

const styles = useMemo(() => {
return {
page: {
padding: 12,
maxWidth: 980,
margin: "0 auto",
fontFamily:
'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Arial',
color: "#0f172a",
background: "#f8fafc",
minHeight: "100dvh",
} as React.CSSProperties,

titleRow: {
display: "flex",
justifyContent: "space-between",
alignItems: "center",
gap: 10,
} as React.CSSProperties,

title: { fontSize: 18, fontWeight: 900, color: "#0b4aa2" } as React.CSSProperties,

card: {
background: "#fff",
border: "1px solid #e5e7eb",
borderRadius: 16,
padding: 12,
boxShadow: "0 8px 22px rgba(15, 23, 42, 0.05)",
} as React.CSSProperties,

cardsGrid: {
display: "grid",
gridTemplateColumns: "1fr 1fr", // ✅ 常に2列
gap: 10,
marginTop: 10,
} as React.CSSProperties,

userCard: (u: { tintBg: string; tintBd: string; accent: string; text: string }) =>
({
background: `linear-gradient(180deg, ${u.tintBg} 0%, #ffffff 100%)`,
border: "1px solid " + u.tintBd,
borderRadius: 16,
padding: 12,
boxShadow: "0 8px 22px rgba(15, 23, 42, 0.05)",
position: "relative",
overflow: "hidden",
} as React.CSSProperties),

userBar: (accent: string) =>
({
position: "absolute",
left: 0,
top: 0,
bottom: 0,
width: 6,
background: accent,
} as React.CSSProperties),

userEmail: (c: string) =>
({
fontSize: 12,
fontWeight: 900,
color: c,
marginBottom: 8,
wordBreak: "break-all",
} as React.CSSProperties),

userStatsGrid: {
display: "grid",
gridTemplateColumns: wide ? "1fr 1fr" : "1fr", // ✅ スマホは縦1列
gap: 8,
} as React.CSSProperties,

statLine: {
borderRadius: 12,
border: "1px solid #e2e8f0",
background: "#ffffff",
padding: wide ? "8px 10px" : "6px 6px", // ✅ スマホは詰める
fontWeight: 900,
fontSize: wide ? 12 : 11,
display: "grid",
gridTemplateColumns: wide ? "52px 1fr" : "44px 1fr", // ✅ 左を固定で最小化
alignItems: "center",
columnGap: 6, // ✅ gap最小
} as React.CSSProperties,

btn: {
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

filterGrid: {
display: "grid",
gridTemplateColumns: "1fr 1fr",
gap: 10,
marginTop: 10,
} as React.CSSProperties,

label: { fontSize: 12, fontWeight: 900, color: "#334155", marginBottom: 4 } as React.CSSProperties,

input: {
width: "100%",
height: 36,
borderRadius: 12,
border: "1px solid #cbd5e1",
padding: "0 10px",
fontSize: 13,
background: "#fff",
outline: "none",
fontWeight: 800,
} as React.CSSProperties,

listWrap: { marginTop: 12, display: "grid", gap: 10 } as React.CSSProperties,

item: (isOpen: boolean): React.CSSProperties => ({
borderRadius: 16,
border: "1px solid " + (isOpen ? "#93c5fd" : "#e5e7eb"),
background: isOpen
? "linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)"
: "#ffffff",
boxShadow: isOpen ? "0 10px 26px rgba(37, 99, 235, 0.10)" : "0 6px 18px rgba(15,23,42,0.04)",
overflow: "hidden",
cursor: "pointer",
}),

itemTop: {
padding: 12,
display: "flex",
justifyContent: "space-between",
alignItems: "center",
gap: 10,
} as React.CSSProperties,

left: { display: "grid", gap: 6 } as React.CSSProperties,

mainLine: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } as React.CSSProperties,

chip: (action?: string): React.CSSProperties => {
const c = chipColor(action);
return {
borderRadius: 999,
padding: "6px 10px",
border: `1px solid ${c.bd}`,
background: c.bg,
color: c.fg,
fontWeight: 900,
fontSize: 12,
whiteSpace: "nowrap",
};
},

meta: { fontSize: 12, fontWeight: 900, color: "#64748b" } as React.CSSProperties,

rightTime: { fontSize: 12, fontWeight: 900, color: "#334155", whiteSpace: "nowrap" } as React.CSSProperties,

detail: {
borderTop: "1px solid #e5e7eb",
padding: 12,
background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
} as React.CSSProperties,

detailTitle: { fontWeight: 900, color: "#0b4aa2", marginBottom: 8 } as React.CSSProperties,

kv: {
display: "grid",
gridTemplateColumns: "110px 1fr",
gap: 8,
fontSize: 12,
fontWeight: 900,
color: "#0f172a",
alignItems: "center",
} as React.CSSProperties,

k: { color: "#64748b" } as React.CSSProperties,

payloadCard: {
marginTop: 10,
borderRadius: 14,
border: "1px solid #e2e8f0",
background: "#fff",
padding: 10,
} as React.CSSProperties,

payloadGrid: {
display: "grid",
gridTemplateColumns: "1fr 1fr",
gap: 8,
marginTop: 8,
} as React.CSSProperties,

payloadLine: {
borderRadius: 12,
border: "1px solid #e2e8f0",
background: "#f8fafc",
padding: "8px 10px",
fontWeight: 900,
fontSize: 12,
display: "flex",
justifyContent: "space-between",
gap: 10,
} as React.CSSProperties,

mono: {
marginTop: 10,
borderRadius: 14,
border: "1px solid #e2e8f0",
background: "#0b1220",
color: "#e5e7eb",
padding: 10,
fontSize: 11,
fontFamily:
'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
overflowX: "auto",
} as React.CSSProperties,
};
}, [wide]);

const filtered = useMemo(() => {
const t = (qText || "").trim().toLowerCase();
return rows.filter((r) => {
if (fAction && (r.action || "") !== fAction) return false;
if (fPage && (r.page || "") !== fPage) return false;

if (!t) return true;
const hay = [
r.email || "",
r.uid || "",
r.docId || "",
r.entity || "",
r.page || "",
JSON.stringify(r.payload || {}),
]
.join(" ")
.toLowerCase();
return hay.includes(t);
});
}, [rows, fAction, fPage, qText]);

type ActionKey = "page_view" | "create" | "update" | "delete";

const lastByEmail = useMemo(() => {
// email -> action -> { ms, ts }
const out: Record<string, Record<ActionKey, { ms: number; ts: any } | null>> = {};

for (const r of rows) {
const email = String(r.email || "");
if (!email) continue;

const a = (r.action || "") as ActionKey;
if (!["page_view", "create", "update", "delete"].includes(a)) continue;

const ms = tsToMs(r.ts);
if (!out[email]) {
out[email] = { page_view: null, create: null, update: null, delete: null };
}
const cur = out[email][a];
if (!cur || ms > cur.ms) out[email][a] = { ms, ts: r.ts };
}

// 表示順を安定（メール昇順）
const sortedEmails = Object.keys(out).sort();
const sorted: typeof out = {};
for (const e of sortedEmails) sorted[e] = out[e];
return sorted;
}, [rows]);

const actions = useMemo(() => {
const set = new Set<string>();
rows.forEach((r) => r.action && set.add(r.action));
return Array.from(set);
}, [rows]);

const pages = useMemo(() => {
const set = new Set<string>();
rows.forEach((r) => r.page && set.add(r.page));
return Array.from(set);
}, [rows]);

// ✅ メールごとの色（2人前提：青/オレンジ）
const emailColorMap = useMemo(() => {
const emails = rows.map((r) => String(r.email || "")).filter(Boolean);
return buildEmailColorMap(emails);
}, [rows]);

const colorOfEmail = (email?: string) => {
const e = String(email || "");
return emailColorMap[e] || USER_PALETTE[0]; // email無しは青扱い
};

const clear = () => {
setFAction("");
setFPage("");
setQText("");
};

return (
<div style={styles.page}>
<div style={styles.titleRow}>
<div style={styles.title}>操作ログ</div>
<div style={{ display: "flex", gap: 8 }}>
<button style={styles.btnGhost} onClick={clear}>
フィルター解除
</button>
<button style={styles.btn} onClick={load}>
再読み込み
</button>
</div>
</div>
{/* ✅ 担当者ごとの最終操作カード */}
{Object.keys(lastByEmail).length > 0 && (
<div style={styles.cardsGrid}>
{Object.entries(lastByEmail).map(([email, m]) => {
const u = colorOfEmail(email);
const getDT = (a: ActionKey) => {
const t = m[a]?.ts ? tsToText(m[a]!.ts) : "";
if (!t) return { date: "—", time: "" };
const x = splitDateTime(t);
return { date: x.date || "—", time: x.time || "" };
};

return (
<div key={email} style={styles.userCard(u)}>
<div style={styles.userBar(u.accent)} />
<div style={styles.userEmail(u.text)}>{email}</div>

<div style={styles.userStatsGrid}>
<div style={styles.statLine}>
<span style={{ color: "#64748b" }}>閲覧</span>
<span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
{getDT("page_view").date}
{getDT("page_view").time ? <><br />{getDT("page_view").time}</> : null}
</span>
</div>
<div style={styles.statLine}>
<span style={{ color: "#64748b" }}>登録</span>
<span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
{getDT("page_view").date}
{getDT("page_view").time ? <><br />{getDT("page_view").time}</> : null}
</span>
</div>
<div style={styles.statLine}>
<span style={{ color: "#64748b" }}>更新</span>
<span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
{getDT("page_view").date}
{getDT("page_view").time ? <><br />{getDT("page_view").time}</> : null}
</span>
</div>
<div style={styles.statLine}>
<span style={{ color: "#64748b" }}>削除</span>
<span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
{getDT("page_view").date}
{getDT("page_view").time ? <><br />{getDT("page_view").time}</> : null}
</span>
</div>
</div>
</div>
);
})}
</div>
)}
<div style={{ ...styles.card, marginTop: 10 }}>
<div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>
“誰が・いつ・何をしたか” がすぐ分かる表示にしています（タップで詳細）
</div>

<div style={styles.filterGrid}>
<div>
<div style={styles.label}>種類</div>
<select value={fAction} onChange={(e) => setFAction(e.target.value)} style={styles.input}>
<option value="">（全部）</option>
{actions.map((a) => (
<option key={a} value={a}>
{actionJP(a)}
</option>
))}
</select>
</div>

<div>
<div style={styles.label}>ページ</div>
<select value={fPage} onChange={(e) => setFPage(e.target.value)} style={styles.input}>
<option value="">（全部）</option>
{pages.map((p) => (
<option key={p} value={p}>
{pageJP(p)}
</option>
))}
</select>
</div>

<div style={{ gridColumn: "1 / -1" }}>
<div style={styles.label}>検索（メール / docId / メモなど）</div>
<input
value={qText}
onChange={(e) => setQText(e.target.value)}
placeholder="例：miyu / 2026-02 / コストコ / abc123"
style={styles.input}
/>
</div>
</div>
</div>

<div style={styles.listWrap}>
{loading ? (
<div style={styles.card}>読み込み中…</div>
) : filtered.length === 0 ? (
<div style={styles.card}>該当するログがありません</div>
) : (
filtered.map((r) => {
const isOpen = openId === r.id;
const time = tsToText(r.ts);
const p = prettifyExpensePayload(r.payload);
const chip = actionJP(r.action);

const u = colorOfEmail(r.email);

return (
<div
key={r.id}
style={{
...styles.item(isOpen),
border: "1px solid " + (isOpen ? u.tintBd : "#e5e7eb"),
background: isOpen
? `linear-gradient(180deg, ${u.tintBg} 0%, #ffffff 100%)`
: u.tintBg,
position: "relative",
}}
onClick={() => setOpenId((prev) => (prev === r.id ? null : r.id))}
role="button"
>
{/* ✅ 左の色バー（ユーザー色） */}
<div
style={{
position: "absolute",
left: 0,
top: 0,
bottom: 0,
width: 6,
background: u.accent,
}}
/>

<div style={styles.itemTop}>
<div style={styles.left}>
<div style={styles.mainLine}>
<div style={styles.chip(r.action)}>{chip}</div>
<div style={{ fontWeight: 900, color: "#0f172a" }}>
{pageJP(r.page)}（{entityJP(r.entity)}）
</div>
</div>

<div style={styles.meta}>
{r.email ? `ユーザー: ${r.email}` : "ユーザー: -"}
{r.docId ? ` / 対象ID: ${r.docId}` : ""}
</div>
</div>

<div style={styles.rightTime}>{time || "時刻不明"}</div>
</div>

{isOpen && (
<div style={styles.detail}>
<div style={styles.detailTitle}>詳細</div>

<div style={styles.kv}>
<div style={styles.k}>種類</div>
<div>{actionJP(r.action)}</div>

<div style={styles.k}>ページ</div>
<div>{pageJP(r.page)}</div>

<div style={styles.k}>対象</div>
<div>{entityJP(r.entity)}</div>

<div style={styles.k}>対象ID</div>
<div>{r.docId || "-"}</div>
</div>

{/* ✅ 削除/更新時に「支出明細っぽい payload」なら、見やすいカード表示 */}
{p && (
<div style={styles.payloadCard}>
<div style={{ fontWeight: 900, color: "#0f172a" }}>
{r.action === "delete" ? "削除された明細" : "対象明細（保存時点）"}
</div>
<div style={styles.payloadGrid}>
<div style={styles.payloadLine}>
<span style={{ color: "#64748b" }}>登録者</span>
<span>{p.registrant || "-"}</span>
</div>
<div style={styles.payloadLine}>
<span style={{ color: "#64748b" }}>日付</span>
<span>{p.date || "-"}</span>
</div>
<div style={styles.payloadLine}>
<span style={{ color: "#64748b" }}>カテゴリ</span>
<span>{p.category || "-"}</span>
</div>
<div style={styles.payloadLine}>
<span style={{ color: "#64748b" }}>内訳</span>
<span>{p.subCategory || "-"}</span>
</div>
<div style={styles.payloadLine}>
<span style={{ color: "#64748b" }}>支出元</span>
<span>{p.source || "-"}</span>
</div>
<div style={styles.payloadLine}>
<span style={{ color: "#64748b" }}>金額</span>
<span>{fmtYen(p.amount)}</span>
</div>
</div>

{p.memo ? (
<div style={{ marginTop: 8, fontWeight: 900, color: "#334155" }}>
メモ：{p.memo}
</div>
) : null}
</div>
)}

{/* ✅ payload の“全部”も見れる（英語でもここだけ） */}
{r.payload != null && (
<div style={styles.mono}>
{JSON.stringify(r.payload, null, 2)}
</div>
)}
</div>
)}
</div>
);
})
)}
</div>
</div>
);
}