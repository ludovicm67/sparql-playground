import { QueryResult, QueryResultBinding, QueryResultBindingValue } from "./results";

/** A term as it travels through the explorer. */
export type TermRef =
  | { type: "uri"; value: string }
  | { type: "bnode"; value: string }
  | { type: "literal"; value: string; datatype?: string; lang?: string };

export type ClassEntry = { iri: string; count?: number; label?: string };
export type InstanceEntry = { iri: string; label?: string };
export type PredicateEntry = { iri: string; count?: number; label?: string };
export type ObjectEntry = { term: TermRef; label?: string };

export const PAGE_SIZE = 50;
export const CLASS_PAGE_SIZE = 100;

/**
 * Characters SPARQL forbids inside `<...>` anyway. Data comes back from the
 * endpoint and is spliced straight into the next query, so refuse anything that
 * could break out of the IRI rather than trusting the server.
 */
const UNSAFE_IRI = /[\u0000-\u0020<>"{}|^`\\]/;

export const isSafeIri = (iri: string) => iri.length > 0 && !UNSAFE_IRI.test(iri);

const iriRef = (iri: string) => {
  if (!isSafeIri(iri)) {
    throw new Error(`Refusing to build a query with the unsafe IRI: ${iri}`);
  }
  return `<${iri}>`;
};

const literalTerm = (term: Extract<TermRef, { type: "literal" }>) => {
  const escaped = term.value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");

  if (term.lang) {
    // Language tags are [a-zA-Z0-9-]; anything else gets dropped rather than
    // interpolated.
    const tag = term.lang.replace(/[^a-zA-Z0-9-]/g, "");
    return tag ? `"${escaped}"@${tag}` : `"${escaped}"`;
  }
  if (term.datatype) {
    return `"${escaped}"^^${iriRef(term.datatype)}`;
  }
  return `"${escaped}"`;
};

/** Render a term for use inside a query. Blank nodes cannot be referenced. */
export const termToSparql = (term: TermRef) => {
  if (term.type === "uri") {
    return iriRef(term.value);
  }
  if (term.type === "literal") {
    return literalTerm(term);
  }
  throw new Error("Blank nodes cannot be referenced from a new query");
};

export const isReferenceable = (term: TermRef) => {
  if (term.type === "bnode") {
    return false;
  }
  if (term.type === "uri") {
    return isSafeIri(term.value);
  }
  return !term.datatype || isSafeIri(term.datatype);
};

/* ------------------------------------------------------------- queries */

const LABEL_PATH =
  "<http://www.w3.org/2000/01/rdf-schema#label>|<http://schema.org/name>|<http://xmlns.com/foaf/0.1/name>|<http://purl.org/dc/terms/title>";

export const classesQuery = (limit: number, offset: number) =>
  `# Classes in this dataset, most populated first
SELECT ?class (COUNT(?instance) AS ?count) WHERE {
  ?instance a ?class .
}
GROUP BY ?class
ORDER BY DESC(?count) ?class
LIMIT ${limit} OFFSET ${offset}`;

export const instancesQuery = (classIri: string, limit: number, offset: number) =>
  `# Instances of ${classIri}
SELECT ?instance WHERE {
  ?instance a ${iriRef(classIri)} .
}
ORDER BY ?instance
LIMIT ${limit} OFFSET ${offset}`;

/**
 * Labels for one already-fetched page. Kept separate so an optional label can
 * never multiply rows and break LIMIT/OFFSET paging.
 */
export const labelsQuery = (iris: string[]) =>
  `SELECT ?subject (SAMPLE(?value) AS ?label) WHERE {
  VALUES ?subject { ${iris.map(iriRef).join(" ")} }
  ?subject ${LABEL_PATH} ?value .
}
GROUP BY ?subject`;

export const predicatesQuery = (node: { kind: NodeKind; iri: string }) =>
  node.kind === "class"
    ? `# Predicates used by instances of ${node.iri}
SELECT ?predicate (COUNT(*) AS ?count) WHERE {
  ?subject a ${iriRef(node.iri)} ;
           ?predicate ?object .
}
GROUP BY ?predicate
ORDER BY DESC(?count) ?predicate
LIMIT 200`
    : `# Predicates of ${node.iri}
SELECT ?predicate (COUNT(?object) AS ?count) WHERE {
  ${iriRef(node.iri)} ?predicate ?object .
}
GROUP BY ?predicate
ORDER BY ?predicate
LIMIT 200`;

export const objectsQuery = (
  node: { kind: NodeKind; iri: string },
  predicate: string,
  limit: number,
  offset: number
) =>
  node.kind === "class"
    ? `# Values of ${predicate} across instances of ${node.iri}
SELECT DISTINCT ?object WHERE {
  ?subject a ${iriRef(node.iri)} ;
           ${iriRef(predicate)} ?object .
}
ORDER BY ?object
LIMIT ${limit} OFFSET ${offset}`
    : `# Values of ${predicate} for ${node.iri}
SELECT DISTINCT ?object WHERE {
  ${iriRef(node.iri)} ${iriRef(predicate)} ?object .
}
ORDER BY ?object
LIMIT ${limit} OFFSET ${offset}`;

/**
 * Direct triples between a newly added IRI and the ones already on the canvas,
 * in both directions.
 */
export const directLinksQuery = (iri: string, others: string[]) =>
  `SELECT DISTINCT ?from ?predicate ?to WHERE {
  {
    VALUES ?to { ${others.map(iriRef).join(" ")} }
    ${iriRef(iri)} ?predicate ?to .
    BIND(${iriRef(iri)} AS ?from)
  } UNION {
    VALUES ?from { ${others.map(iriRef).join(" ")} }
    ?from ?predicate ${iriRef(iri)} .
    BIND(${iriRef(iri)} AS ?to)
  }
}
LIMIT 200`;

/**
 * Schema-level links: a predicate that connects *instances* of one class to
 * instances of another. This is what makes a canvas of classes readable.
 */
export const schemaLinksQuery = (classIri: string, otherClasses: string[]) =>
  `SELECT DISTINCT ?from ?predicate ?to WHERE {
  {
    VALUES ?to { ${otherClasses.map(iriRef).join(" ")} }
    ?subject a ${iriRef(classIri)} ;
             ?predicate ?object .
    ?object a ?to .
    BIND(${iriRef(classIri)} AS ?from)
  } UNION {
    VALUES ?from { ${otherClasses.map(iriRef).join(" ")} }
    ?subject a ?from ;
             ?predicate ?object .
    ?object a ${iriRef(classIri)} .
    BIND(${iriRef(classIri)} AS ?to)
  }
}
LIMIT 100`;

/* ---------------------------------------------- queries for "Query" mode */

export const instancesOfClassQuery = (classIri: string) =>
  `# Instances of ${classIri}
SELECT ?instance WHERE {
  ?instance a ${iriRef(classIri)} .
}
LIMIT 100
`;

export const describeQuery = (iri: string) =>
  `# Everything known about ${iri}
SELECT ?predicate ?object WHERE {
  ${iriRef(iri)} ?predicate ?object .
}
LIMIT 100
`;

export const allClassesQuery = () => `${classesQuery(CLASS_PAGE_SIZE, 0)}\n`;

/* -------------------------------------------------------------- parsing */

const toTerm = (value: QueryResultBindingValue | undefined): TermRef | undefined => {
  if (!value) {
    return undefined;
  }

  if (value.type === "uri") {
    return { type: "uri", value: value.value };
  }
  if (value.type === "bnode") {
    return { type: "bnode", value: value.value };
  }

  return {
    type: "literal",
    value: value.value,
    datatype: value.datatype,
    lang: value["xml:lang"],
  };
};

const bindings = (result: QueryResult): QueryResultBinding[] => {
  if (typeof result === "string") {
    throw new Error(
      "The endpoint answered with a graph where a result table was expected."
    );
  }
  return result.results?.bindings ?? [];
};

const asNumber = (value: QueryResultBindingValue | undefined) => {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseClasses = (result: QueryResult): ClassEntry[] =>
  bindings(result).flatMap((binding) => {
    const term = toTerm(binding.class);
    return term?.type === "uri" && isSafeIri(term.value)
      ? [{ iri: term.value, count: asNumber(binding.count) }]
      : [];
  });

export const parseInstances = (result: QueryResult): InstanceEntry[] =>
  bindings(result).flatMap((binding) => {
    const term = toTerm(binding.instance);
    return term?.type === "uri" && isSafeIri(term.value) ? [{ iri: term.value }] : [];
  });

export const parsePredicates = (result: QueryResult): PredicateEntry[] =>
  bindings(result).flatMap((binding) => {
    const term = toTerm(binding.predicate);
    return term?.type === "uri" && isSafeIri(term.value)
      ? [{ iri: term.value, count: asNumber(binding.count) }]
      : [];
  });

export const parseObjects = (result: QueryResult): ObjectEntry[] =>
  bindings(result).flatMap((binding) => {
    const term = toTerm(binding.object);
    return term ? [{ term }] : [];
  });

export const parseLabels = (result: QueryResult): Map<string, string> => {
  const labels = new Map<string, string>();

  for (const binding of bindings(result)) {
    const subject = toTerm(binding.subject);
    const label = toTerm(binding.label);
    if (subject?.type === "uri" && label && label.value) {
      labels.set(subject.value, label.value);
    }
  }

  return labels;
};

export type ParsedLink = { from: string; predicate: string; to: string };

export const parseLinks = (result: QueryResult): ParsedLink[] =>
  bindings(result).flatMap((binding) => {
    const from = toTerm(binding.from);
    const predicate = toTerm(binding.predicate);
    const to = toTerm(binding.to);

    return from?.type === "uri" && predicate?.type === "uri" && to?.type === "uri"
      ? [{ from: from.value, predicate: predicate.value, to: to.value }]
      : [];
  });

/* ------------------------------------------------------------ presentation */

export type NodeKind = "class" | "instance" | "literal";

/** Short, human-readable form of an IRI: its local name. */
export const localName = (iri: string) => {
  const boundary = Math.max(
    iri.lastIndexOf("#"),
    iri.lastIndexOf("/"),
    iri.lastIndexOf(":")
  );

  const local = boundary >= 0 ? iri.slice(boundary + 1) : iri;
  return local || iri;
};

export const displayTerm = (term: TermRef) =>
  term.type === "uri" ? localName(term.value) : term.value;

/** Stable identity for a canvas node. */
export const termKey = (term: TermRef) =>
  term.type === "literal"
    ? `literal:${term.lang ?? ""}:${term.datatype ?? ""}:${term.value}`
    : `${term.type}:${term.value}`;
