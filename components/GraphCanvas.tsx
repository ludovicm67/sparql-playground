import { useCallback, useRef, useState } from "react";
import { displayTerm, localName, type NodeKind, type TermRef } from "../lib/explore";
import { type Graph, type GraphNode } from "../lib/graph";
import { ChipIcon, CloseIcon, CloudIcon, ResourceIcon } from "./icons";

export type Viewport = { x: number; y: number; scale: number };

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

const NODE_WIDTH = 168;
const NODE_HEIGHT = 46;

export type DropPayload = { kind: NodeKind; term: TermRef; label?: string };

type Props = {
  graph: Graph;
  viewport: Viewport;
  selectedId: string | undefined;
  onViewportChange: (viewport: Viewport) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onSelect: (id: string | undefined) => void;
  onRemove: (id: string) => void;
  onOpenResource: (iri: string) => void;
  onDropTerm: (payload: DropPayload, position: { x: number; y: number }) => void;
};

const kindIcon = (kind: NodeKind) => {
  if (kind === "class") {
    return <ChipIcon size={13} />;
  }
  if (kind === "instance") {
    return <CloudIcon size={13} />;
  }
  return null;
};

/**
 * Where an edge should meet a node box, so arrows stop at the border. Aiming at
 * the curve's control point rather than the far node also spreads the departure
 * points of parallel edges.
 */
const anchor = (from: GraphNode, target: { x: number; y: number }) => {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const halfWidth = NODE_WIDTH / 2;
  const halfHeight = NODE_HEIGHT / 2;

  if (dx === 0 && dy === 0) {
    return { x: from.x, y: from.y };
  }

  // Scale the direction vector until it hits the rectangle's edge.
  const scale = Math.min(
    dx === 0 ? Infinity : halfWidth / Math.abs(dx),
    dy === 0 ? Infinity : halfHeight / Math.abs(dy)
  );

  return { x: from.x + dx * scale, y: from.y + dy * scale };
};

const GraphCanvas: React.FC<Props> = ({
  graph,
  viewport,
  selectedId,
  onViewportChange,
  onMoveNode,
  onSelect,
  onRemove,
  onOpenResource,
  onDropTerm,
}) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    | { type: "node"; id: string; offsetX: number; offsetY: number }
    | { type: "pan"; startX: number; startY: number; originX: number; originY: number }
    | undefined
  >(undefined);
  const [dragOver, setDragOver] = useState(false);

  /** Screen coordinates -> graph coordinates. */
  const toGraph = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) {
        return { x: 0, y: 0 };
      }

      return {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale,
      };
    },
    [viewport]
  );

  const handleNodePointerDown = (event: React.PointerEvent, node: GraphNode) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);

    const point = toGraph(event.clientX, event.clientY);
    dragRef.current = {
      type: "node",
      id: node.id,
      offsetX: point.x - node.x,
      offsetY: point.y - node.y,
    };
    onSelect(node.id);
  };

  const handleSurfacePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      type: "pan",
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    onSelect(undefined);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }

    if (drag.type === "node") {
      const point = toGraph(event.clientX, event.clientY);
      onMoveNode(drag.id, point.x - drag.offsetX, point.y - drag.offsetY);
      return;
    }

    onViewportChange({
      ...viewport,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };

  const endDrag = () => {
    dragRef.current = undefined;
  };

  const handleWheel = (event: React.WheelEvent) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const scale = Math.min(
      2.5,
      Math.max(0.25, viewport.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
    );

    // Keep the point under the cursor fixed while zooming.
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const ratio = scale / viewport.scale;

    onViewportChange({
      scale,
      x: pointerX - (pointerX - viewport.x) * ratio,
      y: pointerY - (pointerY - viewport.y) * ratio,
    });
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);

    const raw = event.dataTransfer.getData("application/x-sparql-term");
    if (!raw) {
      return;
    }

    try {
      onDropTerm(JSON.parse(raw) as DropPayload, toGraph(event.clientX, event.clientY));
    } catch {
      // A drag from somewhere else; nothing to add.
    }
  };

  return (
    <div
      ref={surfaceRef}
      className={`canvas${dragOver ? " is-drop-target" : ""}`}
      onPointerDown={handleSurfacePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={handleWheel}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDragOver(false);
        }
      }}
      onDrop={handleDrop}
    >
      <div
        className="canvas-world"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        <svg className="canvas-edges" aria-hidden="true">
          <defs>
            <marker
              id="graph-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>

          {graph.edges.map((edge) => {
            const from = graph.nodes.find((node) => node.id === edge.from);
            const to = graph.nodes.find((node) => node.id === edge.to);
            if (!from || !to) {
              return null;
            }

            const active = selectedId === from.id || selectedId === to.id;

            // Several predicates can join the same two nodes, in either
            // direction. Fan them apart so no two arrows or labels coincide.
            const siblings = graph.edges.filter(
              (other) =>
                (other.from === edge.from && other.to === edge.to) ||
                (other.from === edge.to && other.to === edge.from)
            );
            const index = siblings.findIndex((other) => other.id === edge.id);

            if (from.id === to.id) {
              // A self-link has no direction to bow along, so loop it above the
              // node, each one on a wider arc than the last.
              const radius = 30 + index * 16;
              const start = { x: from.x - 26, y: from.y - NODE_HEIGHT / 2 };
              const finish = { x: from.x + 26, y: from.y - NODE_HEIGHT / 2 };

              const peak = from.y - NODE_HEIGHT / 2 - radius * 1.9;

              return (
                <g key={edge.id} className={`edge${active ? " is-active" : ""}`}>
                  <path
                    d={`M ${start.x} ${start.y} C ${start.x - radius} ${peak}, ${finish.x + radius} ${peak}, ${finish.x} ${finish.y}`}
                    fill="none"
                    markerEnd="url(#graph-arrow)"
                  />
                  <text x={from.x} y={peak + 14} textAnchor="middle">
                    {localName(edge.predicate)}
                  </text>
                </g>
              );
            }

            // The normal is taken in a fixed frame for the pair — ordered by
            // node id, not by this edge's direction. Otherwise A->B and B->A
            // with mirrored offsets land on the *same* curve and one label
            // hides under the other.
            const [low, high] = from.id <= to.id ? [from, to] : [to, from];
            const frameX = high.x - low.x;
            const frameY = high.y - low.y;
            const frameLength = Math.hypot(frameX, frameY) || 1;

            const spread = (index - (siblings.length - 1) / 2) * 54;
            const controlX = (from.x + to.x) / 2 - (frameY / frameLength) * spread;
            const controlY = (from.y + to.y) / 2 + (frameX / frameLength) * spread;

            const start = anchor(from, { x: controlX, y: controlY });
            const finish = anchor(to, { x: controlX, y: controlY });

            const path =
              spread === 0
                ? `M ${start.x} ${start.y} L ${finish.x} ${finish.y}`
                : `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${finish.x} ${finish.y}`;

            // Fanning the curves apart is not enough on its own: labels are far
            // wider than the gap between them. Slide each one to a different
            // point along its own curve as well.
            const t =
              siblings.length === 1
                ? 0.5
                : 0.32 + (index / (siblings.length - 1)) * 0.36;
            const labelX =
              (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * controlX + t * t * finish.x;
            const labelY =
              (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * controlY + t * t * finish.y;

            return (
              <g key={edge.id} className={`edge${active ? " is-active" : ""}`}>
                <path d={path} fill="none" markerEnd="url(#graph-arrow)" />
                <text x={labelX} y={labelY - 5} textAnchor="middle">
                  {localName(edge.predicate)}
                </text>
              </g>
            );
          })}
        </svg>

        {graph.nodes.map((node) => (
          <div
            key={node.id}
            className={`node is-${node.kind}${
              selectedId === node.id ? " is-selected" : ""
            }`}
            style={{
              left: node.x - NODE_WIDTH / 2,
              top: node.y - NODE_HEIGHT / 2,
              width: NODE_WIDTH,
            }}
            onPointerDown={(event) => handleNodePointerDown(event, node)}
            title={node.term.type === "uri" ? node.term.value : node.term.value}
          >
            <span className="node-icon">{kindIcon(node.kind)}</span>
            <span className="node-label">{node.label ?? displayTerm(node.term)}</span>

            <span className="node-actions">
              {node.term.type === "uri" ? (
                // Straight to the resource page, without going through the
                // inspector — a node with nothing leading out of it has no
                // other reason to open one.
                <button
                  className="node-action"
                  type="button"
                  aria-label={`Open ${displayTerm(node.term)} as a resource`}
                  title="Open as a resource"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (node.term.type === "uri") {
                      onOpenResource(node.term.value);
                    }
                  }}
                >
                  <ResourceIcon size={11} />
                </button>
              ) : null}

              <button
                className="node-action is-danger"
                type="button"
                aria-label={`Remove ${displayTerm(node.term)} from the canvas`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(node.id);
                }}
              >
                <CloseIcon size={11} />
              </button>
            </span>
          </div>
        ))}
      </div>

      {graph.nodes.length === 0 ? (
        <div className="canvas-empty">
          <p className="state-title">The canvas is empty</p>
          <p className="state-hint">
            Drag a class or an instance from the left, or use its <b>+</b> button.
            Click a node to follow its predicates.
          </p>
        </div>
      ) : null}
    </div>
  );
};

export default GraphCanvas;
