import { isSafeIri, localName, type TermRef } from "./explore";
import { type QueryResult, type QueryResultBindingValue } from "./results";
import { newId, readJson, STORAGE_KEYS, writeJson } from "./storage";

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export const RESOURCE_LIMIT = 500;

export type ResourceValue = { term: TermRef; label?: string };

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

/**
 * Everything the endpoint knows about a resource, in both directions. One
 * query so that what the page shows and what "open as a query" hands over are
 * the same thing.
 */
export const resourceQuery = (iri: string, limit = RESOURCE_LIMIT) => {
  if (!isSafeIri(iri)) {
    throw new Error(`Not a usable IRI: ${iri}`);
  }

  return `# Everything known about <${iri}>, in both directions
SELECT ?direction ?predicate ?value WHERE {
  {
    <${iri}> ?predicate ?value .
    BIND("outgoing" AS ?direction)
  } UNION {
    ?value ?predicate <${iri}> .
    BIND("incoming" AS ?direction)
  }
}
ORDER BY ?direction ?predicate
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
  const outgoing = new Map<string, ResourceValue[]>();
  const incoming = new Map<string, ResourceValue[]>();
  const types: string[] = [];

  for (const binding of bindings) {
    const predicate = toTerm(binding.predicate);
    const value = toTerm(binding.value);
    const direction = binding.direction?.value;

    if (predicate?.type !== "uri" || !value) {
      continue;
    }

    if (direction === "incoming") {
      const group = incoming.get(predicate.value) ?? [];
      group.push({ term: value });
      incoming.set(predicate.value, group);
      continue;
    }

    if (predicate.value === RDF_TYPE && value.type === "uri") {
      types.push(value.value);
      continue;
    }

    const group = outgoing.get(predicate.value) ?? [];
    group.push({ term: value });
    outgoing.set(predicate.value, group);
  }

  const toProperties = (source: Map<string, ResourceValue[]>): ResourceProperty[] =>
    Array.from(source.entries())
      .map(([predicate, values]) => ({ predicate, values }))
      .sort((a, b) => localName(a.predicate).localeCompare(localName(b.predicate)));

  return {
    uri,
    types: types.map((iri) => ({ iri })),
    outgoing: toProperties(outgoing),
    incoming: toProperties(incoming),
    truncated: bindings.length >= limit,
    statements: bindings.length,
  };
};

/** Every IRI on the page, so labels can be fetched for them in one go. */
export const resourceIris = (details: ResourceDetails) => {
  const iris = new Set<string>([details.uri]);

  for (const type of details.types) {
    iris.add(type.iri);
  }
  for (const property of [...details.outgoing, ...details.incoming]) {
    iris.add(property.predicate);
    for (const value of property.values) {
      if (value.term.type === "uri") {
        iris.add(value.term.value);
      }
    }
  }

  return Array.from(iris).filter(isSafeIri);
};

export const withLabels = (
  details: ResourceDetails,
  labels: Map<string, string>
): ResourceDetails => ({
  ...details,
  label: labels.get(details.uri),
  types: details.types.map((type) => ({ ...type, label: labels.get(type.iri) })),
  outgoing: details.outgoing.map((property) => ({
    ...property,
    label: labels.get(property.predicate),
    values: property.values.map((value) => ({
      ...value,
      label:
        value.term.type === "uri" ? labels.get(value.term.value) : undefined,
    })),
  })),
  incoming: details.incoming.map((property) => ({
    ...property,
    label: labels.get(property.predicate),
    values: property.values.map((value) => ({
      ...value,
      label:
        value.term.type === "uri" ? labels.get(value.term.value) : undefined,
    })),
  })),
});

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
