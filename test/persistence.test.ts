import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadCanvases,
  nextCanvasName,
  newCanvas,
  pruneCanvases,
  sanitizeGraph,
  sanitizeViewport,
  saveCanvases,
} from "../lib/canvas";
import {
  isLocal,
  LOCAL_CONNECTION_ID,
  loadActiveConnectionId,
  loadConnections,
  localConnection,
  reorder,
  saveConnections,
} from "../lib/connections";
import {
  addHistoryEntry,
  formatRelativeTime,
  loadHistory,
  pruneHistory,
  removeHistoryEntry,
  saveHistory,
  summarizeQuery,
} from "../lib/history";
import { loadDraft, saveDraft } from "../lib/drafts";
import { STORAGE_KEYS, clearStoredData } from "../lib/storage";
import { withStorage } from "./helpers";

let session: ReturnType<typeof withStorage>;

beforeEach(() => {
  session = withStorage();
});

afterEach(() => {
  session.restore();
});

describe("connections", () => {
  it("always yields the built-in store, even from nothing", () => {
    const connections = loadConnections();
    assert.equal(connections.length, 1);
    assert.equal(isLocal(connections[0]), true);
  });

  it("re-seeds the built-in store if it went missing", () => {
    session.storage.setItem(
      STORAGE_KEYS.connections,
      JSON.stringify([
        { id: "r1", kind: "remote", name: "R", endpoint: "http://a/sparql" },
      ])
    );

    const connections = loadConnections();
    assert.equal(connections.length, 2);
    assert.ok(connections.some(isLocal));
  });

  it("drops remote entries with no endpoint and defaults the method", () => {
    session.storage.setItem(
      STORAGE_KEYS.connections,
      JSON.stringify([
        localConnection(),
        { id: "bad", kind: "remote", name: "no endpoint" },
        { id: "r", kind: "remote", name: "R", endpoint: "http://a", method: "nonsense" },
      ])
    );

    const connections = loadConnections();
    assert.equal(connections.length, 2);
    const remote = connections.find((c) => !isLocal(c));
    assert.equal(remote && !isLocal(remote) ? remote.method : undefined, "post-form");
  });

  it("survives corrupted storage", () => {
    session.storage.setItem(STORAGE_KEYS.connections, "{ not json");
    assert.equal(loadConnections().length, 1);

    session.storage.setItem(STORAGE_KEYS.connections, JSON.stringify({ not: "an array" }));
    assert.equal(loadConnections().length, 1);
  });

  it("falls back to the built-in store when the active id is unknown", () => {
    const connections = loadConnections();
    session.storage.setItem(STORAGE_KEYS.activeConnection, JSON.stringify("gone"));
    assert.equal(loadActiveConnectionId(connections), LOCAL_CONNECTION_ID);
  });

  it("round-trips through storage", () => {
    const connections = [
      localConnection(),
      {
        id: "r1",
        kind: "remote" as const,
        name: "R",
        endpoint: "http://a/sparql",
        method: "get" as const,
        headers: [{ name: "X", value: "1" }],
        auth: { type: "basic" as const, username: "u", password: "p" },
      },
    ];

    saveConnections(connections);
    assert.deepEqual(loadConnections(), connections);
  });

  it("reorders without running off either end", () => {
    const items = ["a", "b", "c"];
    assert.deepEqual(reorder(items, 0, 1), ["b", "a", "c"]);
    assert.deepEqual(reorder(items, 2, -1), ["a", "c", "b"]);
    assert.equal(reorder(items, 0, -1), items);
    assert.equal(reorder(items, 2, 1), items);
  });
});

describe("query history", () => {
  it("promotes a repeated query instead of duplicating it", () => {
    let history = addHistoryEntry({}, "c1", { query: "A", at: 1, status: "ok", rows: 1, duration: 1 });
    history = addHistoryEntry(history, "c1", { query: "B", at: 2, status: "ok", rows: 2, duration: 1 });
    history = addHistoryEntry(history, "c1", { query: "A", at: 3, status: "ok", rows: 9, duration: 1 });

    assert.deepEqual(history.c1.map((entry) => entry.query), ["A", "B"]);
    assert.equal(history.c1[0].rows, 9);
  });

  it("keeps connections apart and caps the list", () => {
    let history = {};
    for (let index = 0; index < 60; index += 1) {
      history = addHistoryEntry(history, "c1", {
        query: `Q${index}`,
        at: index,
        status: "ok",
        rows: 0,
        duration: 0,
      });
    }
    history = addHistoryEntry(history, "c2", { query: "other", at: 0, status: "ok", rows: 0, duration: 0 });

    assert.equal((history as Record<string, unknown[]>).c1.length, 50);
    assert.equal((history as Record<string, unknown[]>).c2.length, 1);
  });

  it("removes one entry and prunes dead connections", () => {
    const history = addHistoryEntry({}, "c1", { query: "A", at: 1, status: "ok", rows: 1, duration: 1 });
    const id = history.c1[0].id;

    assert.equal(removeHistoryEntry(history, "c1", id).c1.length, 0);
    assert.deepEqual(Object.keys(pruneHistory(history, ["c2"])), []);
  });

  it("round-trips and drops junk entries", () => {
    saveHistory({ c1: [{ id: "x", query: "SELECT 1", at: 5, status: "ok", rows: 1, duration: 2 }] });
    assert.equal(loadHistory().c1.length, 1);

    session.storage.setItem(STORAGE_KEYS.history, JSON.stringify({ c1: [{ query: "  " }, 42, null] }));
    assert.deepEqual(loadHistory().c1, []);
  });

  it("summarises a query by its first meaningful line", () => {
    assert.equal(summarizeQuery("# a comment\n\nSELECT * WHERE {\n?s ?p ?o}"), "SELECT * WHERE");
    assert.equal(summarizeQuery("ASK {}"), "ASK {}");
    assert.equal(summarizeQuery("   "), "(empty query)");
  });

  it("describes relative times", () => {
    const now = 1_000_000;
    assert.equal(formatRelativeTime(now, now), "just now");
    assert.match(formatRelativeTime(now - 90_000, now), /minute/);
    assert.match(formatRelativeTime(now - 7_200_000, now), /hour/);
    // A clock skewed into the future must not read as a negative age.
    assert.equal(formatRelativeTime(now + 10_000, now), "just now");
  });
});

describe("canvases", () => {
  it("seeds a first canvas for a connection with none", () => {
    const { canvases, activeId } = loadCanvases("c1");
    assert.equal(canvases.length, 1);
    assert.equal(activeId, canvases[0].id);
  });

  it("migrates the pre-tabs single-canvas shape", () => {
    session.storage.setItem(
      STORAGE_KEYS.canvas,
      JSON.stringify({
        c1: {
          graph: {
            nodes: [{ term: { type: "uri", value: "http://a/1" }, x: 1, y: 2, kind: "class" }],
            edges: [],
          },
          viewport: { x: 3, y: 4, scale: 1.5 },
        },
      })
    );

    const { canvases } = loadCanvases("c1");
    assert.equal(canvases.length, 1);
    assert.equal(canvases[0].name, "Canvas 1");
    assert.equal(canvases[0].graph.nodes.length, 1);
    assert.equal(canvases[0].viewport.scale, 1.5);
  });

  it("keeps canvases per connection and forgets an emptied one", () => {
    const doc = { ...newCanvas("Mine"), graph: { nodes: [{ id: "n", kind: "class" as const, term: { type: "uri" as const, value: "http://a" }, x: 0, y: 0 }], edges: [] } };
    saveCanvases("c1", [doc], doc.id);
    assert.equal(loadCanvases("c1").canvases[0].name, "Mine");
    assert.equal(loadCanvases("c2").canvases[0].name, "Canvas 1");

    saveCanvases("c1", [newCanvas("Canvas 1")], undefined);
    assert.equal(session.storage.getItem(STORAGE_KEYS.canvas), "{}");
  });

  it("prunes canvases whose connection is gone", () => {
    const doc = { ...newCanvas("A"), graph: { nodes: [{ id: "n", kind: "class" as const, term: { type: "uri" as const, value: "http://a" }, x: 0, y: 0 }], edges: [] } };
    saveCanvases("c1", [doc], doc.id);
    pruneCanvases(["c2"]);
    assert.equal(session.storage.getItem(STORAGE_KEYS.canvas), "{}");
  });

  it("names a new canvas without colliding", () => {
    const existing = [newCanvas("Canvas 1"), newCanvas("Canvas 2")];
    assert.equal(nextCanvasName(existing), "Canvas 3");
    assert.equal(nextCanvasName([newCanvas("Canvas 3")]), "Canvas 2");
  });
});

describe("canvas sanitising", () => {
  it("refuses unsafe IRIs, self edges and dangling edges", () => {
    const graph = sanitizeGraph({
      nodes: [
        { term: { type: "uri", value: "http://ok/a" }, x: 1, y: 2 },
        { term: { type: "uri", value: "http://bad/ a>b" }, x: 1, y: 2 },
        { nonsense: true },
        { term: { type: "uri", value: "http://ok/a" }, x: 9, y: 9 },
      ],
      edges: [
        { from: "uri:http://ok/a", to: "uri:http://ok/a", predicate: "http://p" },
        { from: "uri:http://ok/a", to: "uri:http://gone", predicate: "http://p" },
        { from: "uri:http://ok/a", to: "uri:http://ok/a", predicate: "http://bad p" },
      ],
    });

    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.edges.length, 0);
  });

  it("recomputes node ids from their term", () => {
    const graph = sanitizeGraph({
      nodes: [{ id: "a-lie", term: { type: "uri", value: "http://ok/a" }, x: 0, y: 0 }],
      edges: [],
    });

    assert.equal(graph.nodes[0].id, "uri:http://ok/a");
  });

  it("clamps the viewport and rejects non-numbers", () => {
    assert.equal(sanitizeViewport({ scale: 99 }).scale, 2.5);
    assert.equal(sanitizeViewport({ scale: 0.001 }).scale, 0.25);
    assert.deepEqual(sanitizeViewport({ x: "nope", y: NaN, scale: null }), { x: 0, y: 0, scale: 1 });
    assert.deepEqual(sanitizeViewport(null), { x: 0, y: 0, scale: 1 });
  });

  it("returns an empty graph for rubbish", () => {
    assert.deepEqual(sanitizeGraph("nope"), { nodes: [], edges: [] });
    assert.deepEqual(sanitizeGraph(null), { nodes: [], edges: [] });
  });
});

describe("query draft", () => {
  it("round-trips", () => {
    assert.equal(loadDraft(), undefined);
    saveDraft("SELECT * WHERE { ?s ?p ?o }");
    assert.equal(loadDraft(), "SELECT * WHERE { ?s ?p ?o }");
  });

  it("ignores a non-string and caps absurd input", () => {
    session.storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ not: "a string" }));
    assert.equal(loadDraft(), undefined);

    saveDraft("x".repeat(200_000));
    assert.equal(loadDraft()?.length, 100_000);
  });
});

describe("clearStoredData", () => {
  it("removes every key the app owns", () => {
    saveDraft("q");
    saveHistory({ c1: [] });
    saveConnections([localConnection()]);

    clearStoredData();

    for (const key of Object.values(STORAGE_KEYS)) {
      assert.equal(session.storage.getItem(key), null, key);
    }
  });
});
