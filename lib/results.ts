import { BlankNode, Literal, NamedNode, Quad } from "oxigraph/web";

export type Term = NamedNode | Literal | BlankNode;

export type QueryResultBindingValue =
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

export type QueryResultBinding = Record<string, QueryResultBindingValue>;

// try to follow https://www.w3.org/TR/sparql11-results-json/
export type QueryResult =
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

export const askResult = (queryResults: boolean): QueryResult => {
  return {
    head: {},
    boolean: queryResults,
  };
};

export const emptyResult = (): QueryResult => {
  return {
    head: {},
    results: {
      bindings: [],
    },
  };
};

export const selectResult = (
  queryResults: Map<string, Term>[]
): QueryResult => {
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

export const quadsResult = (queryResults: Quad[]): QueryResult => {
  const stringResult = queryResults
    .map((quad) => {
      return quad.toString();
    })
    .join("\n");

  return stringResult;
};

export const handleResults = (queryResults: any) => {
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
