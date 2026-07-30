import { isSafeIri, type NodeKind, type TermRef } from "./explore";
import { edgeId, emptyGraph, type Graph, type GraphEdge, type GraphNode, nodeId } from "./graph";
import { newId, readJson, STORAGE_KEYS, writeJson } from "./storage";

export type StoredViewport = { x: number; y: number; scale: number };

export type CanvasDoc = {
  id: string;
  name: string;
  graph: Graph;
  viewport: StoredViewport;
  updatedAt: number;
};

/** Canvases are scoped per connection, the same way history is. */
export type ConnectionCanvases = {
  canvases: CanvasDoc[];
  activeId: string | undefined;
};

type CanvasStore = Record<string, ConnectionCanvases>;

/**
 * A canvas is built by hand, so it never gets truly large — but localStorage is
 * a shared, ~5MB budget, and a runaway "select all" should not be able to
 * wedge the app's other settings.
 */
const MAX_NODES = 600;
const MAX_EDGES = 2000;
const MAX_CANVASES = 30;

export const defaultViewport = (): StoredViewport => ({ x: 0, y: 0, scale: 1 });

const NODE_KINDS: NodeKind[] = ["class", "instance", "literal"];

const sanitizeTerm = (value: unknown): TermRef | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  if (typeof raw.value !== "string") {
    return undefined;
  }

  if (raw.type === "uri") {
    // A stored IRI is replayed into queries, so it must still pass the same
    // check it did when it arrived from the endpoint.
    return isSafeIri(raw.value) ? { type: "uri", value: raw.value } : undefined;
  }
  if (raw.type === "bnode") {
    return { type: "bnode", value: raw.value };
  }
  if (raw.type === "literal") {
    return {
      type: "literal",
      value: raw.value,
      datatype: typeof raw.datatype === "string" ? raw.datatype : undefined,
      lang: typeof raw.lang === "string" ? raw.lang : undefined,
    };
  }

  return undefined;
};

const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const sanitizeNode = (value: unknown): GraphNode | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const term = sanitizeTerm(raw.term);
  const x = finite(raw.x);
  const y = finite(raw.y);

  if (!term || x === undefined || y === undefined) {
    return undefined;
  }

  return {
    // Recompute rather than trust: the id must stay derived from the term, or
    // deduplication and edge matching break.
    id: nodeId(term),
    kind: NODE_KINDS.includes(raw.kind as NodeKind)
      ? (raw.kind as NodeKind)
      : "instance",
    term,
    label: typeof raw.label === "string" ? raw.label : undefined,
    x,
    y,
  };
};

export const sanitizeGraph = (value: unknown): Graph => {
  if (typeof value !== "object" || value === null) {
    return emptyGraph();
  }

  const raw = value as Record<string, unknown>;
  const nodes: GraphNode[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw.nodes)) {
    for (const candidate of raw.nodes) {
      const node = sanitizeNode(candidate);
      if (node && !seen.has(node.id)) {
        seen.add(node.id);
        nodes.push(node);
      }
      if (nodes.length >= MAX_NODES) {
        break;
      }
    }
  }

  const edges: GraphEdge[] = [];
  const knownEdges = new Set<string>();

  if (Array.isArray(raw.edges)) {
    for (const candidate of raw.edges) {
      if (typeof candidate !== "object" || candidate === null) {
        continue;
      }

      const entry = candidate as Record<string, unknown>;
      const { from, to, predicate } = entry;

      if (
        typeof from !== "string" ||
        typeof to !== "string" ||
        typeof predicate !== "string" ||
        !isSafeIri(predicate) ||
        from === to ||
        !seen.has(from) ||
        !seen.has(to)
      ) {
        continue;
      }

      const id = edgeId(from, predicate, to);
      if (knownEdges.has(id)) {
        continue;
      }

      knownEdges.add(id);
      edges.push({ id, from, to, predicate });

      if (edges.length >= MAX_EDGES) {
        break;
      }
    }
  }

  return { nodes, edges };
};

export const sanitizeViewport = (value: unknown): StoredViewport => {
  if (typeof value !== "object" || value === null) {
    return defaultViewport();
  }

  const raw = value as Record<string, unknown>;
  const scale = finite(raw.scale);

  return {
    x: finite(raw.x) ?? 0,
    y: finite(raw.y) ?? 0,
    scale: scale !== undefined ? Math.min(2.5, Math.max(0.25, scale)) : 1,
  };
};

export const sanitizeCanvasName = (value: unknown, fallback: string) => {
  const name = typeof value === "string" ? value.trim() : "";
  return name ? name.slice(0, 80) : fallback;
};

const sanitizeDoc = (value: unknown, index: number): CanvasDoc | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
    name: sanitizeCanvasName(raw.name, `Canvas ${index + 1}`),
    graph: sanitizeGraph(raw.graph),
    viewport: sanitizeViewport(raw.viewport),
    updatedAt: finite(raw.updatedAt) ?? 0,
  };
};

const loadAll = (): CanvasStore => {
  const stored = readJson<unknown>(STORAGE_KEYS.canvas, undefined);
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return {};
  }

  const store: CanvasStore = {};

  for (const [connectionId, entry] of Object.entries(stored)) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const raw = entry as Record<string, unknown>;

    // Entries written before canvases could be named held a single
    // `{ graph, viewport }`; fold those into one document.
    const rawDocs = Array.isArray(raw.canvases)
      ? raw.canvases
      : raw.graph
        ? [{ id: newId(), name: "Canvas 1", graph: raw.graph, viewport: raw.viewport }]
        : [];

    const canvases = rawDocs
      .slice(0, MAX_CANVASES)
      .flatMap((doc, index) => {
        const parsed = sanitizeDoc(doc, index);
        return parsed ? [parsed] : [];
      });

    const activeId =
      typeof raw.activeId === "string" &&
      canvases.some((doc) => doc.id === raw.activeId)
        ? raw.activeId
        : canvases[0]?.id;

    store[connectionId] = { canvases, activeId };
  }

  return store;
};

const persist = (store: CanvasStore) => writeJson(STORAGE_KEYS.canvas, store);

export const newCanvas = (name: string): CanvasDoc => ({
  id: newId(),
  name,
  graph: emptyGraph(),
  viewport: defaultViewport(),
  updatedAt: 0,
});

/** Every canvas for a connection, seeding a first one when there is none. */
export const loadCanvases = (connectionId: string): ConnectionCanvases => {
  const entry = loadAll()[connectionId];

  if (!entry || entry.canvases.length === 0) {
    const first = newCanvas("Canvas 1");
    return { canvases: [first], activeId: first.id };
  }

  return entry;
};

export const saveCanvases = (
  connectionId: string,
  canvases: CanvasDoc[],
  activeId: string | undefined
) => {
  const store = loadAll();

  const meaningful = canvases.slice(0, MAX_CANVASES);
  const onlyEmptyDefault =
    meaningful.length === 1 && meaningful[0].graph.nodes.length === 0;

  if (meaningful.length === 0 || onlyEmptyDefault) {
    // Nothing worth remembering for this connection.
    delete store[connectionId];
  } else {
    store[connectionId] = { canvases: meaningful, activeId };
  }

  persist(store);
};

/** Drop canvases belonging to connections that no longer exist. */
export const pruneCanvases = (connectionIds: string[]) => {
  const store = loadAll();
  let changed = false;

  for (const connectionId of Object.keys(store)) {
    if (!connectionIds.includes(connectionId)) {
      delete store[connectionId];
      changed = true;
    }
  }

  if (changed) {
    persist(store);
  }
};

/** A name that does not collide with the ones already in use. */
export const nextCanvasName = (canvases: CanvasDoc[]) => {
  const taken = new Set(canvases.map((doc) => doc.name));

  for (let index = canvases.length + 1; index < canvases.length + 200; index += 1) {
    const candidate = `Canvas ${index}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  return `Canvas ${canvases.length + 1}`;
};
