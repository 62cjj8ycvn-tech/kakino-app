// components/AuthGate.tsx
import React, { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useRouter } from "next/router";

export default function AuthGate({ children }: { children: React.ReactNode }) {
const router = useRouter();
const [user, setUser] = useState<User | null>(null);
const [checking, setChecking] = useState(true);

useEffect(() => {
const unsub = onAuthStateChanged(auth, (u) => {
setUser(u);
setChecking(false);
});
return () => unsub();
}, []);

useEffect(() => {
if (checking) return;

// ログインページは常にOK
if (router.pathname === "/login") {
// すでにログインしてるのに /login に来たら /graph へ
if (user) router.replace("/graph");
return;
}

// それ以外は未ログインなら/loginへ
if (!user) {
const next = encodeURIComponent(router.asPath || "/graph");
router.replace(`/login?next=${next}`);
}
}, [checking, user, router.pathname, router.asPath]);

if (checking) {
return (
<div style={{ padding: 16, fontFamily: "system-ui", fontWeight: 900, color: "#0b4aa2" }}>
読み込み中…
</div>
);
}

// 未ログインで/loginへ飛ばし中は何も描画しない
if (!user && router.pathname !== "/login") return null;

return <>{children}</>;
}
