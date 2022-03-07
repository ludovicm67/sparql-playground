import { useContext, useState } from "react";
import { StoreContext } from "./StoreProvider";
import persons from "../resources/data/persons";
import { BlankNode, Literal, NamedNode, Quad } from "oxigraph/web";

type Term = NamedNode | Literal | BlankNode;

type QueryResultBindingValue =
  | {
      type: "uri";
      value: string;
    }
  | {
      type: "literal";
      value: string;
      ["xml:lang"]?: string;
      datatype?: string;
    }
  | {
      type: "bnode";
      value: string;
    };

type QueryResultBinding = Record<string, QueryResultBindingValue>;

// try to follow https://www.w3.org/TR/sparql11-results-json/
type QueryResult =
  | {
      head: {
        vars?: string[];
      };
      boolean?: boolean;
      results?: {
        bindings?: QueryResultBinding[];
      };
    }
  | string;

const Interface = () => {
  const store = useContext(StoreContext);
  const [query, setQuery] = useState<string>(
    "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }"
  );
  const [results, setResults] = useState<string>("");
  const [error, setError] = useState<string | undefined>();

  if (!store) {
    return <div>Missing store!</div>;
  }

  store.load(persons, "text/turtle", undefined, undefined);

  const askResult = (queryResults: boolean): QueryResult => {
    return {
      head: {},
      boolean: queryResults,
    };
  };

  const emptyResult = (): QueryResult => {
    return {
      head: {},
      results: {
        bindings: [],
      },
    };
  };

  const selectResult = (queryResults: Map<string, Term>[]): QueryResult => {
    const vars = new Set<string>();

    const bindings = queryResults.map((line): QueryResultBinding => {
      const keys = Array.from(line.keys());
      const res: Record<string, QueryResultBindingValue> = {};

      keys.map((k) => {
        vars.add(k);

        const term = line.get(k);
        if (!term) {
          return;
        }

        switch (term.termType) {
          case "BlankNode":
            res[k] = {
              type: "bnode",
              value: term.value,
            };
            return;

          case "NamedNode":
            res[k] = {
              type: "uri",
              value: term.value,
            };
            return;

          case "Literal":
            const literal: Literal = term as unknown as Literal;
            const dataType = literal.datatype?.value;
            const language = literal.language || undefined;
            res[k] = {
              type: "literal",
              value: literal.value,
              datatype: dataType,
              "xml:lang": language,
            };
            return;
        }
      });

      return res;
    });

    return {
      head: {
        vars: Array.from(vars.values()),
      },
      results: {
        bindings,
      },
    };
  };

  const quadsResult = (queryResults: Quad[]): QueryResult => {
    const stringResult = queryResults
      .map((quad) => {
        return quad.toString();
      })
      .join("\n");

    return stringResult;
  };

  const handleResults = (queryResults: any) => {
    // ASK queries returns boolean value
    const isBoolean = typeof queryResults === "boolean";
    if (isBoolean) {
      return askResult(queryResults);
    }

    // other queries should return arrays
    const isArray = Array.isArray(queryResults);
    if (!isArray) {
      throw new Error("got unexpected answer from store");
    }

    if (queryResults.length <= 0) {
      return emptyResult();
    }

    const firstResult = queryResults[0];
    if (firstResult instanceof Map) {
      return selectResult(queryResults);
    } else {
      return quadsResult(queryResults);
    }
  };

  const execQuery = () => {
    try {
      const queryResults = store.query(query);
      const parsedResults = handleResults(queryResults);

      setResults(JSON.stringify(parsedResults, null, 2));
      setError(undefined);
    } catch (e: any) {
      setError(e.message);
      setResults("");
    }
  };

  return (
    <div>
      <div>
        <textarea value={query} onChange={(e) => setQuery(e.target.value)} />
        <button onClick={execQuery}>Run query</button>
      </div>
      {error ? <p>ERROR: {error}</p> : <pre>{results}</pre>}
    </div>
  );
};

export default Interface;
