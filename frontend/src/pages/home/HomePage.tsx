import { useNavigate } from "react-router-dom";

export default function HomePage() {
const navigate = useNavigate();

return (
<div style={{ padding: "24px" }}>
<h1>ホーム画面</h1>

<div style={{ marginTop: "24px", display: "flex", gap: "12px" }}>
<button onClick={() => navigate("/budget")}>
予算を登録
</button>

<button onClick={() => navigate("/variance")}>
予算差異を見る
</button>

<button onClick={() => navigate("/graph")}>
グラフを見る
</button>
</div>
</div>
);
}