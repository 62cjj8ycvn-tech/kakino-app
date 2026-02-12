import { useState } from "react";
import { signup } from "../../services/authService";

export default function SignupPage() {
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");

const submit = async () => {
await signup(email, password);
location.href = "/";
};

return (
<div>
<h1>新規登録</h1>
<input placeholder="メール" onChange={e => setEmail(e.target.value)} />
<input type="password" placeholder="パスワード" onChange={e => setPassword(e.target.value)} />
<button onClick={submit}>登録</button>
</div>
);
}
