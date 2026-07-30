import { createContext, ReactNode, useEffect, useState } from "react";
import init, * as oxigraph from "oxigraph/web";
import persons from "../resources/data/persons";

type Props = {
  children?: ReactNode;
};

export const StoreContext = createContext<oxigraph.Store | undefined>(
  undefined
);

const StoreProvider: React.FC<Props> = ({ children }) => {
  const [store, setStore] = useState<oxigraph.Store>();

  useEffect(() => {
    init().then(() => {
      const store = new oxigraph.Store();
      store.load(persons, { format: "text/turtle" });

      setStore(store);
    });
  }, []);

  return store ? (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  ) : (
    <p>Creating the store…</p>
  );
};

export default StoreProvider;
