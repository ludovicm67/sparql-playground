import { type Graph } from "./graph";

/**
 * A small force-directed layout: every node pushes every other away, edges pull
 * their endpoints together, and the whole thing cools over a fixed number of
 * iterations.
 *
 * It runs synchronously and is deterministic — nodes start from where they
 * already are, so pressing the button twice settles rather than reshuffles.
 * Nodes sharing an exact position are nudged apart first, otherwise the
 * repulsion between them has no direction to act along.
 */
export const forceLayout = (
  graph: Graph,
  options: { iterations?: number; spacing?: number } = {}
): Graph => {
  const { iterations = 320, spacing = 210 } = options;
  const count = graph.nodes.length;

  if (count < 2) {
    return graph;
  }

  const ids = graph.nodes.map((node) => node.id);
  const index = new Map(ids.map((id, position) => [id, position]));
  const x = new Float64Array(count);
  const y = new Float64Array(count);

  // Work in a frame centred on the incoming layout. The bounding frame below is
  // centred on the origin, so feeding it raw canvas coordinates — which sit
  // wherever the user dropped things — would clamp every node onto one edge and
  // flatten the graph.
  const centreX =
    graph.nodes.reduce((total, node) => total + node.x, 0) / count;
  const centreY =
    graph.nodes.reduce((total, node) => total + node.y, 0) / count;

  graph.nodes.forEach((node, position) => {
    // Deterministic de-overlap: spread coincident nodes around a small circle.
    const angle = (position / count) * Math.PI * 2;
    x[position] = node.x - centreX + Math.cos(angle) * 0.5;
    y[position] = node.y - centreY + Math.sin(angle) * 0.5;
  });

  // One spring per connected *pair*, not per statement: several predicates
  // between the same two nodes would otherwise multiply the attraction and
  // collapse them onto each other. Self-links pull on nothing.
  const pairs = new Map<string, readonly [number, number]>();
  for (const edge of graph.edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined || from === to) {
      continue;
    }
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    if (!pairs.has(key)) {
      pairs.set(key, [from, to]);
    }
  }
  const edges = Array.from(pairs.values());

  // Degree drives how hard a node repels: hubs need more room around them.
  const degree = new Float64Array(count);
  for (const [from, to] of edges) {
    degree[from] += 1;
    degree[to] += 1;
  }

  const area = spacing * spacing * count;
  const k = Math.sqrt(area / count);
  // Room to breathe, growing with the node count but not linearly.
  const halfFrame = (spacing * Math.sqrt(count) * 1.6) / 2;
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);

  for (let step = 0; step < iterations; step += 1) {
    dx.fill(0);
    dy.fill(0);

    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) {
        let deltaX = x[a] - x[b];
        let deltaY = y[a] - y[b];
        let distance = Math.hypot(deltaX, deltaY);

        if (distance < 0.01) {
          // Identical positions: push along a fixed axis rather than dividing
          // by zero.
          deltaX = 0.01;
          deltaY = 0;
          distance = 0.01;
        }

        const weight = 1 + Math.min(degree[a], degree[b]) * 0.12;
        const force = ((k * k) / distance) * weight;
        const unitX = (deltaX / distance) * force;
        const unitY = (deltaY / distance) * force;

        dx[a] += unitX;
        dy[a] += unitY;
        dx[b] -= unitX;
        dy[b] -= unitY;
      }
    }

    for (const [from, to] of edges) {
      const deltaX = x[from] - x[to];
      const deltaY = y[from] - y[to];
      const distance = Math.max(0.01, Math.hypot(deltaX, deltaY));
      const force = (distance * distance) / k;
      const unitX = (deltaX / distance) * force;
      const unitY = (deltaY / distance) * force;

      dx[from] -= unitX;
      dy[from] -= unitY;
      dx[to] += unitX;
      dy[to] += unitY;
    }

    // Cool down so late iterations only make small corrections.
    const temperature = k * (1 - step / iterations) * 0.12;

    for (let node = 0; node < count; node += 1) {
      const distance = Math.hypot(dx[node], dy[node]);
      if (distance < 0.001) {
        continue;
      }
      const limit = Math.min(distance, temperature);
      x[node] += (dx[node] / distance) * limit;
      y[node] += (dy[node] / distance) * limit;

      // Keep everything inside a frame. Nodes with no edges have nothing
      // pulling them back, so repulsion alone would fling them out forever.
      x[node] = Math.max(-halfFrame, Math.min(halfFrame, x[node]));
      y[node] = Math.max(-halfFrame, Math.min(halfFrame, y[node]));
    }
  }

  // Re-centre on the origin so the "fit" step has a predictable starting point.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let node = 0; node < count; node += 1) {
    minX = Math.min(minX, x[node]);
    maxX = Math.max(maxX, x[node]);
    minY = Math.min(minY, y[node]);
    maxY = Math.max(maxY, y[node]);
  }

  const offsetX = (minX + maxX) / 2;
  const offsetY = (minY + maxY) / 2;

  return {
    ...graph,
    nodes: graph.nodes.map((node, position) => ({
      ...node,
      x: Math.round((x[position] - offsetX) * 100) / 100,
      y: Math.round((y[position] - offsetY) * 100) / 100,
    })),
  };
};

/** A viewport that fits the whole graph inside the given surface. */
export const fitViewport = (
  graph: Graph,
  surface: { width: number; height: number },
  padding = 90
) => {
  if (graph.nodes.length === 0 || surface.width === 0 || surface.height === 0) {
    return { x: 0, y: 0, scale: 1 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const node of graph.nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }

  // Node boxes stick out past their centre point.
  const width = maxX - minX + 200;
  const height = maxY - minY + 80;

  const scale = Math.min(
    2.5,
    Math.max(
      0.25,
      Math.min(
        (surface.width - padding * 2) / width,
        (surface.height - padding * 2) / height
      )
    )
  );

  return {
    scale,
    x: surface.width / 2 - ((minX + maxX) / 2) * scale,
    y: surface.height / 2 - ((minY + maxY) / 2) * scale,
  };
};

/** Spacing of the dotted paper at 1:1, matching `--dot-gap` in the stylesheet. */
const DOT_GAP = 22;
/** Below this the dots read as noise rather than as a grid. */
const MIN_DOT_GAP = 13;

/**
 * The background grid as it should look at a given zoom.
 *
 * The dots cannot simply ride the world transform — they are painted on the
 * surface so they cover it entirely — so the tile is sized and offset to match
 * instead. Zooming out doubles the spacing rather than letting it collapse into
 * a wash, which keeps the dots on the same lattice while thinning them out.
 */
export const dotGrid = ({ x, y, scale }: { x: number; y: number; scale: number }) => {
  let gap = DOT_GAP * scale;
  while (gap < MIN_DOT_GAP) {
    gap *= 2;
  }

  return {
    gap,
    radius: Math.min(1.6, Math.max(0.6, scale)),
    // The lattice starts where the world origin sits on screen, so the dots
    // travel with the nodes rather than sliding underneath them.
    offsetX: x,
    offsetY: y,
  };
};

/** Half-extents of a node box, matching the sizes `GraphCanvas` renders at. */
const NODE_HALF_WIDTH = 84;
const NODE_HALF_HEIGHT = 23;

export type MinimapBox = { x: number; y: number; width: number; height: number };

/**
 * Geometry for the overview map: where each node sits inside the small frame,
 * and where the part of the world currently on screen falls within it.
 *
 * The bounds cover the nodes *and* the visible rectangle, so panning away into
 * empty space shrinks everything rather than letting the view indicator slide
 * out of the frame and leave you with no idea where you are.
 */
export const minimapLayout = (
  nodes: readonly { x: number; y: number }[],
  viewport: { x: number; y: number; scale: number },
  surface: { width: number; height: number },
  frame: { width: number; height: number },
  padding = 26
) => {
  // What the canvas is currently showing, in world coordinates.
  const view: MinimapBox = {
    x: -viewport.x / viewport.scale,
    y: -viewport.y / viewport.scale,
    width: surface.width / viewport.scale,
    height: surface.height / viewport.scale,
  };

  let minX = view.x;
  let maxX = view.x + view.width;
  let minY = view.y;
  let maxY = view.y + view.height;

  for (const node of nodes) {
    minX = Math.min(minX, node.x - NODE_HALF_WIDTH);
    maxX = Math.max(maxX, node.x + NODE_HALF_WIDTH);
    minY = Math.min(minY, node.y - NODE_HALF_HEIGHT);
    maxY = Math.max(maxY, node.y + NODE_HALF_HEIGHT);
  }

  const worldWidth = Math.max(1, maxX - minX);
  const worldHeight = Math.max(1, maxY - minY);
  const usableWidth = Math.max(1, frame.width - padding);
  const usableHeight = Math.max(1, frame.height - padding);

  const scale = Math.min(usableWidth / worldWidth, usableHeight / worldHeight);
  // Centre whatever is left over, so the map sits in the middle of its frame.
  const offsetX = (frame.width - worldWidth * scale) / 2 - minX * scale;
  const offsetY = (frame.height - worldHeight * scale) / 2 - minY * scale;

  const toFrame = (point: { x: number; y: number }) => ({
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
  });

  return {
    scale,
    toFrame,
    /** Frame coordinates back to world, for clicking somewhere on the map. */
    toWorld: (point: { x: number; y: number }) => ({
      x: (point.x - offsetX) / scale,
      y: (point.y - offsetY) / scale,
    }),
    nodes: nodes.map((node) => ({
      ...toFrame(node),
      width: Math.max(3, NODE_HALF_WIDTH * 2 * scale),
      height: Math.max(2, NODE_HALF_HEIGHT * 2 * scale),
    })),
    view: {
      ...toFrame(view),
      width: view.width * scale,
      height: view.height * scale,
    },
  };
};

/** A viewport that centres the given world point in the surface. */
export const centreOn = (
  world: { x: number; y: number },
  surface: { width: number; height: number },
  scale: number
) => ({
  scale,
  x: surface.width / 2 - world.x * scale,
  y: surface.height / 2 - world.y * scale,
});
