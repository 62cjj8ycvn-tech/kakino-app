// components/FloatingGear.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";

type Pos = { x: number; y: number };

const STORAGE_KEY = "kakeibo_floating_gear_pos_v1";

function clamp(n: number, min: number, max: number) {
return Math.min(max, Math.max(min, n));
}

function safeParsePos(v: string | null): Pos | null {
if (!v) return null;
try {
const obj = JSON.parse(v);
if (typeof obj?.x === "number" && typeof obj?.y === "number") return obj;
} catch {}
return null;
}

type Item = { href: string; label: string };

export default function FloatingGear() {
const router = useRouter();
const onLogout = async () => {
setOpen(false);
try {
await signOut(auth);
} catch (e) {
console.error(e);
} finally {
router.replace("/login");
}
};
const items = useMemo<Item[]>(
() => [
{ href: "/expense", label: "支出" },
{ href: "/graph", label: "グラフ" },
{ href: "/todo", label: "TODO" },
{ href: "/income", label: "収入" },
{ href: "/savings", label: "貯金" },
{ href: "/budget", label: "予算" },
{ href: "/goals", label: "積立" },
{ href: "/expense-bulk", label: "固定費一括登録" },
{ href: "/missing-check", label: "漏れチェック" },
{ href: "/export-expense", label: "CSV出力（支出）" },
{ href: "/export-income", label: "CSV出力（収入）" },
{ href: "/import-expenses", label: "CSV入力（支出）" },
{ href: "/income-import", label: "CSV入力（収入）" },
{ href: "/budget-import", label: "CSV入力（予定支出）" },
{ href: "/income-plan-import", label: "CSV入力（予定収入）" },
{ href: "/settings", label: "設定" },
],
[]
);

// グルーピング（上：主要6、下：残り）
const primaryHrefs = useMemo(
() => new Set(["/expense", "/graph", "/todo", "/income", "/savings", "/budget", "goals"]),
[]
);

const primaryItems = useMemo(
() => items.filter((i) => primaryHrefs.has(i.href)),
[items, primaryHrefs]
);
const otherItems = useMemo(
() => items.filter((i) => !primaryHrefs.has(i.href)),
[items, primaryHrefs]

);

const containerRef = useRef<HTMLDivElement | null>(null);
const [open, setOpen] = useState(false);

// ドラッグ関連
const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
const draggingRef = useRef(false);
const movedRef = useRef(false);
const startPointerRef = useRef<{ x: number; y: number } | null>(null);
const startPosRef = useRef<Pos | null>(null);

const SIZE = 56;
const GAP = 10;

// 初回：localStorageから位置復元
useEffect(() => {
if (typeof window === "undefined") return;

const saved = safeParsePos(localStorage.getItem(STORAGE_KEY));

if (saved) {
setPos(saved);
} else {
// 初回だけ右下に配置
const w = window.innerWidth;
const h = window.innerHeight;
setPos({
x: w - SIZE - GAP,
y: h - SIZE - GAP,
});
}
}, []);

// 位置保存
useEffect(() => {
if (typeof window === "undefined") return;
localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
}, [pos]);

// 画面サイズ変更時に、画面内へクランプ
useEffect(() => {
function onResize() {
const w = window.innerWidth;
const h = window.innerHeight;
setPos((p) => ({
x: clamp(p.x, GAP, w - SIZE - GAP),
y: clamp(p.y, GAP, h - SIZE - GAP),
}));
}
window.addEventListener("resize", onResize);
return () => window.removeEventListener("resize", onResize);
}, []);

// Escで閉じる
useEffect(() => {
function onKey(e: KeyboardEvent) {
if (e.key === "Escape") setOpen(false);
}
document.addEventListener("keydown", onKey);
return () => document.removeEventListener("keydown", onKey);
}, []);

// モーダル開いてる間は背景スクロール禁止
useEffect(() => {
if (!open) return;
const prev = document.body.style.overflow;
document.body.style.overflow = "hidden";
return () => {
document.body.style.overflow = prev;
};
}, [open]);

function beginDrag(clientX: number, clientY: number) {
draggingRef.current = true;
movedRef.current = false;
startPointerRef.current = { x: clientX, y: clientY };
startPosRef.current = { ...pos };
setOpen(false);
}

function moveDrag(clientX: number, clientY: number) {
if (!draggingRef.current) return;
const sp = startPointerRef.current;
const sPos = startPosRef.current;
if (!sp || !sPos) return;

const dx = clientX - sp.x;
const dy = clientY - sp.y;

if (!movedRef.current && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
movedRef.current = true;
}

const w = window.innerWidth;
const h = window.innerHeight;

setPos({
x: clamp(sPos.x + dx, GAP, w - SIZE - GAP),
y: clamp(sPos.y + dy, GAP, h - SIZE - GAP),
});
}

function endDrag() {
draggingRef.current = false;
startPointerRef.current = null;
startPosRef.current = null;
}

function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
if (e.button !== 0) return;
(e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
beginDrag(e.clientX, e.clientY);
}

function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
moveDrag(e.clientX, e.clientY);
}

function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
try {
(e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
} catch {}
const wasMoved = movedRef.current;
endDrag();
if (!wasMoved) setOpen(true);
}

function go(href: string) {
setOpen(false);
router.push(href);
}

const GroupCard = ({
title,
subtitle,
children,
}: {
title: string;
subtitle?: string;
children: React.ReactNode;
}) => (
<div
style={{
borderRadius: 18,
border: "1px solid rgba(2,6,23,0.10)",
background:
"linear-gradient(180deg, rgba(255,255,255,0.88), rgba(248,250,252,0.80))",
boxShadow: "0 14px 30px rgba(2,6,23,0.10)",
overflow: "hidden",
}}
>
<div
style={{
padding: "12px 14px",
borderBottom: "1px solid rgba(2,6,23,0.08)",
display: "flex",
alignItems: "baseline",
justifyContent: "space-between",
gap: 10,
background:
"linear-gradient(180deg, rgba(59,130,246,0.10), rgba(37,99,235,0.04))",
}}
>
<div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
<div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>
{title}
</div>
{subtitle && (
<div style={{ fontSize: 11, color: "#334155", opacity: 0.8 }}>
{subtitle}
</div>
)}
</div>
</div>
<div style={{ padding: 14 }}>{children}</div>
</div>
);

const MenuItemCard = ({ it }: { it: Item }) => {
const active = router.pathname === it.href;

return (
<Link
key={it.href}
href={it.href}
onClick={(e) => {
e.preventDefault();
go(it.href);
}}
style={{
textDecoration: "none",
color: "inherit",
borderRadius: 16,
border: active
? "1px solid rgba(37,99,235,0.35)"
: "1px solid rgba(2,6,23,0.10)",
background: active
? "linear-gradient(180deg, rgba(37,99,235,0.16), rgba(59,130,246,0.10))"
: "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,250,252,0.86))",
boxShadow: active
? "0 14px 30px rgba(37,99,235,0.18)"
: "0 10px 22px rgba(2,6,23,0.08)",
padding: "14px 12px",
display: "grid",
placeItems: "center", // 中央寄せ
}}
>
<div
style={{
textAlign: "center",
fontSize: 11, // 1段階小さく
fontWeight: 900,
color: "#0f172a",
letterSpacing: 0.2,
lineHeight: 1.15,
}}
>
{it.label}
</div>
</Link>
);
};

return (
<>
{/* 浮遊ギア */}
<div
ref={containerRef}
style={{
position: "fixed",
left: pos.x,
top: pos.y,
zIndex: 9999,
userSelect: "none",
touchAction: "none",
}}
>
<button
aria-label="メニュー"
onPointerDown={onPointerDown}
onPointerMove={onPointerMove}
onPointerUp={onPointerUp}
style={{
width: SIZE,
height: SIZE,
borderRadius: 999,
border: "1px solid rgba(255,255,255,0.35)",
background:
"linear-gradient(180deg, rgba(193, 202, 215, 0.95), rgba(185, 193, 211, 0.95))",
boxShadow:
"0 16px 40px rgba(2,6,23,0.18), inset 0 1px 0 rgba(255,255,255,0.35)",
cursor: "grab",
display: "grid",
placeItems: "center",
padding: 0,
}}
>
<span
aria-hidden="true"
style={{
fontSize: 26,
lineHeight: 1,
filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.25))",
transform: open ? "rotate(18deg)" : "rotate(0deg)",
transition: "transform 140ms ease",
}}
>
⚙️
</span>
</button>
</div>

{/* 中央モーダル */}
{open && (
<div
role="dialog"
aria-modal="true"
aria-label="ショートカットメニュー"
onMouseDown={() => setOpen(false)}
onTouchStart={() => setOpen(false)}
style={{
position: "fixed",
inset: 0,
zIndex: 10000,
display: "grid",
placeItems: "center",
padding: 24, // ← 余白増やして見切れ対策
background:
"radial-gradient(900px 600px at 50% 30%, rgba(59,130,246,0.18), transparent 60%), rgba(2,6,23,0.55)",
backdropFilter: "blur(10px)",
WebkitBackdropFilter: "blur(10px)",
}}
>
<div
onMouseDown={(e) => e.stopPropagation()}
onTouchStart={(e) => e.stopPropagation()}
style={{
width: "min(560px, 92vw)",
maxHeight: "76vh", // 少し下げて安全側に
overflow: "hidden",
borderRadius: 20,

border: "1px solid rgba(255,255,255,0.20)",
background:
"linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.92))",
boxShadow:
"0 30px 80px rgba(2,6,23,0.55), inset 0 1px 0 rgba(255,255,255,0.6)",
}}
>
{/* Header */}
<div
style={{
padding: "14px 14px 10px",
borderBottom: "1px solid rgba(2,6,23,0.08)",
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: 10,
}}
>
<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
<div
style={{
width: 36,
height: 36,
borderRadius: 12,
display: "grid",
placeItems: "center",
background:
"linear-gradient(180deg, rgba(59,130,246,0.14), rgba(37,99,235,0.10))",
border: "1px solid rgba(37,99,235,0.18)",
}}
>
<span style={{ fontSize: 18 }}>⚙️</span>
</div>
<div>
<div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>
メニュー
</div>
<div style={{ fontSize: 12, opacity: 0.7, color: "#334155" }}>
主要と管理系で分けています
</div>
</div>
</div>

<button
onClick={() => setOpen(false)}
style={{
height: 36,
padding: "0 12px",
borderRadius: 12,
border: "1px solid rgba(2,6,23,0.10)",
background: "rgba(2,6,23,0.02)",
cursor: "pointer",
fontWeight: 800,
color: "#0f172a",
}}
>
閉じる
</button>
</div>

{/* Body（ここだけスクロール） */}
<div
style={{
padding: 14,
maxHeight: "calc(76vh - 64px)", // header分を引く（見切れ対策）
overflow: "auto",
}}
>
<div style={{ display: "grid", gap: 12 }}>
{/* 主要 */}
<GroupCard title="主要" subtitle="日常的に使う">
<div
style={{
display: "grid",
gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
gap: 10,
}}
>
{primaryItems.map((it) => (
<MenuItemCard key={it.href} it={it} />
))}
</div>
</GroupCard>
<GroupCard title="アカウント" subtitle="ログアウト">
<button
onClick={onLogout}
style={{
width: "100%",
height: 46,
borderRadius: 14,
border: "1px solid rgba(220,38,38,0.25)",
background: "linear-gradient(180deg, rgba(254,226,226,0.85), rgba(255,255,255,0.95))",
color: "#991b1b",
fontWeight: 900,
cursor: "pointer",
display: "grid",
placeItems: "center",
boxShadow: "0 10px 22px rgba(15,23,42,0.08)",
}}
>
ログアウト
</button>
</GroupCard>
{/* 管理・入出力 */}
<GroupCard title="管理・入出力" subtitle="一括/漏れ/CSV/設定など">
<div
style={{
display: "grid",
gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
gap: 10,
}}
>
{otherItems.map((it) => (
<MenuItemCard key={it.href} it={it} />
))}
</div>
</GroupCard>
</div>

{/* 下の見切れ防止のための「安全余白」 */}
<div style={{ height: 30 }} />

</div>
</div>
</div>
)}
</>
);
}