import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addResourceEntry,
  parseResource,
  pruneResourceHistory,
  RDF_TYPE,
  removeResourceEntry,
  resourceIris,
  resourceQuery,
  withLabels,
} from "../lib/resources";
import { handleResults, summarizeResult } from "../lib/results";
import { type Binding, literal, sparqlJson, uri } from "./helpers";

const row = (direction: string, predicate: string, value: Binding) => ({
  direction: literal(direction),
  predicate: uri(predicate),
  value,
});

describe("resourceQuery", () => {
  it("asks in both directions and bounds itself", () => {
    const query = resourceQuery("http://a/x");

    assert.match(query, /<http:\/\/a\/x> \?predicate \?value/);
    assert.match(query, /\?value \?predicate <http:\/\/a\/x>/);
    assert.match(query, /LIMIT 500/);
  });

  it("refuses an unsafe IRI", () => {
    assert.throws(() => resourceQuery("http://a/> } ; DROP"), /Not a usable IRI/);
  });
});

describe("parseResource", () => {
  const details = () =>
    parseResource(
      "http://a/x",
      sparqlJson(
        ["direction", "predicate", "value"],
        [
          row("outgoing", RDF_TYPE, uri("http://a/Person")),
          row("outgoing", "http://a/name", literal("Sheldon")),
          row("outgoing", "http://a/knows", uri("http://a/y")),
          row("outgoing", "http://a/knows", uri("http://a/z")),
          row("incoming", "http://a/child", uri("http://a/parent")),
        ]
      )
    );

  it("lifts rdf:type out into its own list", () => {
    const parsed = details();

    assert.deepEqual(parsed.types, [{ iri: "http://a/Person" }]);
    assert.equal(
      parsed.outgoing.some((property) => property.predicate === RDF_TYPE),
      false
    );
  });

  it("splits the two directions", () => {
    const parsed = details();

    assert.deepEqual(parsed.outgoing.map((p) => p.predicate).sort(), [
      "http://a/knows",
      "http://a/name",
    ]);
    assert.deepEqual(parsed.incoming.map((p) => p.predicate), ["http://a/child"]);
  });

  it("groups repeated predicates into one entry", () => {
    const knows = details().outgoing.find((p) => p.predicate === "http://a/knows");
    assert.equal(knows?.values.length, 2);
  });

  it("counts every statement, including types", () => {
    assert.equal(details().statements, 5);
  });

  it("flags truncation only when the limit was reached", () => {
    assert.equal(details().truncated, false);

    const full = parseResource(
      "http://a/x",
      sparqlJson(
        ["direction", "predicate", "value"],
        Array.from({ length: 3 }, () => row("outgoing", "http://a/p", uri("http://a/y")))
      ),
      3
    );
    assert.equal(full.truncated, true);
  });

  it("treats a missing direction as outgoing", () => {
    const parsed = parseResource(
      "http://a/x",
      sparqlJson(
        ["predicate", "value"],
        [{ predicate: uri("http://a/p"), value: literal("v") }]
      )
    );

    assert.equal(parsed.outgoing.length, 1);
    assert.equal(parsed.incoming.length, 0);
  });

  it("rejects a graph answer", () => {
    assert.throws(() => parseResource("http://a/x", "<a> <b> <c> ."), /graph/);
  });
});

describe("labelling", () => {
  it("collects every IRI on the page, subject included", () => {
    const parsed = parseResource(
      "http://a/x",
      sparqlJson(
        ["direction", "predicate", "value"],
        [
          row("outgoing", RDF_TYPE, uri("http://a/Person")),
          row("outgoing", "http://a/knows", uri("http://a/y")),
          { direction: literal("outgoing"), predicate: uri("http://a/name"), value: literal("Sheldon") },
        ]
      )
    );

    const iris = resourceIris(parsed);
    for (const expected of ["http://a/x", "http://a/Person", "http://a/knows", "http://a/y"]) {
      assert.ok(iris.includes(expected), expected);
    }
    // Literals are not IRIs and must not be looked up.
    assert.equal(iris.includes("Sheldon"), false);
  });

  it("applies labels to the subject, its types, predicates and values", () => {
    const parsed = parseResource(
      "http://a/x",
      sparqlJson(
        ["direction", "predicate", "value"],
        [
          row("outgoing", RDF_TYPE, uri("http://a/Person")),
          row("outgoing", "http://a/knows", uri("http://a/y")),
        ]
      )
    );

    const labelled = withLabels(
      parsed,
      new Map([
        ["http://a/x", "X"],
        ["http://a/Person", "Person"],
        ["http://a/knows", "knows"],
        ["http://a/y", "Y"],
      ])
    );

    assert.equal(labelled.label, "X");
    assert.equal(labelled.types[0].label, "Person");
    assert.equal(labelled.outgoing[0].label, "knows");
    assert.equal(labelled.outgoing[0].values[0].label, "Y");
  });
});

describe("resource history", () => {
  it("promotes a repeat rather than duplicating", () => {
    let history = addResourceEntry({}, "c1", { uri: "http://a/1", at: 1, statements: 3 });
    history = addResourceEntry(history, "c1", { uri: "http://a/2", at: 2, statements: 1 });
    history = addResourceEntry(history, "c1", { uri: "http://a/1", at: 3, statements: 9 });

    assert.deepEqual(history.c1.map((entry) => entry.uri), ["http://a/1", "http://a/2"]);
    assert.equal(history.c1[0].statements, 9);
  });

  it("caps, removes and prunes", () => {
    let history = {};
    for (let index = 0; index < 60; index += 1) {
      history = addResourceEntry(history, "c1", { uri: `http://a/${index}`, at: index });
    }
    assert.equal((history as Record<string, unknown[]>).c1.length, 50);

    const one = addResourceEntry({}, "c1", { uri: "http://a/1", at: 1 });
    assert.equal(removeResourceEntry(one, "c1", one.c1[0].id).c1.length, 0);
    assert.deepEqual(Object.keys(pruneResourceHistory(one, ["c2"])), []);
  });
});

describe("summarizeResult", () => {
  it("recognises each result shape", () => {
    assert.deepEqual(summarizeResult({ head: {}, boolean: true }), {
      kind: "boolean",
      rows: null,
    });
    assert.deepEqual(
      summarizeResult({ head: { vars: ["s"] }, results: { bindings: [{}, {}] } }),
      { kind: "table", rows: 2 }
    );
    assert.deepEqual(summarizeResult("<a> <b> <c> .\n<a> <b> <d> .\n"), {
      kind: "graph",
      rows: 2,
    });
    assert.deepEqual(summarizeResult(""), { kind: "graph", rows: 0 });
  });
});

describe("handleResults", () => {
  it("maps oxigraph's return shapes", () => {
    assert.deepEqual(handleResults(true), { head: {}, boolean: true });
    assert.deepEqual(handleResults([]), { head: {}, results: { bindings: [] } });
  });

  it("refuses something it does not understand", () => {
    assert.throws(
      () => handleResults(42 as unknown as boolean),
      /unexpected answer/
    );
  });
});
