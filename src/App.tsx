import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import HomePage from "./pages/home/HomePage";
import BudgetPage from "./pages/budget/BudgetPage";
import GraphPage from "./pages/graph/GraphPage";

export default function App() {
return (
<BrowserRouter>
<nav style={{ padding: 8 }}>
<Link to="/">ホーム</Link>{" | "}
<Link to="/budget">入力</Link>{" | "}
<Link to="/graph">グラフ</Link>
</nav>

<Routes>
<Route path="/" element={<HomePage />} />
<Route path="/budget" element={<BudgetPage />} />
<Route path="/graph" element={<GraphPage />} />
</Routes>
</BrowserRouter>
);
}