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
  LABEL_PREDICATES,
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
    assert.throws(() => directLinksQuery([attack], ["http://ok"]), /unsafe IRI/);
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
      directLinksQuery(["http://a/x"], ["http://a/y"]),
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

  it("reads predicates and links", () => {
    assert.deepEqual(
      parsePredicates(
        sparqlJson(
          ["predicate", "direction", "count"],
          [
            {
              predicate: uri("http://a/p"),
              direction: literal("out"),
              count: literal("3"),
            },
            {
              predicate: uri("http://a/q"),
              direction: literal("in"),
              count: literal("1"),
            },
          ]
        )
      ),
      [
        { iri: "http://a/p", direction: "out", count: 3 },
        { iri: "http://a/q", direction: "in", count: 1 },
      ]
    );

    // A store that drops the BIND still yields a usable list rather than none.
    assert.deepEqual(
      parsePredicates(
        sparqlJson(["predicate", "count"], [{ predicate: uri("http://a/p"), count: literal("3") }])
      ),
      [{ iri: "http://a/p", direction: "out", count: 3 }]
    );

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

describe("labels", () => {
  const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
  const SCHEMA_NAME = "http://schema.org/name";
  const FOAF_NAME = "http://xmlns.com/foaf/0.1/name";

  it("asks for each label predicate by name, in preference order", () => {
    const query = labelsQuery(["http://a/x"]);

    assert.equal(LABEL_PREDICATES[0], RDFS_LABEL);
    assert.equal(LABEL_PREDICATES[1], SCHEMA_NAME);
    for (const predicate of LABEL_PREDICATES) {
      assert.ok(query.includes(`<${predicate}>`), predicate);
    }
    // The predicate has to come back so the caller can rank the answers; a
    // SAMPLE over an alternation would have thrown that away.
    assert.match(query, /SELECT \?subject \?predicate \?label/);
  });

  it("prefers rdfs:label over the others", () => {
    const labels = parseLabels(
      sparqlJson(
        ["subject", "predicate", "label"],
        [
          { subject: uri("http://a/x"), predicate: uri(FOAF_NAME), label: literal("Foaf") },
          { subject: uri("http://a/x"), predicate: uri(SCHEMA_NAME), label: literal("Schema") },
          { subject: uri("http://a/x"), predicate: uri(RDFS_LABEL), label: literal("Rdfs") },
        ]
      )
    );

    assert.equal(labels.get("http://a/x"), "Rdfs");
  });

  it("falls back to schema:name when there is no rdfs:label", () => {
    const labels = parseLabels(
      sparqlJson(
        ["subject", "predicate", "label"],
        [
          { subject: uri("http://a/x"), predicate: uri(FOAF_NAME), label: literal("Foaf") },
          { subject: uri("http://a/x"), predicate: uri(SCHEMA_NAME), label: literal("Schema") },
        ]
      )
    );

    assert.equal(labels.get("http://a/x"), "Schema");
  });

  it("returns nothing for a resource with no label, leaving the local name", () => {
    const labels = parseLabels(sparqlJson(["subject", "predicate", "label"], []));

    assert.equal(labels.get("http://a/x"), undefined);
    assert.equal(localName("http://a/some-thing"), "some-thing");
  });

  it("ignores blank labels and non-IRI subjects", () => {
    const labels = parseLabels(
      sparqlJson(
        ["subject", "predicate", "label"],
        [
          { subject: uri("http://a/x"), predicate: uri(RDFS_LABEL), label: literal("   ") },
          { subject: bnode("b0"), predicate: uri(RDFS_LABEL), label: literal("Blank") },
        ]
      )
    );

    assert.equal(labels.size, 0);
  });

  it("prefers an untagged label over a foreign language, and is deterministic", () => {
    const rows = [
      { subject: uri("http://a/x"), predicate: uri(RDFS_LABEL), label: literal("Zebra", { "xml:lang": "de" }) },
      { subject: uri("http://a/x"), predicate: uri(RDFS_LABEL), label: literal("Plain") },
      { subject: uri("http://a/x"), predicate: uri(RDFS_LABEL), label: literal("Alpaga", { "xml:lang": "fr" }) },
    ];

    const forwards = parseLabels(sparqlJson(["subject", "predicate", "label"], rows));
    const backwards = parseLabels(
      sparqlJson(["subject", "predicate", "label"], [...rows].reverse())
    );

    assert.equal(forwards.get("http://a/x"), "Plain");
    // Row order from an endpoint is not guaranteed; the chosen name must be.
    assert.equal(backwards.get("http://a/x"), forwards.get("http://a/x"));
  });

  it("breaks ties alphabetically so the same data always names the same way", () => {
    const rows = [
      { subject: uri("http://a/x"), predicate: uri(RDFS_LABEL), label: literal("Beta", { "xml:lang": "de" }) },
      { subject: uri("http://a/x"), predicate: uri(RDFS_LABEL), label: literal("Alpha", { "xml:lang": "es" }) },
    ];

    assert.equal(
      parseLabels(sparqlJson(["subject", "predicate", "label"], rows)).get("http://a/x"),
      "Alpha"
    );
  });

  it("still reads the older shape, where no predicate came back", () => {
    const labels = parseLabels(
      sparqlJson(["subject", "label"], [{ subject: uri("http://a/x"), label: literal("X") }])
    );

    assert.equal(labels.get("http://a/x"), "X");
  });

  it("lets a known predicate win over an unrecognised one", () => {
    const labels = parseLabels(
      sparqlJson(
        ["subject", "predicate", "label"],
        [
          { subject: uri("http://a/x"), predicate: uri("http://a/nickname"), label: literal("Nick") },
          { subject: uri("http://a/x"), predicate: uri(SCHEMA_NAME), label: literal("Proper") },
        ]
      )
    );

    assert.equal(labels.get("http://a/x"), "Proper");
  });
});

describe("link direction", () => {
  it("asks for both directions in one query", () => {
    const query = predicatesQuery({ kind: "instance", iri: "http://a/x" });

    // The node as subject, and the node as object, unioned.
    assert.match(query, /<http:\/\/a\/x> \?predicate \?object/);
    assert.match(query, /\?subject \?predicate <http:\/\/a\/x>/);
    assert.match(query, /BIND\("out" AS \?direction\)/);
    assert.match(query, /BIND\("in" AS \?direction\)/);
    assert.match(query, /GROUP BY \?predicate \?direction/);
  });

  it("does the same for a class, through its instances", () => {
    const query = predicatesQuery({ kind: "class", iri: "http://a/C" });

    assert.match(query, /\?subject a <http:\/\/a\/C>/);
    assert.match(query, /\?object a <http:\/\/a\/C>/);
    assert.match(query, /BIND\("in" AS \?direction\)/);
  });

  it("reads the other end from the correct side", () => {
    const node = { kind: "instance" as const, iri: "http://a/x" };

    // Outgoing: the node is the subject, so the values are its objects.
    assert.match(
      objectsQuery(node, "http://a/p", 10, 0, "out"),
      /<http:\/\/a\/x> <http:\/\/a\/p> \?object/
    );

    // Incoming: the node is the object, so the values are the subjects.
    assert.match(
      objectsQuery(node, "http://a/p", 10, 0, "in"),
      /\?object <http:\/\/a\/p> <http:\/\/a\/x>/
    );
  });

  it("defaults to outgoing, so old call sites keep their meaning", () => {
    const node = { kind: "instance" as const, iri: "http://a/x" };
    assert.equal(
      objectsQuery(node, "http://a/p", 10, 0),
      objectsQuery(node, "http://a/p", 10, 0, "out")
    );
  });

  it("refuses an unsafe IRI in either direction", () => {
    const node = { kind: "instance" as const, iri: "http://a/x" };
    assert.throws(() => objectsQuery(node, "http://a/p q", 10, 0, "in"), /unsafe/i);
  });
});
