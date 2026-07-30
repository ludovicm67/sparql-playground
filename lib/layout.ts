import { Graph } from "./graph";

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

  graph.nodes.forEach((node, position) => {
    // Deterministic de-overlap: spread coincident nodes around a small circle.
    const angle = (position / count) * Math.PI * 2;
    x[position] = node.x + Math.cos(angle) * 0.5;
    y[position] = node.y + Math.sin(angle) * 0.5;
  });

  const edges = graph.edges.flatMap((edge) => {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    return from === undefined || to === undefined ? [] : [[from, to] as const];
  });

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
