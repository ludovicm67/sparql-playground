import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classesQuery,
  describeQuery,
  directLinksQuery,
  instancesOfClassQuery,
  instancesQuery,
  isReferenceable,
  isSafeIri,
  labelsQuery,
  localName,
  objectsQuery,
  parseClasses,
  parseInstances,
  parseLabels,
  parseLinks,
  parseObjects,
  parsePredicates,
  predicatesQuery,
  schemaLinksQuery,
  termKey,
  termToSparql,
} from "../lib/explore";
import { bnode, literal, sparqlJson, uri } from "./helpers";

describe("isSafeIri", () => {
  it("accepts ordinary IRIs", () => {
    for (const value of [
      "http://example.org/a",
      "https://example.org/a#b",
      "urn:tbbt:sheldon-cooper",
      "http://example.org/a?b=c",
      "http://example.org/é",
    ]) {
      assert.equal(isSafeIri(value), true, value);
    }
  });

  it("rejects anything that could break out of <...>", () => {
    for (const value of [
      "",
      "http://example.org/a b",
      "http://example.org/a>b",
      "http://example.org/a<b",
      'http://example.org/a"b',
      "http://example.org/a{b",
      "http://example.org/a}b",
      "http://example.org/a|b",
      "http://example.org/a^b",
      "http://example.org/a\\b",
      "http://example.org/a\nb",
      "http://example.org/a\tb",
    ]) {
      assert.equal(isSafeIri(value), false, JSON.stringify(value));
    }
  });
});

describe("query builders", () => {
  it("refuse to interpolate an unsafe IRI", () => {
    const attack = "http://evil.example/> } ; DROP ALL ; SELECT * WHERE { <a";

    assert.throws(() => instancesQuery(attack, 10, 0), /unsafe IRI/);
    assert.throws(() => predicatesQuery({ kind: "class", iri: attack }), /unsafe IRI/);
    assert.throws(() => objectsQuery({ kind: "instance", iri: "http://a" }, attack, 1, 0), /unsafe IRI/);
    assert.throws(() => describeQuery(attack), /unsafe IRI/);
    assert.throws(() => labelsQuery(["http://ok", attack]), /unsafe IRI/);
    assert.throws(() => directLinksQuery(attack, ["http://ok"]), /unsafe IRI/);
    assert.throws(() => schemaLinksQuery("http://ok", [attack]), /unsafe IRI/);
  });

  it("carry the paging window through", () => {
    const query = instancesQuery("http://example.org/C", 25, 50);
    assert.match(query, /LIMIT 25 OFFSET 50/);
    assert.match(query, /<http:\/\/example\.org\/C>/);
  });

  it("scopes class queries to instances and instance queries to the subject", () => {
    const forClass = predicatesQuery({ kind: "class", iri: "http://example.org/C" });
    const forInstance = predicatesQuery({ kind: "instance", iri: "http://example.org/i" });

    assert.match(forClass, /\?subject a <http:\/\/example\.org\/C>/);
    assert.match(forInstance, /^\s*<http:\/\/example\.org\/i> \?predicate \?object/m);
  });

  it("bounds every list query", () => {
    for (const query of [
      classesQuery(10, 0),
      instancesQuery("http://a/C", 10, 0),
      predicatesQuery({ kind: "class", iri: "http://a/C" }),
      objectsQuery({ kind: "class", iri: "http://a/C" }, "http://a/p", 10, 0),
      directLinksQuery("http://a/x", ["http://a/y"]),
      schemaLinksQuery("http://a/C", ["http://a/D"]),
      instancesOfClassQuery("http://a/C"),
      describeQuery("http://a/x"),
    ]) {
      assert.match(query, /LIMIT \d+/);
    }
  });
});

describe("termToSparql", () => {
  it("renders IRIs and literals", () => {
    assert.equal(termToSparql({ type: "uri", value: "http://a/b" }), "<http://a/b>");
    assert.equal(termToSparql({ type: "literal", value: "hi" }), '"hi"');
  });

  it("escapes literal content rather than letting it terminate the string", () => {
    const rendered = termToSparql({
      type: "literal",
      value: 'he said "stop" \\ then\nnewline',
    });

    assert.equal(rendered, '"he said \\"stop\\" \\\\ then\\nnewline"');
  });

  it("keeps language tags to the characters a tag may contain", () => {
    assert.equal(
      termToSparql({ type: "literal", value: "bonjour", lang: 'fr" . } #' }),
      '"bonjour"@fr'
    );
  });

  it("validates a literal's datatype IRI", () => {
    assert.throws(
      () => termToSparql({ type: "literal", value: "1", datatype: "http://a> b" }),
      /unsafe IRI/
    );
  });

  it("refuses blank nodes, which cannot be referenced", () => {
    assert.throws(() => termToSparql({ type: "bnode", value: "b0" }), /Blank nodes/);
  });
});

describe("isReferenceable", () => {
  it("is false for blank nodes and unsafe IRIs, true otherwise", () => {
    assert.equal(isReferenceable({ type: "bnode", value: "b0" }), false);
    assert.equal(isReferenceable({ type: "uri", value: "http://a b" }), false);
    assert.equal(isReferenceable({ type: "uri", value: "http://a" }), true);
    assert.equal(isReferenceable({ type: "literal", value: "x" }), true);
  });
});

describe("parsers", () => {
  it("reads classes with their counts", () => {
    const entries = parseClasses(
      sparqlJson(
        ["class", "count"],
        [
          { class: uri("http://a/C"), count: literal("12") },
          { class: uri("http://a/D"), count: literal("not a number") },
        ]
      )
    );

    assert.deepEqual(entries, [
      { iri: "http://a/C", count: 12 },
      { iri: "http://a/D", count: undefined },
    ]);
  });

  it("drops rows whose term is not a usable IRI", () => {
    const entries = parseInstances(
      sparqlJson(
        ["instance"],
        [
          { instance: uri("http://a/1") },
          { instance: bnode("b0") },
          { instance: literal("nope") },
          { instance: uri("http://a/ bad") },
        ]
      )
    );

    assert.deepEqual(entries, [{ iri: "http://a/1" }]);
  });

  it("keeps literal objects, which are legitimate values", () => {
    const objects = parseObjects(
      sparqlJson(
        ["object"],
        [{ object: literal("Sheldon") }, { object: uri("http://a/x") }]
      )
    );

    assert.equal(objects.length, 2);
    assert.equal(objects[0].term.type, "literal");
    assert.equal(objects[1].term.type, "uri");
  });

  it("reads predicates, labels and links", () => {
    assert.deepEqual(
      parsePredicates(sparqlJson(["predicate", "count"], [{ predicate: uri("http://a/p"), count: literal("3") }])),
      [{ iri: "http://a/p", count: 3 }]
    );

    const labels = parseLabels(
      sparqlJson(["subject", "label"], [{ subject: uri("http://a/x"), label: literal("X") }])
    );
    assert.equal(labels.get("http://a/x"), "X");

    assert.deepEqual(
      parseLinks(
        sparqlJson(
          ["from", "predicate", "to"],
          [{ from: uri("http://a/x"), predicate: uri("http://a/p"), to: uri("http://a/y") }]
        )
      ),
      [{ from: "http://a/x", predicate: "http://a/p", to: "http://a/y" }]
    );
  });

  it("rejects a graph answer where a table was expected", () => {
    assert.throws(() => parseClasses("<a> <b> <c> ."), /graph/);
  });
});

describe("presentation helpers", () => {
  it("takes the local name after the last separator", () => {
    assert.equal(localName("http://schema.org/Person"), "Person");
    assert.equal(localName("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), "type");
    assert.equal(localName("urn:tbbt:sheldon-cooper"), "sheldon-cooper");
    assert.equal(localName("bare"), "bare");
    assert.equal(localName("http://example.org/"), "http://example.org/");
  });

  it("gives literals distinct keys per language and datatype", () => {
    const base = { type: "literal" as const, value: "1" };

    const keys = new Set([
      termKey(base),
      termKey({ ...base, lang: "en" }),
      termKey({ ...base, datatype: "http://x#int" }),
      termKey({ type: "uri", value: "1" }),
      termKey({ type: "bnode", value: "1" }),
    ]);

    assert.equal(keys.size, 5);
  });
});
