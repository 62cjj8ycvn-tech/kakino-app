import { HashRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/home/HomePage";
import BudgetPage from "./pages/budget/BudgetPage";

function App() {
return (
<HashRouter>
<Routes>
<Route path="/" element={<HomePage />} />
<Route path="/budget" element={<BudgetPage />} />
</Routes>
</HashRouter>
);
}

export default App;
