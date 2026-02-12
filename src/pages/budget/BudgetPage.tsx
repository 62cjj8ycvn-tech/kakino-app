import { useState } from "react";

export default function BudgetPage() {
const [amount, setAmount] = useState<number>(0);

return (
<div>
<h1>家計簿入力</h1>

<input
type="number"
placeholder="金額"
value={amount}
onChange={(e) => setAmount(Number(e.target.value))}
/>

<br />
<br />

<button onClick={() => alert(`¥${amount} 登録`)}>
登録
</button>
</div>
);
}