import type { NextPage } from "next";
import Head from "next/head";
import Interface from "../components/Interface";
import StoreProvider from "../components/StoreProvider";

const Home: NextPage = () => {
  return (
    <>
      <Head>
        <title>SPARQL Playground</title>
        <meta
          name="description"
          content="Write and run SPARQL queries straight from your browser, against an Oxigraph triple store running locally on WebAssembly."
        />
        <meta name="theme-color" content="#0a0c11" />
        {/* SVG first for browsers that take it, .ico as the fallback. */}
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="alternate icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>

      <StoreProvider>
        <Interface />
      </StoreProvider>
    </>
  );
};

export default Home;
