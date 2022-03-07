import type { NextPage } from "next";
import Head from "next/head";
import Interface from "../components/Interface";
import StoreProvider from "../components/StoreProvider";

const Home: NextPage = () => {
  return (
    <div>
      <Head>
        <title>SPARQL Playground</title>
        <meta
          name="description"
          content="SPARQL playgroundA SPARQL playground directly usable from the web"
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
        <StoreProvider>
          <Interface />
        </StoreProvider>
      </main>
    </div>
  );
};

export default Home;
