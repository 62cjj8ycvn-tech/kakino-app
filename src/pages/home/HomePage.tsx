import { Link } from "react-router-dom";

export default function HomePage() {
return (
<div>
<h1>ホーム画面</h1>
<Link to="/budget">家計簿へ</Link>
</div>
);
}