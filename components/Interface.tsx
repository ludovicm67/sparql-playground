import { useContext, useState } from "react";
import Editor from "@monaco-editor/react";
import { StoreContext } from "./StoreProvider";
import { handleResults, QueryResult } from "../lib/results";
import Results from "./Results";

const Interface = () => {
  const store = useContext(StoreContext);
  const [query, setQuery] = useState<string>(
    "CONSTRUCT { ?s ?p ?o }\nWHERE { ?s ?p ?o }"
  );
  const [results, setResults] = useState<QueryResult>("");
  const [error, setError] = useState<string | undefined>();

  if (!store) {
    return <div>Missing store!</div>;
  }

  const execQuery = () => {
    try {
      const queryResults = store.query(query);
      const parsedResults = handleResults(queryResults);

      setResults(parsedResults);
      setError(undefined);
    } catch (e: any) {
      setError(e.message);
      setResults("");
    }
  };

  return (
    <div>
      <div>
        <Editor
          height="50vh"
          value={query}
          defaultLanguage="sparql"
          language="sparql"
          theme="vs-dark"
          onChange={(e) => setQuery(`${e}`)}
        />
        <button onClick={execQuery}>Run query</button>
      </div>
      {error ? <p>ERROR: {error}</p> : <Results results={results}></Results>}
    </div>
  );
};

export default Interface;
