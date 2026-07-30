import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as oxigraph from "oxigraph/web";
import {
  CanvasDoc,
  loadCanvases,
  newCanvas,
  nextCanvasName,
  saveCanvases,
} from "../lib/canvas";
import { Connection } from "../lib/connections";
import {
  CLASS_PAGE_SIZE,
  ClassEntry,
  classesQuery,
  describeQuery,
  directLinksQuery,
  instancesOfClassQuery,
  instancesQuery,
  labelsQuery,
  localName,
  NodeKind,
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
  TermRef,
} from "../lib/explore";
import {
  addEdges,
  addNode,
  emptyGraph,
  findNode,
  freePosition,
  Graph,
  moveNode,
  nodeId,
  removeNode,
} from "../lib/graph";
import { fitViewport, forceLayout } from "../lib/layout";
import { SharedCanvas } from "../lib/share";
import { runQuery } from "../lib/sparql";
import CanvasTabs from "./CanvasTabs";
import ExplorePanel from "./ExplorePanel";
import GraphCanvas, { Viewport } from "./GraphCanvas";
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

  // An IRI handed over from the resource page: place it, then tell the parent
  // so it is not re-added on the next render.
  const addTermRef = useRef<((kind: NodeKind, term: TermRef) => void) | undefined>(
    undefined
  );
  useEffect(() => {
    if (!pendingUri) {
      return;
    }
    addTermRef.current?.("instance", { type: "uri", value: pendingUri });
    onPendingUriConsumed?.();
  }, [pendingUri, onPendingUriConsumed]);

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
   * Discover how a newly placed IRI relates to what is already on the canvas:
   * direct triples always, plus schema-level links when both ends are classes.
   */
  const discoverLinks = useCallback(
    async (iri: string, kind: NodeKind) => {
      const current = graphRef.current;
      const others = current.nodes
        .filter((node) => node.term.type === "uri" && node.term.value !== iri)
        .map((node) => node.term.value);

      if (others.length === 0) {
        return;
      }

      const found: { from: string; predicate: string; to: string }[] = [];

      try {
        found.push(...parseLinks(await run(directLinksQuery(iri, others))));
      } catch {
        // A slow or restricted endpoint just means no discovered edges.
      }

      if (kind === "class") {
        const otherClasses = current.nodes
          .filter((node) => node.kind === "class" && node.term.value !== iri)
          .map((node) => node.term.value);

        if (otherClasses.length > 0) {
          try {
            found.push(...parseLinks(await run(schemaLinksQuery(iri, otherClasses))));
          } catch {
            // Schema-level discovery is best-effort; it can be costly.
          }
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
    (kind: NodeKind, term: TermRef, at?: { x: number; y: number }) => {
      // The id is derived from the term, so it can be known before the update
      // and the updater itself stays pure.
      const id = nodeId(term);
      const isNew = !findNode(graphRef.current, id);
      const preferred = at ?? centreOfView();

      setGraph((current) =>
        addNode(current, {
          kind,
          term,
          label: term.type === "uri" ? localName(term.value) : term.value,
          ...freePosition(current, preferred),
        }).graph
      );
      setSelectedId(id);

      if (isNew && term.type === "uri") {
        setBusy(true);
        void discoverLinks(term.value, kind).finally(() => setBusy(false));
      }
    },
    [centreOfView, discoverLinks, setGraph]
  );

  useEffect(() => {
    addTermRef.current = (kind, term) => addTerm(kind, term);
  }, [addTerm]);

  /**
   * Objects reached through a predicate already carry their edge, so they are
   * connected without asking the endpoint again.
   */
  const addObjects = useCallback(
    (sourceId: string, predicate: string, terms: TermRef[]) => {
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
    },
    [setGraph]
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

  const inspectorPredicates = useCallback(async () => {
    if (!selected || selected.term.type !== "uri") {
      return [];
    }
    return loadPredicates({ kind: selected.kind, iri: selected.term.value });
  }, [selected, loadPredicates]);

  const inspectorObjects = useCallback(
    async (predicate: string, offset: number) => {
      if (!selected || selected.term.type !== "uri" || !predicate) {
        return [];
      }
      return loadObjects(
        { kind: selected.kind, iri: selected.term.value },
        predicate,
        offset
      );
    },
    [selected, loadObjects]
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
        onAddTerm={(kind, term) => addTerm(kind, term)}
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
              title="Arrange the nodes and fit them to the view"
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
              title="Get a link to this canvas"
            >
              <ShareIcon size={14} />
            </button>
            <button
              className="icon-btn"
              type="button"
              onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}
              aria-label="Reset the view"
              title="Reset zoom and position"
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
              title="Clear the canvas"
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
            onDropTerm={(payload, position) =>
              addTerm(payload.kind, payload.term, position)
            }
          />

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
