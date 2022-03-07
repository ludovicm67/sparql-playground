import { useContext } from "react";
import { StoreContext } from "./StoreProvider";
import * as oxigraph from "oxigraph/web";

const Interface = () => {
  const store = useContext(StoreContext);

  if (!store) {
    return <div>Missing store!</div>;
  }

  const ex = oxigraph.namedNode("http://example/");
  const schemaName = oxigraph.namedNode("http://schema.org/name");
  store.add(
    oxigraph.triple(ex, schemaName, oxigraph.literal("example", undefined))
  );
  for (const binding of store.query(
    "SELECT ?name WHERE { <http://example/> <http://schema.org/name> ?name }"
  )) {
    console.log(binding.get("name").value);
  }

  return (
    <div>
      <textarea defaultValue="test" />
    </div>
  );
};

export default Interface;
