import { useEffect, useState } from "react";
import {
collection,
getDocs,
query,
Timestamp,
} from "firebase/firestore";
import { db } from "../../firebase";

import {
PieChart,
Pie,
Cell,
Tooltip,
Legend,
} from "recharts";

type Budget = {
amount: number;
category: string;
createdAt: Timestamp;
};

type CategoryTotal = {
name: string;
value: number;
};

const COLORS = [
"#0088FE",
"#00C49F",
"#FFBB28",
"#FF8042",
"#AF19FF",
];

export default function GraphPage() {
const [data, setData] = useState<CategoryTotal[]>([]);

const fetchCategoryTotals = async () => {
const q = query(collection(db, "budgets"));
const snapshot = await getDocs(q);

const map: Record<string, number> = {};

snapshot.docs.forEach((doc) => {
const d = doc.data() as Budget;
map[d.category] =
(map[d.category] ?? 0) + d.amount;
});

const result: CategoryTotal[] = Object.keys(map).map(
(key) => ({
name: key,
value: map[key],
})
);

setData(result);
};

useEffect(() => {
fetchCategoryTotals();
}, []);

return (
<div style={{ padding: 16 }}>
<h1>支出の内訳</h1>

{data.length === 0 ? (
<p>データがありません</p>
) : (
<PieChart width={400} height={400}>
<Pie
data={data}
cx="50%"
cy="50%"
label
outerRadius={130}
dataKey="value"
>
{data.map((_, index) => (
<Cell
key={index}
fill={COLORS[index % COLORS.length]}
/>
))}
</Pie>
<Tooltip />
<Legend />
</PieChart>
)}
</div>
);
}