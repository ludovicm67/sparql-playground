import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addEdges,
  addNode,
  edgeId,
  emptyGraph,
  findNode,
  freePosition,
  type Graph,
  moveNode,
  nodeId,
  removeNode,
} from "../lib/graph";
import { fitViewport, forceLayout, dotGrid, minimapLayout, centreOn } from "../lib/layout";

const node = (value: string, x = 0, y = 0) => ({
  kind: "instance" as const,
  term: { type: "uri" as const, value },
  x,
  y,
});

const withNodes = (...values: string[]) => {
  let graph = emptyGraph();
  values.forEach((value, index) => {
    graph = addNode(graph, node(value, index * 300, 0)).graph;
  });
  return graph;
};

describe("addNode", () => {
  it("derives the id from the term so the same term is one node", () => {
    const first = addNode(emptyGraph(), node("http://a/1"));
    const second = addNode(first.graph, node("http://a/1", 500, 500));

    assert.equal(first.added, true);
    assert.equal(second.added, false);
    assert.equal(second.id, first.id);
    assert.equal(second.graph.nodes.length, 1);
    // The original position wins: re-adding must not teleport an existing node.
    assert.equal(second.graph.nodes[0].x, 0);
  });

  it("treats a literal and an IRI of the same text as different nodes", () => {
    let graph = addNode(emptyGraph(), node("Sheldon")).graph;
    graph = addNode(graph, {
      kind: "literal",
      term: { type: "literal", value: "Sheldon" },
      x: 0,
      y: 0,
    }).graph;

    assert.equal(graph.nodes.length, 2);
  });
});

describe("removeNode", () => {
  it("takes every edge touching it", () => {
    let graph = withNodes("http://a/1", "http://a/2", "http://a/3");
    graph = addEdges(graph, [
      { from: nodeId({ type: "uri", value: "http://a/1" }), to: nodeId({ type: "uri", value: "http://a/2" }), predicate: "http://p" },
      { from: nodeId({ type: "uri", value: "http://a/2" }), to: nodeId({ type: "uri", value: "http://a/3" }), predicate: "http://p" },
    ]);
    assert.equal(graph.edges.length, 2);

    const pruned = removeNode(graph, nodeId({ type: "uri", value: "http://a/2" }));
    assert.equal(pruned.nodes.length, 2);
    assert.equal(pruned.edges.length, 0);
  });
});

describe("addEdges", () => {
  const a = nodeId({ type: "uri", value: "http://a/1" });
  const b = nodeId({ type: "uri", value: "http://a/2" });
  const graph = withNodes("http://a/1", "http://a/2");

  it("ignores duplicates and dangling ends", () => {
    const result = addEdges(graph, [
      { from: a, to: b, predicate: "http://p" },
      { from: a, to: b, predicate: "http://p" },
      { from: a, to: "missing", predicate: "http://p" },
      { from: "missing", to: b, predicate: "http://p" },
    ]);

    assert.equal(result.edges.length, 1);
  });

  it("keeps a self-link, which is a real statement", () => {
    const result = addEdges(graph, [
      { from: a, to: a, predicate: "http://knows" },
      { from: a, to: a, predicate: "http://knows" },
      { from: a, to: a, predicate: "http://sameAs" },
    ]);

    assert.equal(result.edges.length, 2);
    assert.deepEqual(
      result.edges.map((edge) => edge.predicate).sort(),
      ["http://knows", "http://sameAs"]
    );
  });

  it("takes self-links with the node when it is removed", () => {
    const withLoop = addEdges(graph, [{ from: a, to: a, predicate: "http://p" }]);
    assert.equal(removeNode(withLoop, a).edges.length, 0);
  });

  it("keeps both directions and distinct predicates apart", () => {
    const result = addEdges(graph, [
      { from: a, to: b, predicate: "http://parent" },
      { from: b, to: a, predicate: "http://children" },
      { from: a, to: b, predicate: "http://other" },
    ]);

    assert.equal(result.edges.length, 3);
    assert.equal(new Set(result.edges.map((edge) => edge.id)).size, 3);
  });

  it("returns the same object when there is nothing to add", () => {
    const once = addEdges(graph, [{ from: a, to: b, predicate: "http://p" }]);
    const twice = addEdges(once, [{ from: a, to: b, predicate: "http://p" }]);

    assert.equal(twice, once);
  });

  it("builds a stable edge id", () => {
    assert.equal(edgeId("x", "p", "y"), edgeId("x", "p", "y"));
    assert.notEqual(edgeId("x", "p", "y"), edgeId("y", "p", "x"));
  });
});

describe("moveNode", () => {
  it("moves only the target", () => {
    const graph = withNodes("http://a/1", "http://a/2");
    const moved = moveNode(graph, nodeId({ type: "uri", value: "http://a/1" }), 42, 43);

    assert.deepEqual(
      [findNode(moved, nodeId({ type: "uri", value: "http://a/1" }))?.x, findNode(moved, nodeId({ type: "uri", value: "http://a/1" }))?.y],
      [42, 43]
    );
    assert.equal(findNode(moved, nodeId({ type: "uri", value: "http://a/2" }))?.x, 300);
  });
});

describe("freePosition", () => {
  it("returns the preferred spot when it is free", () => {
    assert.deepEqual(freePosition(emptyGraph(), { x: 10, y: 20 }), { x: 10, y: 20 });
  });

  it("steps aside when the spot is taken", () => {
    const graph = addNode(emptyGraph(), node("http://a/1", 100, 100)).graph;
    const spot = freePosition(graph, { x: 100, y: 100 });

    assert.notDeepEqual(spot, { x: 100, y: 100 });
    assert.ok(Number.isFinite(spot.x) && Number.isFinite(spot.y));
  });

  it("keeps a run of additions from stacking up", () => {
    let graph = emptyGraph();
    for (let index = 0; index < 25; index += 1) {
      const spot = freePosition(graph, { x: 0, y: 0 });
      graph = addNode(graph, {
        ...node(`http://a/${index}`),
        x: spot.x,
        y: spot.y,
      }).graph;
    }

    const exact = new Set(graph.nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`));
    assert.equal(exact.size, 25);
  });
});

describe("forceLayout", () => {
  const connected = () => {
    let graph = withNodes(...Array.from({ length: 12 }, (_, i) => `http://a/${i}`));
    const ids = graph.nodes.map((n) => n.id);
    graph = addEdges(
      graph,
      ids.slice(1).map((id) => ({ from: ids[0], to: id, predicate: "http://p" }))
    );
    return graph;
  };

  it("leaves a graph of fewer than two nodes alone", () => {
    const one = withNodes("http://a/1");
    assert.equal(forceLayout(one), one);
  });

  it("produces finite coordinates", () => {
    for (const node of forceLayout(connected()).nodes) {
      assert.ok(Number.isFinite(node.x), `x is ${node.x}`);
      assert.ok(Number.isFinite(node.y), `y is ${node.y}`);
    }
  });

  it("bounds nodes that have no edges at all", () => {
    // Repulsion with nothing pulling back used to fling these to infinity.
    const scattered = withNodes(...Array.from({ length: 8 }, (_, i) => `http://a/${i}`));
    const laid = forceLayout(scattered);

    const extent = Math.max(
      ...laid.nodes.map((node) => Math.max(Math.abs(node.x), Math.abs(node.y)))
    );

    assert.ok(extent < 4000, `nodes spread to ${extent}`);
  });

  it("separates nodes rather than piling them on one spot", () => {
    const stacked: Graph = {
      nodes: Array.from({ length: 6 }, (_, index) => ({
        id: `n${index}`,
        kind: "instance" as const,
        term: { type: "uri" as const, value: `http://a/${index}` },
        x: 0,
        y: 0,
      })),
      edges: [],
    };

    const laid = forceLayout(stacked);
    let closest = Infinity;
    for (let a = 0; a < laid.nodes.length; a += 1) {
      for (let b = a + 1; b < laid.nodes.length; b += 1) {
        closest = Math.min(
          closest,
          Math.hypot(laid.nodes[a].x - laid.nodes[b].x, laid.nodes[a].y - laid.nodes[b].y)
        );
      }
    }

    assert.ok(closest > 40, `closest pair is ${closest} apart`);
  });

  it("is deterministic and settles instead of reshuffling", () => {
    const once = forceLayout(connected());
    const twice = forceLayout(connected());
    assert.deepEqual(once.nodes.map((n) => [n.x, n.y]), twice.nodes.map((n) => [n.x, n.y]));

    const again = forceLayout(once);
    const drift = Math.max(
      ...once.nodes.map((node, index) =>
        Math.hypot(node.x - again.nodes[index].x, node.y - again.nodes[index].y)
      )
    );
    assert.ok(drift < 200, `re-running moved a node by ${drift}`);
  });

  it("centres the result on the origin", () => {
    const laid = forceLayout(connected());
    const xs = laid.nodes.map((n) => n.x);
    const ys = laid.nodes.map((n) => n.y);

    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2) < 1);
    assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2) < 1);
  });
});

describe("fitViewport", () => {
  it("is neutral for an empty graph", () => {
    assert.deepEqual(fitViewport(emptyGraph(), { width: 800, height: 600 }), {
      x: 0,
      y: 0,
      scale: 1,
    });
  });

  it("stays inside the zoom limits", () => {
    const huge: Graph = {
      nodes: [
        { id: "a", kind: "instance", term: { type: "uri", value: "http://a" }, x: -100000, y: -100000 },
        { id: "b", kind: "instance", term: { type: "uri", value: "http://b" }, x: 100000, y: 100000 },
      ],
      edges: [],
    };

    assert.equal(fitViewport(huge, { width: 800, height: 600 }).scale, 0.25);
    assert.ok(fitViewport(withNodes("http://a/1", "http://a/2"), { width: 4000, height: 4000 }).scale <= 2.5);
  });

  it("centres the graph in the surface", () => {
    const graph = withNodes("http://a/1", "http://a/2");
    const view = fitViewport(graph, { width: 1000, height: 800 });
    const centreX = (graph.nodes[0].x + graph.nodes[1].x) / 2;

    assert.ok(Math.abs(centreX * view.scale + view.x - 500) < 1);
  });
});

describe("forceLayout with multi-edges", () => {
  /** Three nodes, every pair joined by several predicates, plus self-links. */
  const triangle = (predicatesPerPair: number) => {
    const graph = withNodes("http://a/1", "http://a/2", "http://a/3");
    const ids = graph.nodes.map((n) => n.id);
    const edges = [];

    for (const [from, to] of [
      [0, 1],
      [1, 2],
      [0, 2],
    ]) {
      for (let n = 0; n < predicatesPerPair; n += 1) {
        edges.push({ from: ids[from], to: ids[to], predicate: `http://p${n}` });
        edges.push({ from: ids[to], to: ids[from], predicate: `http://q${n}` });
      }
    }
    for (const id of ids) {
      edges.push({ from: id, to: id, predicate: "http://self" });
    }

    return addEdges(graph, edges);
  };

  const spread = (graph: ReturnType<typeof triangle>) => {
    const laid = forceLayout(graph);
    let closest = Infinity;
    for (let a = 0; a < laid.nodes.length; a += 1) {
      for (let b = a + 1; b < laid.nodes.length; b += 1) {
        closest = Math.min(
          closest,
          Math.hypot(laid.nodes[a].x - laid.nodes[b].x, laid.nodes[a].y - laid.nodes[b].y)
        );
      }
    }
    return closest;
  };

  it("does not squeeze nodes together as predicates pile up", () => {
    // Applying the spring once per statement made this shrink with each extra
    // predicate until the nodes sat on top of each other.
    const one = spread(triangle(1));
    const four = spread(triangle(4));

    assert.ok(one > 100, `a single predicate per pair gave ${one}`);
    assert.ok(four > 100, `four predicates per pair gave ${four}`);
    assert.ok(
      Math.abs(one - four) < one * 0.5,
      `spacing changed from ${one} to ${four} just by adding predicates`
    );
  });

  it("keeps a fully connected trio off a straight line", () => {
    const laid = forceLayout(triangle(4));
    const [a, b, c] = laid.nodes;

    // Twice the triangle's area; zero would mean the three are collinear.
    const area = Math.abs(
      (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
    );
    assert.ok(area > 10_000, `the three nodes are nearly collinear (area ${area})`);
  });

  it("lays out the same wherever the nodes happen to sit", () => {
    // The bounding frame is centred on the origin. Nodes dropped on a canvas
    // sit hundreds of pixels away from it, and clamping them to that frame used
    // to flatten the whole graph onto one line.
    const shifted = (dx: number, dy: number) => {
      const base = triangle(2);
      return forceLayout({
        ...base,
        nodes: base.nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy })),
      });
    };

    const sides = (graph: ReturnType<typeof shifted>) => {
      const [a, b, c] = graph.nodes;
      const d = (p: typeof a, q: typeof a) =>
        Math.round(Math.hypot(p.x - q.x, p.y - q.y));
      return [d(a, b), d(b, c), d(a, c)].sort((one, two) => one - two);
    };

    const atOrigin = sides(shifted(0, 0));
    assert.deepEqual(sides(shifted(900, 700)), atOrigin);
    assert.deepEqual(sides(shifted(-1500, 2500)), atOrigin);

    // And the result is a real triangle, not a degenerate line.
    assert.ok(atOrigin[0] > 150, `sides came out ${atOrigin.join(", ")}`);
  });

  it("ignores self-links, which pull in no direction", () => {
    let alone = withNodes("http://a/1", "http://a/2");
    alone = addEdges(alone, [
      { from: alone.nodes[0].id, to: alone.nodes[0].id, predicate: "http://self" },
    ]);

    for (const node of forceLayout(alone).nodes) {
      assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    }
  });
});

describe("dot grid", () => {
  it("moves with the viewport, so the paper travels with the nodes", () => {
    const grid = dotGrid({ x: -140, y: 80, scale: 1 });

    assert.equal(grid.offsetX, -140);
    assert.equal(grid.offsetY, 80);
  });

  it("scales the spacing with the zoom", () => {
    assert.equal(dotGrid({ x: 0, y: 0, scale: 1 }).gap, 22);
    assert.equal(dotGrid({ x: 0, y: 0, scale: 2 }).gap, 44);
    assert.equal(dotGrid({ x: 0, y: 0, scale: 2.5 }).gap, 55);
  });

  it("doubles the spacing rather than letting the dots become a wash", () => {
    // At the 0.25 floor a plain 22px tile would be 5.5px apart, which reads as
    // grey noise. Doubling keeps them on the same lattice, just thinned out.
    assert.equal(dotGrid({ x: 0, y: 0, scale: 0.25 }).gap, 22);
    assert.equal(dotGrid({ x: 0, y: 0, scale: 0.4 }).gap, 17.6);

    for (let scale = 0.25; scale <= 2.5; scale += 0.05) {
      const { gap } = dotGrid({ x: 0, y: 0, scale });
      assert.ok(gap >= 13, `gap stays legible at scale ${scale.toFixed(2)}`);

      // Every gap is the base spacing scaled, then doubled zero or more times.
      const factor = gap / (22 * scale);
      assert.ok(
        Math.abs(factor - 2 ** Math.round(Math.log2(factor))) < 1e-9,
        `gap stays on the lattice at scale ${scale.toFixed(2)}`
      );
    }
  });

  it("keeps the dots visible at both ends of the zoom range", () => {
    assert.ok(dotGrid({ x: 0, y: 0, scale: 0.25 }).radius >= 0.6);
    assert.ok(dotGrid({ x: 0, y: 0, scale: 2.5 }).radius <= 1.6);
  });
});

describe("minimap", () => {
  const surface = { width: 800, height: 600 };
  const frame = { width: 168, height: 118 };

  it("keeps the view indicator inside the frame when panned into empty space", () => {
    const nodes = [{ x: 0, y: 0 }];
    // Looking a long way from the only node.
    const layout = minimapLayout(nodes, { x: -4000, y: -3000, scale: 1 }, surface, frame);

    assert.ok(layout.view.x >= -1 && layout.view.y >= -1);
    assert.ok(layout.view.x + layout.view.width <= frame.width + 1);
    assert.ok(layout.view.y + layout.view.height <= frame.height + 1);
  });

  it("shrinks the view indicator as you zoom in", () => {
    const nodes = [{ x: 0, y: 0 }, { x: 900, y: 500 }];
    const out = minimapLayout(nodes, { x: 0, y: 0, scale: 0.5 }, surface, frame);
    const inn = minimapLayout(nodes, { x: 0, y: 0, scale: 2 }, surface, frame);

    // Zoomed in you can see less of the world, so the rectangle covers less.
    assert.ok(inn.view.width < out.view.width);
    assert.ok(inn.view.height < out.view.height);
  });

  it("round-trips a point between frame and world", () => {
    const layout = minimapLayout(
      [{ x: 100, y: 200 }],
      { x: 10, y: 20, scale: 1.5 },
      surface,
      frame
    );

    const world = layout.toWorld({ x: 40, y: 30 });
    const back = layout.toFrame(world);

    assert.ok(Math.abs(back.x - 40) < 1e-9);
    assert.ok(Math.abs(back.y - 30) < 1e-9);
  });

  it("gives every node something visible to see", () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({ x: i * 500, y: i * 300 }));
    const layout = minimapLayout(nodes, { x: 0, y: 0, scale: 1 }, surface, frame);

    assert.equal(layout.nodes.length, nodes.length);
    for (const node of layout.nodes) {
      assert.ok(node.width >= 3 && node.height >= 2, "no node collapses to nothing");
    }
  });

  it("centres the surface on the point asked for", () => {
    const viewport = centreOn({ x: 300, y: 150 }, surface, 2);

    // The world point should land in the middle of the surface.
    assert.equal(300 * viewport.scale + viewport.x, surface.width / 2);
    assert.equal(150 * viewport.scale + viewport.y, surface.height / 2);
    assert.equal(viewport.scale, 2, "zoom is preserved while jumping");
  });
});
