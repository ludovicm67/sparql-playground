import { useContext, useState } from "react";
import Editor from "@monaco-editor/react";
import { StoreContext } from "./StoreProvider";
import { handleResults, QueryResult } from "../lib/results";
import Results from "./Results";

const Interface = () => {
  const store = useContext(StoreContext);
  const [query, setQuery] = useState<string>(`# Some common prefixes
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

# Get the first 10 triples
SELECT * WHERE {
  ?sub ?pred ?obj .
} LIMIT 10
`);
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
      <h1>SPARQL Playground</h1>
      <div>
        <Editor
          height="50vh"
          value={query}
          defaultLanguage="sparql"
          language="sparql"
          theme="vs-dark"
          options={{
            scrollBeyondLastLine: false,
            fontSize: 24,
          }}
          onChange={(e) => setQuery(`${e}`)}
        />
        <button onClick={execQuery}>Run query</button>
      </div>
      {error ? <p>ERROR: {error}</p> : <Results results={results}></Results>}
    </div>
  );
};

export default Interface;
