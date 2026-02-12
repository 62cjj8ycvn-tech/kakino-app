// pages/_app.tsx
import type { AppProps } from "next/app";
import FloatingGear from "../components/FloatingGear";

export default function App({ Component, pageProps }: AppProps) {
return (
<>
<Component {...pageProps} />
<FloatingGear />
</>
);
}