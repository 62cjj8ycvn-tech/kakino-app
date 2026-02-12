// components/SettingMenu.tsx
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

/* ================= データ ================= */

type MenuItem = { label: string; href: string; key: string };

const MAIN: MenuItem[] = [
{ label: "グラフ", href: "/graph", key: "graph" },
{ label: "支出登録", href: "/expense", key: "expense" },
{ label: "収入登録", href: "/income", key: "income" },
{ label: "貯蓄", href: "/savings", key: "savings" },
{ label: "予算", href: "/budget", key: "budget" },
{ label: "TODO", href: "/todo", key: "todo" },
{ label: "固定費一括", href: "/expense-bulk", key: "expense-bulk" },
{ label: "漏れ確認", href: "/missing-check", key: "missing-check" },
];

const CSV: MenuItem[] = [
{ label: "支出出力", href: "/export-expense", key: "export-expense" },
{ label: "収入出力", href: "/export-income", key: "export-income" },
];

const CSV_IMPORT: MenuItem[] = [
{ label: "収入実績入力", href: "/income-import", key: "income-import" },
{ label: "支出実績入力", href: "/import-expenses", key: "import-expenses" },
{ label: "収入予定入力", href: "/income-plan-import", key: "income-plan-import" },
{ label: "支出予定入力", href: "/budget-import", key: "budget-import" },
];

const OTHER: MenuItem[] = [
{ label: "設定", href: "/settings", key: "settings" },
{ label: "ログアウト", href: "__logout__", key: "logout" },
];

/* ================= 最近履歴 ================= */

const RECENT_KEY = "kakeibo_recent_pages_v1";

type RecentEntry = {
key: string;
label: string;
href: string;
ts: number;
};

function loadRecent(): RecentEntry[] {
if (typeof window === "undefined") return [];
try {
const raw = localStorage.getItem(RECENT_KEY);
const arr = JSON.parse(raw || "[]") as RecentEntry[];
if (!Array.isArray(arr)) return [];
return arr.sort((a, b) => b.ts - a.ts).slice(0, 9);
} catch {
return [];
}
}

function saveRecent(entry: RecentEntry) {
if (typeof window === "undefined") return;
const cur = loadRecent();
const next = [entry, ...cur.filter((x) => x.key !== entry.key)].slice(0, 20);
localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

function recordNav(item: MenuItem) {
saveRecent({
key: item.key,
label: item.label,
href: item.href,
ts: Date.now(),
});
}

/* ================= コンポーネント ================= */

export default function SettingMenu({
open,
onClose,
}: {
open: boolean;
onClose: () => void;
}) {
const router = useRouter();
const [recent, setRecent] = useState<MenuItem[]>([]);

useEffect(() => {
if (!open) return;
const items = loadRecent()
.map((r) =>
[...MAIN, ...CSV, ...CSV_IMPORT].find((x) => x.key === r.key)
)
.filter(Boolean) as MenuItem[];
setRecent(items);
}, [open]);

useEffect(() => {
if (!open) return;
document.body.style.overflow = "hidden";
return () => {
document.body.style.overflow = "";
};
}, [open]);

const navigate = async (item: MenuItem) => {
if (item.key === "logout") {
try {
const mod: any = await import("firebase/auth");
const getAuth = mod.getAuth;
const signOut = mod.signOut;
await signOut(getAuth());
alert("ログアウトしました");
} catch {
alert("firebase/auth が未設定です");
}
onClose();
return;
}

recordNav(item);
onClose();
setTimeout(() => {
router.push(item.href);
}, 0);
};

if (!open) return null;

return (
<div className="overlay" onClick={onClose}>
<div className="modal" onClick={(e) => e.stopPropagation()}>
<div className="header">
<div className="title">メニュー</div>
<button className="close" onClick={onClose}>
✕
</button>
</div>

<div className="body">
{/* 最近 */}
{recent.length > 0 && (
<Section title="最近" items={recent} onSelect={navigate} />
)}

{/* ページ */}
<Section title="ページ" items={MAIN} onSelect={navigate} />

{/* CSV出力 */}
<Section title="CSV出力" items={CSV} onSelect={navigate} />

{/* CSV入力 */}
<Section title="CSV入力" items={CSV_IMPORT} onSelect={navigate} />

{/* その他 */}
<Section title="その他" items={OTHER} onSelect={navigate} />
</div>
</div>

<style jsx>{`
.overlay {
position: fixed;
inset: 0;
background: rgba(15, 23, 42, 0.55);
backdrop-filter: blur(5px);
z-index: 9999;
display: flex;
justify-content: center;
align-items: flex-start;
padding: 16px 12px;
}

.modal {
width: 100%;
max-width: 680px;
background: #ffffff;
border-radius: 22px;
box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
display: flex;
flex-direction: column;
max-height: calc(100vh - 32px);
overflow: hidden;
}

.header {
display: flex;
justify-content: space-between;
align-items: center;
padding: 14px 16px;
background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%);
border-bottom: 1px solid #e5e7eb;
}

.title {
font-weight: 900;
color: #0b4aa2;
}

.close {
border: 1px solid #cbd5e1;
background: #fff;
border-radius: 12px;
padding: 6px 10px;
cursor: pointer;
}

.body {
padding: 12px;
overflow-y: auto;
background: #f6f9ff;
}
`}</style>
</div>
);
}

/* ================= セクション ================= */

function Section({
title,
items,
onSelect,
}: {
title: string;
items: MenuItem[];
onSelect: (item: MenuItem) => void;
}) {
const handleClick = (
e: React.MouseEvent<HTMLButtonElement>,
item: MenuItem
) => {
const btn = e.currentTarget;

const circle = document.createElement("span");
const rect = btn.getBoundingClientRect();
const size = Math.max(rect.width, rect.height);
const x = e.clientX - rect.left - size / 2;
const y = e.clientY - rect.top - size / 2;

circle.style.width = circle.style.height = `${size}px`;
circle.style.left = `${x}px`;
circle.style.top = `${y}px`;
circle.className = "ripple";

const oldRipple = btn.getElementsByClassName("ripple")[0];
if (oldRipple) oldRipple.remove();

btn.appendChild(circle);

onSelect(item);
};

return (
<div className="section">
<div className="sectionTitle">{title}</div>

<div className="grid">
{items.map((item) => (
<button
key={item.key}
className="card"
onClick={(e) => handleClick(e, item)}
>
<div className="label">{item.label}</div>
</button>
))}
</div>

<style jsx>{`
.section {
margin-bottom: 14px;
}

.sectionTitle {
font-size: 12px;
font-weight: 900;
color: #64748b;
margin-bottom: 8px;
}

.grid {
display: grid;
grid-template-columns: repeat(3, 1fr);
gap: 10px;
}

.card {
position: relative;
overflow: hidden;
height: 50px; /* ← 少しコンパクト */
border-radius: 18px;
background: #ffffff;
border: 1px solid #e5e7eb;
box-shadow: 0 10px 22px rgba(15, 23, 42, 0.12),
0 3px 8px rgba(15, 23, 42, 0.08);
display: flex;
align-items: center;
justify-content: center;
cursor: pointer;
padding: 8px; /* ← 上下余白を狭めた */
transition: transform 0.08s ease;
}

.card:active {
transform: scale(0.97);
}

.label {
font-weight: 900;
font-size: 14px;
color: #0b4aa2;
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
}

/* リップル */
.ripple {
position: absolute;
border-radius: 50%;
transform: scale(0);
animation: ripple 600ms linear;
background: rgba(11, 74, 162, 0.25);
pointer-events: none;
}

@keyframes ripple {
to {
transform: scale(4);
opacity: 0;
}
}

@media (max-width: 360px) {
.grid {
grid-template-columns: repeat(2, 1fr);
}
}
`}</style>
</div>
);
}