import type { NextPage } from "next";
import Head from "next/head";
import Link from "next/link";
import GraphMark from "../components/GraphMark";

const NotFound: NextPage = () => (
  <>
    <Head>
      <title>Not found · SPARQL Playground</title>
      <meta name="robots" content="noindex" />
      {/* Kept in step with the resolved background by `syncThemeColor`. */}
      <meta name="theme-color" content="#0a0c11" />
      <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      <link rel="alternate icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    </Head>

    <main className="notfound">
      <GraphMark size={52} className="notfound-mark" />
      <p className="notfound-code">404</p>
      <h1 className="notfound-title">There is nothing at this address</h1>
      <p className="notfound-text">
        The SPARQL Playground is a single page. Links into it carry their state
        after the <code>?</code> or <code>#</code>, so a stray path like this one
        matches nothing.
      </p>
      <Link className="btn-run notfound-action" href="/">
        Go to the playground
      </Link>
    </main>
  </>
);

export default NotFound;
