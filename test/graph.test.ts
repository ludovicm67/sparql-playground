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
import { fitViewport, forceLayout } from "../lib/layout";

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

  it("ignores duplicates, self-links and dangling ends", () => {
    const result = addEdges(graph, [
      { from: a, to: b, predicate: "http://p" },
      { from: a, to: b, predicate: "http://p" },
      { from: a, to: a, predicate: "http://p" },
      { from: a, to: "missing", predicate: "http://p" },
      { from: "missing", to: b, predicate: "http://p" },
    ]);

    assert.equal(result.edges.length, 1);
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
