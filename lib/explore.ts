import { type QueryResult, type QueryResultBinding, type QueryResultBindingValue } from "./results";

/** A term as it travels through the explorer. */
export type TermRef =
  | { type: "uri"; value: string }
  | { type: "bnode"; value: string }
  | { type: "literal"; value: string; datatype?: string; lang?: string };

export type ClassEntry = { iri: string; count?: number; label?: string };
export type InstanceEntry = { iri: string; label?: string };
/**
 * Which way a predicate runs relative to the node being inspected: "out" when
 * the node is the subject, "in" when it is the object. Both are worth seeing —
 * half of what a resource means is what points at it.
 */
export type LinkDirection = "out" | "in";

export type PredicateEntry = {
  iri: string;
  direction: LinkDirection;
  count?: number;
  label?: string;
};
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

/**
 * Predicates consulted for a human-readable name, **in order of preference**.
 * A resource carrying several of these gets the first one listed; a resource
 * carrying none falls back to the local name of its IRI.
 */
export const LABEL_PREDICATES = [
  "http://www.w3.org/2000/01/rdf-schema#label",
  "http://schema.org/name",
  "http://xmlns.com/foaf/0.1/name",
  "http://purl.org/dc/terms/title",
];

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
  `SELECT ?subject ?predicate ?label WHERE {
  VALUES ?subject { ${iris.map(iriRef).join(" ")} }
  VALUES ?predicate { ${LABEL_PREDICATES.map(iriRef).join(" ")} }
  ?subject ?predicate ?label .
}
LIMIT ${iris.length * LABEL_PREDICATES.length * 4}`;

export const predicatesQuery = (node: { kind: NodeKind; iri: string }) =>
  node.kind === "class"
    ? `# Predicates in and out of instances of ${node.iri}
SELECT ?predicate ?direction (COUNT(*) AS ?count) WHERE {
  {
    ?subject a ${iriRef(node.iri)} ;
             ?predicate ?object .
    BIND("out" AS ?direction)
  } UNION {
    ?object a ${iriRef(node.iri)} .
    ?subject ?predicate ?object .
    BIND("in" AS ?direction)
  }
}
GROUP BY ?predicate ?direction
ORDER BY ?direction DESC(?count) ?predicate
LIMIT 200`
    : `# Predicates in and out of ${node.iri}
SELECT ?predicate ?direction (COUNT(*) AS ?count) WHERE {
  {
    ${iriRef(node.iri)} ?predicate ?object .
    BIND("out" AS ?direction)
  } UNION {
    ?subject ?predicate ${iriRef(node.iri)} .
    BIND("in" AS ?direction)
  }
}
GROUP BY ?predicate ?direction
ORDER BY ?direction ?predicate
LIMIT 200`;

/**
 * The terms on the other end of a predicate. For an outgoing predicate those
 * are its objects; for an incoming one they are the subjects pointing at the
 * node, which is why the direction has to be carried this far.
 */
export const objectsQuery = (
  node: { kind: NodeKind; iri: string },
  predicate: string,
  limit: number,
  offset: number,
  direction: LinkDirection = "out"
) => {
  const pattern =
    node.kind === "class"
      ? direction === "out"
        ? `?subject a ${iriRef(node.iri)} ;
           ${iriRef(predicate)} ?object .`
        : `?other a ${iriRef(node.iri)} .
  ?object ${iriRef(predicate)} ?other .`
      : direction === "out"
        ? `${iriRef(node.iri)} ${iriRef(predicate)} ?object .`
        : `?object ${iriRef(predicate)} ${iriRef(node.iri)} .`;

  const heading =
    direction === "out"
      ? `# Values of ${predicate} for ${node.iri}`
      : `# Subjects pointing at ${node.iri} through ${predicate}`;

  return `${heading}
SELECT DISTINCT ?object WHERE {
  ${pattern}
}
ORDER BY ?object
LIMIT ${limit} OFFSET ${offset}`;
};

/**
 * Direct triples between newly added IRIs and everything on the canvas, in both
 * directions. `all` includes the new IRIs, so links among the new arrivals are
 * found too — otherwise a node added from another node's predicate list would
 * only ever show that one edge.
 */
export const directLinksQuery = (added: string[], all: string[]) =>
  `SELECT DISTINCT ?from ?predicate ?to WHERE {
  {
    VALUES ?from { ${added.map(iriRef).join(" ")} }
    VALUES ?to { ${all.map(iriRef).join(" ")} }
    ?from ?predicate ?to .
  } UNION {
    VALUES ?from { ${all.map(iriRef).join(" ")} }
    VALUES ?to { ${added.map(iriRef).join(" ")} }
    ?from ?predicate ?to .
  }
}
LIMIT 500`;

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
    if (term?.type !== "uri" || !isSafeIri(term.value)) {
      return [];
    }

    // Anything but an explicit "in" is treated as outgoing, so a store that
    // drops the BIND still yields a usable list.
    const direction: LinkDirection =
      binding.direction?.value === "in" ? "in" : "out";

    return [{ iri: term.value, direction, count: asNumber(binding.count) }];
  });

export const parseObjects = (result: QueryResult): ObjectEntry[] =>
  bindings(result).flatMap((binding) => {
    const term = toTerm(binding.object);
    return term ? [{ term }] : [];
  });

/** The browser's language, when there is a browser. */
const preferredLanguage = () => {
  if (typeof navigator === "undefined" || !navigator.language) {
    return undefined;
  }
  return navigator.language.split("-")[0].toLowerCase();
};

/**
 * Lower is better: the reader's own language first, then a label with no
 * language tag at all, then anything else.
 */
const languageRank = (language: string | undefined, preferred: string | undefined) => {
  if (!language) {
    return 1;
  }
  return preferred && language.split("-")[0].toLowerCase() === preferred ? 0 : 2;
};

/**
 * Pick one label per subject: by predicate preference first, then by language,
 * then alphabetically so the same data always yields the same name.
 */
export const parseLabels = (result: QueryResult): Map<string, string> => {
  const preferred = preferredLanguage();
  const best = new Map<
    string,
    { predicate: number; language: number; value: string }
  >();

  for (const binding of bindings(result)) {
    const subject = toTerm(binding.subject);
    const label = toTerm(binding.label);

    if (subject?.type !== "uri" || !label || !label.value.trim()) {
      continue;
    }

    const predicateTerm = toTerm(binding.predicate);
    const known =
      predicateTerm?.type === "uri"
        ? LABEL_PREDICATES.indexOf(predicateTerm.value)
        : -1;

    const candidate = {
      // An unrecognised (or absent) predicate ranks below every known one.
      predicate: known < 0 ? LABEL_PREDICATES.length : known,
      language: languageRank(
        label.type === "literal" ? label.lang : undefined,
        preferred
      ),
      value: label.value,
    };

    const current = best.get(subject.value);
    const better =
      !current ||
      candidate.predicate < current.predicate ||
      (candidate.predicate === current.predicate &&
        (candidate.language < current.language ||
          (candidate.language === current.language &&
            candidate.value.localeCompare(current.value) < 0)));

    if (better) {
      best.set(subject.value, candidate);
    }
  }

  return new Map(
    Array.from(best, ([subject, chosen]) => [subject, chosen.value])
  );
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
