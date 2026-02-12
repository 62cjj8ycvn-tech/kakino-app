import { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase"; // ← パスは環境に合わせて調整

// カテゴリ & 内訳（完全固定・確定版）
const CATEGORY_MAP: Record<string, string[]> = {
食費: ["食材", "外食", "コンビニ"],
光熱費: ["電気", "ガス", "水道", "灯油"],
消耗品: ["ダイソー", "薬局", "ドンキ"],
車: ["ガソリン", "高速", "駐車場", "洗車", "オイル交換"],
娯楽費: ["精算"],
会社: ["諸会費", "斡旋", "試験", "飲み", "慶弔費", "交通費", "スーツ", "文房具"],
子供: ["病院", "アカホ", "保育園"],
医療費: ["病院"],
固定費: ["家賃", "携帯", "保険", "美容院", "奨学金", "マツパ", "新聞", "サブスク"],
その他: ["その他"],
積立: ["積立"],
振替: ["ATM（現金 −）", "ATM（口振 ＋）"],
};

export default function ExpenseRegisterPage() {
const [amount, setAmount] = useState("");
const [category, setCategory] = useState("");
const [subCategory, setSubCategory] = useState("");
const [freeText, setFreeText] = useState("");
const [loading, setLoading] = useState(false);

const isFreeInput = subCategory === "自由入力";

const canSubmit =
amount !== "" &&
Number(amount) > 0 &&
category !== "" &&
subCategory !== "" &&
(!isFreeInput || freeText.trim() !== "");

const handleSubmit = async () => {
if (!canSubmit) {
alert("必須項目が未入力です");
return;
}

setLoading(true);

try {
await addDoc(collection(db, "expenses"), {
amount: Number(amount),
category,
subCategory: isFreeInput ? freeText.trim() : subCategory,
createdAt: serverTimestamp(),
});

alert("登録しました");

// 入力リセット
setAmount("");
setCategory("");
setSubCategory("");
setFreeText("");
} catch (error) {
console.error(error);
alert("登録に失敗しました");
} finally {
setLoading(false);
}
};

return (
<div style={{ padding: 16, maxWidth: 400 }}>
<h2>支出登録</h2>

{/* 金額 */}
<div>
<input
type="number"
placeholder="金額"
value={amount}
onChange={(e) => setAmount(e.target.value)}
/>
</div>

<br />

{/* カテゴリ */}
<div>
<select
value={category}
onChange={(e) => {
setCategory(e.target.value);
setSubCategory("");
setFreeText("");
}}
>
<option value="">カテゴリを選択</option>
{Object.keys(CATEGORY_MAP).map((cat) => (
<option key={cat} value={cat}>
{cat}
</option>
))}
</select>
</div>

<br />

{/* カテゴリ内訳 */}
{category && (
<div>
<select
value={subCategory}
onChange={(e) => {
setSubCategory(e.target.value);
setFreeText("");
}}
>
<option value="">カテゴリ内訳を選択</option>
{CATEGORY_MAP[category].map((sub) => (
<option key={sub} value={sub}>
{sub}
</option>
))}
<option value="自由入力">自由入力</option>
</select>
</div>
)}

<br />

{/* 自由入力メモ */}
{isFreeInput && (
<div>
<input
type="text"
placeholder="カテゴリ内訳を入力"
value={freeText}
onChange={(e) => setFreeText(e.target.value)}
/>
</div>
)}

<br />

<button onClick={handleSubmit} disabled={!canSubmit || loading}>
{loading ? "登録中..." : "登録"}
</button>
</div>
);
}