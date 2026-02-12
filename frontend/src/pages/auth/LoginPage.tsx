import { useState } from "react";
import { login } from "../../services/authService";

export default function LoginPage() {
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");

const submit = async () => {
await login(email, password);
location.href = "/";
};

return (
<div>
<h1>ログイン</h1>
<input placeholder="メール" onChange={e => setEmail(e.target.value)} />
<input type="password" placeholder="パスワード" onChange={e => setPassword(e.target.value)} />
<button onClick={submit}>ログイン</button>
</div>
);
}
