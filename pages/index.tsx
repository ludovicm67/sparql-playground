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
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <StoreProvider>
        <Interface />
      </StoreProvider>
    </>
  );
};

export default Home;
