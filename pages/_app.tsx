import "../styles/globals.css";
// Points Monaco at our own copy rather than a CDN. Imported here so it applies
// no matter which component ends up mounting an editor first.
import "../lib/monacoLoader";
import type { AppProps } from "next/app";

function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}

export default MyApp;
