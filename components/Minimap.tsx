import { useRef, useState } from "react";
import { type Graph } from "../lib/graph";
import { centreOn, minimapLayout } from "../lib/layout";
import { type Viewport } from "./GraphCanvas";

const FRAME = { width: 168, height: 118 };

type Props = {
  graph: Graph;
  viewport: Viewport;
  /** Size of the canvas the map is summarising. */
  surface: { width: number; height: number };
  onViewportChange: (viewport: Viewport) => void;
};

/**
 * An overview of the whole canvas, and where you are looking within it.
 *
 * Pressing anywhere on it jumps there, and dragging scrubs — which is the
 * quickest way back when a layout has thrown nodes off the edge of the screen.
 */
const Minimap: React.FC<Props> = ({ graph, viewport, surface, onViewportChange }) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);

  if (graph.nodes.length === 0) {
    return null;
  }

  const layout = minimapLayout(graph.nodes, viewport, surface, FRAME);

  const jumpTo = (clientX: number, clientY: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    onViewportChange(
      centreOn(
        layout.toWorld({ x: clientX - rect.left, y: clientY - rect.top }),
        surface,
        viewport.scale
      )
    );
  };

  return (
    <div
      className={`canvas-minimap${scrubbing ? " is-scrubbing" : ""}`}
      ref={frameRef}
      style={{ width: FRAME.width, height: FRAME.height }}
      aria-hidden="true"
      // Kept off the canvas's own handlers, or a press here would pan instead.
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setScrubbing(true);
        jumpTo(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (scrubbing) {
          jumpTo(event.clientX, event.clientY);
        }
      }}
      onPointerUp={() => setScrubbing(false)}
      onPointerCancel={() => setScrubbing(false)}
      onWheel={(event) => event.stopPropagation()}
    >
      <svg width={FRAME.width} height={FRAME.height}>
        {layout.nodes.map((node, index) => (
          <rect
            key={graph.nodes[index].id}
            className={`canvas-minimap-node is-${graph.nodes[index].kind}`}
            x={node.x - node.width / 2}
            y={node.y - node.height / 2}
            width={node.width}
            height={node.height}
            rx={1.5}
          />
        ))}

        <rect
          className="canvas-minimap-view"
          x={layout.view.x}
          y={layout.view.y}
          width={layout.view.width}
          height={layout.view.height}
          rx={2}
        />
      </svg>
    </div>
  );
};

export default Minimap;
