// pages/login.tsx
import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useRouter } from "next/router";

export default function LoginPage() {
const router = useRouter();
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
const [busy, setBusy] = useState(false);
const [msg, setMsg] = useState("");

const onLogin = async () => {
setMsg("");
if (!email || !password) {
setMsg("メールとパスワードを入力してね");
return;
}
setBusy(true);
try {
await signInWithEmailAndPassword(auth, email.trim(), password);
router.replace("/graph");
} catch (e: any) {
setMsg(String(e?.message ?? e));
} finally {
setBusy(false);
}
};

return (
<div style={{ padding: 16, maxWidth: 420, margin: "0 auto", fontFamily: "system-ui" }}>
<h2 style={{ margin: "10px 0", color: "#0b4aa2" }}>ログイン</h2>

<div style={{ display: "grid", gap: 10 }}>
<input
value={email}
onChange={(e) => setEmail(e.target.value)}
placeholder="メール"
inputMode="email"
style={{
height: 40,
borderRadius: 12,
border: "1px solid #cbd5e1",
padding: "0 12px",
fontWeight: 800,
}}
/>
<input
value={password}
onChange={(e) => setPassword(e.target.value)}
placeholder="パスワード"
type="password"
style={{
height: 40,
borderRadius: 12,
border: "1px solid #cbd5e1",
padding: "0 12px",
fontWeight: 800,
}}
/>

<button
onClick={onLogin}
disabled={busy}
style={{
height: 42,
borderRadius: 12,
border: "1px solid #93c5fd",
background: "#1d4ed8",
color: "#fff",
fontWeight: 900,
cursor: busy ? "not-allowed" : "pointer",
}}
>
{busy ? "ログイン中..." : "ログイン"}
</button>

{msg && <div style={{ color: "#dc2626", fontWeight: 800, fontSize: 12 }}>{msg}</div>}
</div>

<div style={{ marginTop: 12, color: "#64748b", fontWeight: 800, fontSize: 12, lineHeight: 1.6 }}>
※ まずは Firebase Authentication の Email/Password を有効化して、
同じ1アカウントを夫婦で共有する運用にする想定。
</div>
</div>
);
}
