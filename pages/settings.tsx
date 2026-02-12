// pages/settings.tsx
import Link from "next/link";

export default function SettingsPage() {
return (
<div style={{
maxWidth: 900,
margin: "0 auto",
padding: 12,
fontFamily:
'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Arial',
color: "#0f172a",
}}>
<div style={{
background: "#fff",
border: "1px solid #e5e7eb",
borderRadius: 16,
padding: 12,
boxShadow: "0 10px 26px rgba(15, 23, 42, 0.06)",
}}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
<div style={{ fontWeight: 900, color: "#0b4aa2", fontSize: 16 }}>設定</div>
<Link href="/graph" style={{
textDecoration: "none",
fontWeight: 900,
color: "#0b4aa2",
border: "1px solid #cbd5e1",
padding: "8px 10px",
borderRadius: 12,
background: "#fff"
}}>
← 戻る
</Link>
</div>

<div style={{ marginTop: 12, fontWeight: 900, color: "#64748b" }}>
ここは今後、テーマ/表示/データ管理などの設定を入れる場所。
</div>

<div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: "#f8fbff", border: "1px dashed #cbd5e1" }}>
・目安のデフォルトON/OFF<br/>
・登録者の初期値<br/>
・バックアップ/復元（将来）<br/>
</div>
</div>
</div>
);
}