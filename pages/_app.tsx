// pages/_app.tsx
import type { AppProps } from "next/app";
import FloatingGear from "../components/FloatingGear";
import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useRouter } from "next/router";

const PUBLIC_PATHS = ["/login"]; // ログイン不要ページ
const ALLOWED_EMAIL = "wasgwg@gmail.com";
export default function App({ Component, pageProps }: AppProps) {
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

const isPublic = PUBLIC_PATHS.includes(router.pathname);

// 未ログイン
if (!user && !isPublic) {
router.replace("/login");
return;
}

// ログイン済みだがメールが違う
if (user && user.email !== ALLOWED_EMAIL) {
auth.signOut();
router.replace("/login");
return;
}

// ログイン済みでloginページにいる
if (user && router.pathname === "/login") {
router.replace("/graph");
}
}, [checking, user, router.pathname, router]);

// 未ログインで保護ページにいるときは一瞬何も出さない（ちらつき防止）
if (checking) return null;
if (!user && !PUBLIC_PATHS.includes(router.pathname)) return null;

return (
<>
<Component {...pageProps} />
{user && !PUBLIC_PATHS.includes(router.pathname) && <FloatingGear />}
</>
);
}