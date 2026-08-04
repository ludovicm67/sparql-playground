import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as oxigraph from "oxigraph/web";
import {
  type CanvasDoc,
  loadCanvases,
  newCanvas,
  nextCanvasName,
  saveCanvases,
} from "../lib/canvas";
import { type Connection } from "../lib/connections";
import {
  CLASS_PAGE_SIZE,
  type ClassEntry,
  classesQuery,
  describeQuery,
  directLinksQuery,
  instancesOfClassQuery,
  instancesQuery,
  isSafeIri,
  labelsQuery,
  localName,
  type NodeKind,
  objectsQuery,
  PAGE_SIZE,
  parseClasses,
  parseInstances,
  parseLabels,
  parseLinks,
  parseObjects,
  parsePredicates,
  predicatesQuery,
  schemaLinksQuery,
  type TermRef,
} from "../lib/explore";
import {
  addEdges,
  addNode,
  emptyGraph,
  findNode,
  freePosition,
  type Graph,
  moveNode,
  nodeId,
  removeNode,
} from "../lib/graph";
import { fitViewport, forceLayout } from "../lib/layout";
import { type SharedCanvas } from "../lib/share";
import { runQuery } from "../lib/sparql";
import CanvasTabs from "./CanvasTabs";
import ExplorePanel from "./ExplorePanel";
import LiteralInspector from "./LiteralInspector";
import GraphCanvas, { type Viewport } from "./GraphCanvas";
import NodeInspector from "./NodeInspector";
import { LayoutIcon, ShareIcon, TrashIcon } from "./icons";

type Props = {
  connection: Connection;
  store: oxigraph.Store | undefined;
  /** Kept mounted while hidden so the canvas survives a trip to Query mode. */
  hidden?: boolean;
  /** A canvas that arrived on a shared link, adopted once on mount. */
  incomingCanvas?: SharedCanvas;
  /** An IRI handed over from another mode, dropped onto the canvas once. */
  pendingUri?: string;
  onPendingUriConsumed?: () => void;
  onOpenQuery: (query: string) => void;
  onOpenResource: (uri: string) => void;
  onShareCanvas: (canvas: SharedCanvas & { nodeCount: number }) => void;
};

const Explore: React.FC<Props> = ({
  connection,
  store,
  hidden,
  incomingCanvas,
  pendingUri,
  onPendingUriConsumed,
  onOpenQuery,
  onOpenResource,
  onShareCanvas,
}) => {
  // Explore is keyed by connection, so this restores that connection's canvases
  // on mount. Client-only, like the rest of the app's persisted state.
  const [restored] = useState(() => {
    const existing = loadCanvases(connection.id);
    if (!incomingCanvas) {
      return existing;
    }

    const adopted: CanvasDoc = {
      ...newCanvas(incomingCanvas.name),
      graph: incomingCanvas.graph,
      viewport: incomingCanvas.viewport,
    };

    return {
      canvases: [...existing.canvases, adopted],
      activeId: adopted.id,
    };
  });

  const [canvases, setCanvases] = useState<CanvasDoc[]>(restored.canvases);
  const [activeCanvasId, setActiveCanvasId] = useState(
    restored.activeId ?? restored.canvases[0].id
  );
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [openedClass, setOpenedClass] = useState<ClassEntry | undefined>();
  const [busy, setBusy] = useState(false);

  const canvasBodyRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => canvases.find((doc) => doc.id === activeCanvasId) ?? canvases[0],
    [canvases, activeCanvasId]
  );

  const graph = active.graph;
  const viewport = active.viewport;

  const updateActive = useCallback(
    (change: (doc: CanvasDoc) => CanvasDoc) => {
      setCanvases((current) =>
        current.map((doc) => (doc.id === active.id ? change(doc) : doc))
      );
    },
    [active.id]
  );

  const setGraph = useCallback(
    (change: (current: Graph) => Graph) => {
      updateActive((doc) => ({
        ...doc,
        graph: change(doc.graph),
        updatedAt: Date.now(),
      }));
    },
    [updateActive]
  );

  const setViewport = useCallback(
    (next: Viewport) => updateActive((doc) => ({ ...doc, viewport: next })),
    [updateActive]
  );

  // Link discovery runs asynchronously and needs the node set as it stands, so
  // mirror the graph into a ref rather than capturing it in a closure.
  const graphRef = useRef(graph);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  // Debounced: dragging a node fires a state update per pointer move, and
  // localStorage writes are synchronous.
  useEffect(() => {
    const timer = setTimeout(
      () => saveCanvases(connection.id, canvases, activeCanvasId),
      400
    );
    return () => clearTimeout(timer);
  }, [connection.id, canvases, activeCanvasId]);

  const run = useCallback(
    (query: string) => runQuery(connection, query, store),
    [connection, store]
  );


  /** Fetch display labels for a page of IRIs; failure is not worth surfacing. */
  const labelsFor = useCallback(
    async (iris: string[]) => {
      if (iris.length === 0) {
        return new Map<string, string>();
      }
      try {
        return parseLabels(await run(labelsQuery(iris)));
      } catch {
        return new Map<string, string>();
      }
    },
    [run]
  );

  const loadClasses = useCallback(
    async (offset: number) => {
      const entries = parseClasses(await run(classesQuery(CLASS_PAGE_SIZE, offset)));
      const labels = await labelsFor(entries.map((entry) => entry.iri));

      return entries.map((entry) => ({ ...entry, label: labels.get(entry.iri) }));
    },
    [run, labelsFor]
  );

  const loadInstances = useCallback(
    async (classIri: string, offset: number) => {
      const entries = parseInstances(
        await run(instancesQuery(classIri, PAGE_SIZE, offset))
      );
      const labels = await labelsFor(entries.map((entry) => entry.iri));

      return entries.map((entry) => ({ ...entry, label: labels.get(entry.iri) }));
    },
    [run, labelsFor]
  );

  const loadPredicates = useCallback(
    async (node: { kind: NodeKind; iri: string }) =>
      parsePredicates(await run(predicatesQuery(node))),
    [run]
  );

  const loadObjects = useCallback(
    async (node: { kind: NodeKind; iri: string }, predicate: string, offset: number) =>
      parseObjects(await run(objectsQuery(node, predicate, PAGE_SIZE, offset))),
    [run]
  );

  /**
   * Replace the placeholder local names with the endpoint's own labels, so a
   * node reads "Sheldon Cooper" rather than "sheldon-cooper".
   */
  const nameNodes = useCallback(
    async (iris: string[]) => {
      const labels = await labelsFor(iris);
      if (labels.size === 0) {
        return;
      }

      setGraph((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.term.type === "uri" && labels.has(node.term.value)
            ? { ...node, label: labels.get(node.term.value) }
            : node
        ),
      }));
    },
    [labelsFor, setGraph]
  );

  /**
   * Discover how a newly placed IRI relates to what is already on the canvas:
   * direct triples always, plus schema-level links when both ends are classes.
   */
  const discoverLinks = useCallback(
    async (added: string[]) => {
      const current = graphRef.current;
      const all = current.nodes
        .filter((node) => node.term.type === "uri")
        .map((node) => node.term.value);

      // `all` is the graph as it stood before the update, so make sure the new
      // arrivals are in it: they can be linked to each other.
      const everything = Array.from(new Set([...all, ...added]));
      const newcomers = added.filter((iri) => isSafeIri(iri));

      if (newcomers.length === 0 || everything.length < 2) {
        return;
      }

      const found: { from: string; predicate: string; to: string }[] = [];

      try {
        found.push(...parseLinks(await run(directLinksQuery(newcomers, everything))));
      } catch {
        // A slow or restricted endpoint just means no discovered edges.
      }

      // Schema-level links only make sense between class nodes.
      const classes = current.nodes
        .filter((node) => node.kind === "class" && node.term.type === "uri")
        .map((node) => node.term.value);

      for (const iri of newcomers) {
        const others = classes.filter((candidate) => candidate !== iri);
        if (!classes.includes(iri) || others.length === 0) {
          continue;
        }
        try {
          found.push(...parseLinks(await run(schemaLinksQuery(iri, others))));
        } catch {
          // Schema-level discovery is best-effort; it can be costly.
        }
      }

      if (found.length > 0) {
        setGraph((existing) =>
          addEdges(
            existing,
            found.map((link) => ({
              from: nodeId({ type: "uri", value: link.from }),
              to: nodeId({ type: "uri", value: link.to }),
              predicate: link.predicate,
            }))
          )
        );
      }
    },
    [run, setGraph]
  );

  const centreOfView = useCallback(
    () => ({
      x: (360 - viewport.x) / viewport.scale,
      y: (260 - viewport.y) / viewport.scale,
    }),
    [viewport]
  );

  const addTerm = useCallback(
    (kind: NodeKind, term: TermRef, at?: { x: number; y: number }, label?: string) => {
      // The id is derived from the term, so it can be known before the update
      // and the updater itself stays pure.
      const id = nodeId(term);
      const isNew = !findNode(graphRef.current, id);
      const preferred = at ?? centreOfView();

      setGraph((current) =>
        addNode(current, {
          kind,
          term,
          label: label ?? (term.type === "uri" ? localName(term.value) : term.value),
          ...freePosition(current, preferred),
        }).graph
      );
      setSelectedId(id);

      if (isNew && term.type === "uri") {
        setBusy(true);
        void Promise.all([
          discoverLinks([term.value]),
          label ? Promise.resolve() : nameNodes([term.value]),
        ]).finally(() => setBusy(false));
      }
    },
    [centreOfView, discoverLinks, nameNodes, setGraph]
  );

  /**
   * An IRI handed over from the resource page: place it, then tell the parent
   * so it is not re-added on the next render.
   *
   * Declared after `addTerm` and calling it directly. It used to go through a
   * ref assigned by an effect further down, which on the very first mount had
   * not run yet — so the node was dropped while still being reported as taken,
   * and "add to the canvas" from a resource silently did nothing in a fresh
   * session. Re-adding is prevented by remembering what was taken, reset when
   * the parent clears the handover.
   */
  const takenUri = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!pendingUri) {
      takenUri.current = undefined;
      return;
    }

    if (takenUri.current === pendingUri) {
      return;
    }

    takenUri.current = pendingUri;
    addTerm("instance", { type: "uri", value: pendingUri });
    onPendingUriConsumed?.();
  }, [pendingUri, addTerm, onPendingUriConsumed]);

  /**
   * Objects reached through a predicate already carry their edge, so they are
   * connected without asking the endpoint again.
   */
  const addObjects = useCallback(
    (sourceId: string, predicate: string, terms: TermRef[]) => {
      // Which of these are actually new has to be decided before the update so
      // the updater stays pure.
      const arrivals = terms
        .filter((term) => term.type === "uri")
        .map((term) => term.value)
        .filter((iri) => !findNode(graphRef.current, nodeId({ type: "uri", value: iri })));

      setGraph((current) => {
        let next = current;
        const source = findNode(current, sourceId);
        const origin = source
          ? { x: source.x + 240, y: source.y }
          : { x: 400, y: 260 };

        const edges: { from: string; to: string; predicate: string }[] = [];

        for (const term of terms) {
          const position = freePosition(next, origin);
          const result = addNode(next, {
            kind: term.type === "literal" ? "literal" : "instance",
            term,
            label: term.type === "uri" ? localName(term.value) : term.value,
            x: position.x,
            y: position.y,
          });

          next = result.graph;
          edges.push({ from: sourceId, to: result.id, predicate });
        }

        return addEdges(next, edges);
      });

      // The edge back to the source is known, but these nodes may also connect
      // to anything else already on the canvas — and to each other.
      if (arrivals.length > 0) {
        setBusy(true);
        void Promise.all([discoverLinks(arrivals), nameNodes(arrivals)]).finally(() =>
          setBusy(false)
        );
      }
    },
    [discoverLinks, nameNodes, setGraph]
  );

  const autoLayout = useCallback(() => {
    const laid = forceLayout(graphRef.current);
    const surface = canvasBodyRef.current?.getBoundingClientRect();

    updateActive((doc) => ({
      ...doc,
      graph: laid,
      viewport: surface
        ? fitViewport(laid, { width: surface.width, height: surface.height })
        : doc.viewport,
      updatedAt: Date.now(),
    }));
  }, [updateActive]);

  const selected = selectedId ? findNode(graph, selectedId) : undefined;

  // Depend on *what* is selected, not on the node object: moving a node
  // rebuilds it on every pointer event, and a loader whose identity changes
  // that often would re-query the endpoint for each frame of a drag.
  const selectedIri = selected?.term.type === "uri" ? selected.term.value : undefined;
  const selectedKind = selected?.kind;

  const inspectorPredicates = useCallback(async () => {
    if (!selectedIri || !selectedKind) {
      return [];
    }
    return loadPredicates({ kind: selectedKind, iri: selectedIri });
  }, [selectedIri, selectedKind, loadPredicates]);

  const inspectorObjects = useCallback(
    async (predicate: string, offset: number) => {
      if (!selectedIri || !selectedKind || !predicate) {
        return [];
      }
      return loadObjects({ kind: selectedKind, iri: selectedIri }, predicate, offset);
    },
    [selectedIri, selectedKind, loadObjects]
  );

  return (
    <main className="workspace workspace--explore" hidden={hidden}>
      <ExplorePanel
        classPageSize={CLASS_PAGE_SIZE}
        instancePageSize={PAGE_SIZE}
        openedClass={openedClass}
        loadClasses={loadClasses}
        loadInstances={loadInstances}
        onOpenClass={setOpenedClass}
        onAddTerm={(kind, term, label) => addTerm(kind, term, undefined, label)}
        onQueryClass={(iri) => onOpenQuery(instancesOfClassQuery(iri))}
        onQueryInstance={(iri) => onOpenQuery(describeQuery(iri))}
        onOpenResource={onOpenResource}
      />

      <section className="panel canvas-panel" aria-label="Graph canvas">
        <CanvasTabs
          canvases={canvases}
          activeId={active.id}
          onSelect={(id) => {
            setActiveCanvasId(id);
            setSelectedId(undefined);
          }}
          onCreate={() => {
            const created = newCanvas(nextCanvasName(canvases));
            setCanvases((current) => [...current, created]);
            setActiveCanvasId(created.id);
            setSelectedId(undefined);
          }}
          onRename={(id, name) =>
            setCanvases((current) =>
              current.map((doc) => (doc.id === id ? { ...doc, name } : doc))
            )
          }
          onDelete={(id) =>
            setCanvases((current) => {
              const remaining = current.filter((doc) => doc.id !== id);
              const next =
                remaining.length > 0 ? remaining : [newCanvas("Canvas 1")];

              if (id === activeCanvasId) {
                setActiveCanvasId(next[0].id);
                setSelectedId(undefined);
              }

              return next;
            })
          }
        />

        <div className="panel-header">
          <span className="panel-status">
            {busy ? <span className="timing">linking…</span> : null}
            <span>
              {graph.nodes.length} {graph.nodes.length === 1 ? "node" : "nodes"}
            </span>
            <span className="timing">
              {graph.edges.length} {graph.edges.length === 1 ? "edge" : "edges"}
            </span>
          </span>

          <div className="panel-header-actions">
            <button
              className="icon-btn"
              type="button"
              onClick={autoLayout}
              disabled={graph.nodes.length < 2}
              aria-label="Tidy up the layout"
              data-tooltip="Arrange the nodes and fit them to the view"
            >
              <LayoutIcon />
            </button>
            <button
              className="icon-btn"
              type="button"
              onClick={() =>
                onShareCanvas({
                  name: active.name,
                  graph: active.graph,
                  viewport: active.viewport,
                  nodeCount: active.graph.nodes.length,
                })
              }
              disabled={graph.nodes.length === 0}
              aria-label="Share this canvas"
              data-tooltip="Get a link to this canvas"
            >
              <ShareIcon size={14} />
            </button>
            <button
              className="icon-btn"
              type="button"
              onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}
              aria-label="Reset the view"
              data-tooltip="Reset zoom and position"
            >
              <span className="reset-view">{Math.round(viewport.scale * 100)}%</span>
            </button>
            <button
              className="icon-btn is-danger"
              type="button"
              onClick={() => {
                setGraph(() => emptyGraph());
                setSelectedId(undefined);
              }}
              disabled={graph.nodes.length === 0}
              aria-label="Clear the canvas"
              data-tooltip="Clear the canvas"
            >
              <TrashIcon size={13} />
            </button>
          </div>
        </div>

        <div className="panel-body panel-body--flush canvas-body" ref={canvasBodyRef}>
          <GraphCanvas
            graph={graph}
            viewport={viewport}
            selectedId={selectedId}
            onViewportChange={setViewport}
            onMoveNode={(id, x, y) => setGraph((current) => moveNode(current, id, x, y))}
            onSelect={setSelectedId}
            onRemove={(id) => {
              setGraph((current) => removeNode(current, id));
              setSelectedId((current) => (current === id ? undefined : current));
            }}
            onOpenResource={onOpenResource}
            onDropTerm={(payload, position) =>
              addTerm(payload.kind, payload.term, position, payload.label)
            }
          />

          {selected && selected.term.type !== "uri" ? (
            <LiteralInspector
              key={selected.id}
              node={selected}
              onClose={() => setSelectedId(undefined)}
            />
          ) : null}

          {selected && selected.term.type === "uri" ? (
            <NodeInspector
              key={selected.id}
              node={selected}
              objectPageSize={PAGE_SIZE}
              loadPredicates={inspectorPredicates}
              loadObjects={inspectorObjects}
              onAddObjects={(predicate, terms) =>
                addObjects(selected.id, predicate, terms)
              }
              onQueryNode={() => onOpenQuery(describeQuery(selected.term.value))}
              onOpenResource={() => onOpenResource(selected.term.value)}
              onClose={() => setSelectedId(undefined)}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
};

export default Explore;
