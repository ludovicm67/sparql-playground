import { isSafeIri, localName, termKey, type TermRef } from "./explore";
import { type QueryResult, type QueryResultBindingValue } from "./results";
import { newId, readJson, STORAGE_KEYS, writeJson } from "./storage";

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export const RESOURCE_LIMIT = 500;

export type ResourceValue = {
  term: TermRef;
  label?: string;
  /** Statements hanging off a blank node, expanded in the same query. */
  nested?: ResourceProperty[];
};

export type ResourceProperty = {
  predicate: string;
  label?: string;
  values: ResourceValue[];
};

export type ResourceDetails = {
  uri: string;
  label?: string;
  types: { iri: string; label?: string }[];
  outgoing: ResourceProperty[];
  incoming: ResourceProperty[];
  /** True when the endpoint may have had more than `RESOURCE_LIMIT` rows. */
  truncated: boolean;
  statements: number;
};

/** How deep into chains of blank nodes the page expands. */
export const BLANK_NODE_DEPTH = 2;

/**
 * Everything the endpoint knows about a resource, in both directions. One
 * query so that what the page shows and what "open as a query" hands over are
 * the same thing.
 *
 * Outgoing statements are ranked first so that, when a resource has more than
 * `limit` statements, it is the incoming ones that get cut — those are usually
 * the long tail, and the outgoing ones are what describes the resource.
 *
 * Blank nodes carry no identity outside the query that found them, so there is
 * no way to look one up afterwards: whatever hangs off them has to be fetched
 * here, in the same query.
 */
export const resourceQuery = (iri: string, limit = RESOURCE_LIMIT) => {
  if (!isSafeIri(iri)) {
    throw new Error(`Not a usable IRI: ${iri}`);
  }

  return `# Everything known about <${iri}>, in both directions.
# Blank node objects are expanded ${BLANK_NODE_DEPTH} levels deep.
SELECT ?rank ?predicate ?value ?nestedPredicate ?nestedValue ?deepPredicate ?deepValue WHERE {
  {
    BIND(0 AS ?rank)
    <${iri}> ?predicate ?value .

    OPTIONAL {
      FILTER (isBlank(?value))
      ?value ?nestedPredicate ?nestedValue .

      OPTIONAL {
        FILTER (isBlank(?nestedValue))
        ?nestedValue ?deepPredicate ?deepValue .
      }
    }
  } UNION {
    BIND(1 AS ?rank)
    ?value ?predicate <${iri}> .
  }
}
ORDER BY ?rank ?predicate
LIMIT ${limit}
`;
};

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

/** Find or create the entry for a predicate inside a property list. */
const propertyFor = (properties: ResourceProperty[], predicate: string) => {
  const existing = properties.find((property) => property.predicate === predicate);
  if (existing) {
    return existing;
  }

  const created: ResourceProperty = { predicate, values: [] };
  properties.push(created);
  return created;
};

/** Find or create the entry for a term inside a property's values. */
const valueFor = (property: ResourceProperty, term: TermRef) => {
  const key = termKey(term);
  const existing = property.values.find((value) => termKey(value.term) === key);
  if (existing) {
    return existing;
  }

  const created: ResourceValue = { term };
  property.values.push(created);
  return created;
};

const byLocalName = (a: ResourceProperty, b: ResourceProperty) =>
  localName(a.predicate).localeCompare(localName(b.predicate));

export const parseResource = (
  uri: string,
  result: QueryResult,
  limit = RESOURCE_LIMIT
): ResourceDetails => {
  if (typeof result === "string") {
    throw new Error(
      "The endpoint answered with a graph where a result table was expected."
    );
  }

  const bindings = result.results?.bindings ?? [];
  const outgoing: ResourceProperty[] = [];
  const incoming: ResourceProperty[] = [];
  const types: string[] = [];

  // Expanding blank nodes multiplies rows, so count distinct statements rather
  // than rows: two addresses with five fields each is 2 statements, not 10.
  const statements = new Set<string>();

  for (const binding of bindings) {
    const predicate = toTerm(binding.predicate);
    const value = toTerm(binding.value);

    if (predicate?.type !== "uri" || !value) {
      continue;
    }

    // `rank` is the current shape; `direction` is kept so a query someone
    // edited by hand still renders.
    const isIncoming =
      binding.rank?.value === "1" || binding.direction?.value === "incoming";

    statements.add(
      `${isIncoming ? "in" : "out"} ${predicate.value} ${termKey(value)}`
    );

    if (isIncoming) {
      valueFor(propertyFor(incoming, predicate.value), value);
      continue;
    }

    if (predicate.value === RDF_TYPE && value.type === "uri") {
      if (!types.includes(value.value)) {
        types.push(value.value);
      }
      continue;
    }

    const entry = valueFor(propertyFor(outgoing, predicate.value), value);

    // Level 2: what the blank node itself points at.
    const nestedPredicate = toTerm(binding.nestedPredicate);
    const nestedValue = toTerm(binding.nestedValue);
    if (value.type !== "bnode" || nestedPredicate?.type !== "uri" || !nestedValue) {
      continue;
    }

    entry.nested = entry.nested ?? [];
    const nestedEntry = valueFor(
      propertyFor(entry.nested, nestedPredicate.value),
      nestedValue
    );

    // Level 3: one more hop, for a blank node inside a blank node.
    const deepPredicate = toTerm(binding.deepPredicate);
    const deepValue = toTerm(binding.deepValue);
    if (nestedValue.type !== "bnode" || deepPredicate?.type !== "uri" || !deepValue) {
      continue;
    }

    nestedEntry.nested = nestedEntry.nested ?? [];
    valueFor(propertyFor(nestedEntry.nested, deepPredicate.value), deepValue);
  }

  const sortDeep = (properties: ResourceProperty[]): ResourceProperty[] =>
    properties.sort(byLocalName).map((property) => ({
      ...property,
      values: property.values.map((value) =>
        value.nested ? { ...value, nested: sortDeep(value.nested) } : value
      ),
    }));

  return {
    uri,
    types: types.map((iri) => ({ iri })),
    outgoing: sortDeep(outgoing),
    incoming: sortDeep(incoming),
    truncated: bindings.length >= limit,
    statements: statements.size,
  };
};

/** Every IRI on the page, so labels can be fetched for them in one go. */
export const resourceIris = (details: ResourceDetails) => {
  const iris = new Set<string>([details.uri]);

  const walk = (properties: ResourceProperty[]) => {
    for (const property of properties) {
      iris.add(property.predicate);
      for (const value of property.values) {
        if (value.term.type === "uri") {
          iris.add(value.term.value);
        }
        if (value.nested) {
          walk(value.nested);
        }
      }
    }
  };

  for (const type of details.types) {
    iris.add(type.iri);
  }
  walk(details.outgoing);
  walk(details.incoming);

  return Array.from(iris).filter(isSafeIri);
};

export const withLabels = (
  details: ResourceDetails,
  labels: Map<string, string>
): ResourceDetails => {
  const apply = (properties: ResourceProperty[]): ResourceProperty[] =>
    properties.map((property) => ({
      ...property,
      label: labels.get(property.predicate),
      values: property.values.map((value) => ({
        ...value,
        label: value.term.type === "uri" ? labels.get(value.term.value) : undefined,
        ...(value.nested ? { nested: apply(value.nested) } : {}),
      })),
    }));

  return {
    ...details,
    label: labels.get(details.uri),
    types: details.types.map((type) => ({ ...type, label: labels.get(type.iri) })),
    outgoing: apply(details.outgoing),
    incoming: apply(details.incoming),
  };
};

/* ------------------------------------------------------------- history */

export type ResourceEntry = {
  id: string;
  uri: string;
  at: number;
  label?: string;
  /** Statement count at the time it was fetched; undefined if it failed. */
  statements?: number;
};

/** Scoped per connection: the same IRI means different things elsewhere. */
export type ResourceHistory = Record<string, ResourceEntry[]>;

const MAX_ENTRIES = 50;

const sanitizeEntry = (value: unknown): ResourceEntry | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  if (typeof raw.uri !== "string" || !isSafeIri(raw.uri)) {
    return undefined;
  }

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
    uri: raw.uri,
    at: typeof raw.at === "number" ? raw.at : 0,
    label: typeof raw.label === "string" ? raw.label : undefined,
    statements:
      typeof raw.statements === "number" ? raw.statements : undefined,
  };
};

export const loadResourceHistory = (): ResourceHistory => {
  const stored = readJson<unknown>(STORAGE_KEYS.resources, undefined);
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return {};
  }

  const history: ResourceHistory = {};
  for (const [connectionId, entries] of Object.entries(stored)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    history[connectionId] = entries
      .flatMap((entry) => {
        const parsed = sanitizeEntry(entry);
        return parsed ? [parsed] : [];
      })
      .slice(0, MAX_ENTRIES);
  }

  return history;
};

export const saveResourceHistory = (history: ResourceHistory) =>
  writeJson(STORAGE_KEYS.resources, history);

export const addResourceEntry = (
  history: ResourceHistory,
  connectionId: string,
  entry: Omit<ResourceEntry, "id">
): ResourceHistory => {
  const previous = history[connectionId] ?? [];
  const withoutDuplicate = previous.filter(
    (candidate) => candidate.uri !== entry.uri
  );

  return {
    ...history,
    [connectionId]: [{ ...entry, id: newId() }, ...withoutDuplicate].slice(
      0,
      MAX_ENTRIES
    ),
  };
};

export const removeResourceEntry = (
  history: ResourceHistory,
  connectionId: string,
  entryId: string
): ResourceHistory => ({
  ...history,
  [connectionId]: (history[connectionId] ?? []).filter(
    (entry) => entry.id !== entryId
  ),
});

export const pruneResourceHistory = (
  history: ResourceHistory,
  connectionIds: string[]
): ResourceHistory =>
  Object.fromEntries(
    Object.entries(history).filter(([connectionId]) =>
      connectionIds.includes(connectionId)
    )
  );
