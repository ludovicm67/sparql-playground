import {
  createContext,
  JSXElementConstructor,
  ReactElement,
  useEffect,
  useState,
} from "react";
import init, * as oxigraph from "oxigraph/web";

type ReactChild =
  | string
  | number
  | ReactElement<any, string | JSXElementConstructor<any>>;

type Props = {
  children?: ReactChild | ReactChild[];
};

export const StoreContext = createContext<oxigraph.Store | undefined>(
  undefined
);

const StoreProvider: React.FC<Props> = ({ children }) => {
  const [store, setStore] = useState<oxigraph.Store>();

  useEffect(() => {
    init().then(() => {
      const store = new oxigraph.Store();
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
