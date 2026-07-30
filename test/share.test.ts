import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyShare,
  buildSharePayload,
  buildShareUrl,
  hasSecrets,
  parseShareFragment,
  type SharePayload,
} from "../lib/share";
import {
  type Connection,
  LOCAL_CONNECTION_ID,
  localConnection,
  type RemoteConnection,
} from "../lib/connections";
import { DEFAULT_NAV, readNav, writeNav } from "../lib/navigation";
import { withStorage } from "./helpers";

const BASE = "https://play.example/";

const remote = (over: Partial<RemoteConnection> = {}): RemoteConnection => ({
  id: "r1",
  kind: "remote",
  name: "Endpoint",
  endpoint: "https://example.org/sparql",
  method: "post-form",
  headers: [],
  auth: { type: "none" },
  ...over,
});

const secured = () =>
  remote({
    headers: [{ name: "X-Api-Key", value: "s3cr3t" }],
    auth: { type: "basic", username: "neo", password: "trinity" },
  });

const roundTrip = (payload: SharePayload) =>
  parseShareFragment(new URL(buildShareUrl(payload, BASE)).hash);

let session: ReturnType<typeof withStorage>;
beforeEach(() => {
  session = withStorage();
});
afterEach(() => {
  session.restore();
});

describe("hasSecrets", () => {
  it("is true only when there is something to leak", () => {
    assert.equal(hasSecrets(localConnection()), false);
    assert.equal(hasSecrets(remote()), false);
    assert.equal(hasSecrets(remote({ headers: [{ name: "X", value: "1" }] })), true);
    assert.equal(
      hasSecrets(remote({ auth: { type: "basic", username: "u", password: "p" } })),
      true
    );
  });
});

describe("building a link", () => {
  it("puts everything in the fragment, never the path or query", () => {
    const url = new URL(
      buildShareUrl(buildSharePayload(remote(), "SELECT 1", false), BASE)
    );

    assert.equal(url.search, "");
    assert.match(url.hash, /^#s=/);
  });

  it("omits credentials by default and says it did", () => {
    const payload = buildSharePayload(secured(), "SELECT 1", false);
    assert.equal(payload.connection.kind, "remote");

    if (payload.connection.kind === "remote") {
      assert.equal(payload.connection.auth, undefined);
      assert.equal(payload.connection.headers, undefined);
      // Without this flag the recipient cannot tell "no credentials needed"
      // from "credentials were withheld".
      assert.equal(payload.connection.omitted, true);
    }

    const link = buildShareUrl(payload, BASE);
    const decoded = Buffer.from(link.split("#s=")[1], "base64url").toString("utf8");
    assert.equal(decoded.includes("trinity"), false);
    assert.equal(decoded.includes("s3cr3t"), false);
  });

  it("carries credentials when asked, and then sets no omitted flag", () => {
    const payload = buildSharePayload(secured(), "SELECT 1", true);

    if (payload.connection.kind === "remote") {
      assert.deepEqual(payload.connection.auth, { username: "neo", password: "trinity" });
      assert.equal(payload.connection.headers?.length, 1);
      assert.equal(payload.connection.omitted, undefined);
    }
  });

  it("never marks a connection with nothing to omit", () => {
    const payload = buildSharePayload(remote(), "SELECT 1", false);
    if (payload.connection.kind === "remote") {
      assert.equal(payload.connection.omitted, undefined);
    }
  });
});

describe("parsing a link", () => {
  it("round-trips a query, a canvas and a resource", () => {
    const payload: SharePayload = {
      v: 1,
      query: "SELECT * WHERE { ?s ?p ?o }",
      connection: { kind: "local" },
      canvas: {
        name: "My canvas",
        graph: {
          nodes: [
            { id: "uri:http://a/1", kind: "class", term: { type: "uri", value: "http://a/1" }, x: 5, y: 6 },
          ],
          edges: [],
        },
        viewport: { x: 1, y: 2, scale: 1.25 },
      },
      resource: "http://a/1",
    };

    const parsed = roundTrip(payload);
    assert.equal(parsed?.query, payload.query);
    assert.equal(parsed?.canvas?.name, "My canvas");
    assert.equal(parsed?.canvas?.graph.nodes[0].x, 5);
    assert.equal(parsed?.canvas?.viewport.scale, 1.25);
    assert.equal(parsed?.resource, "http://a/1");
  });

  it("survives non-ASCII", () => {
    const parsed = roundTrip({
      v: 1,
      query: 'SELECT * WHERE { ?s ?p "Céline 日本語 🎉" }',
      connection: { kind: "local" },
    });

    assert.match(parsed?.query ?? "", /Céline 日本語 🎉/);
  });

  it("returns nothing for junk, the wrong version or a foreign fragment", () => {
    assert.equal(parseShareFragment(""), undefined);
    assert.equal(parseShareFragment("#s=not-base64!!"), undefined);
    assert.equal(parseShareFragment("#other=1"), undefined);
    assert.equal(
      parseShareFragment(`#s=${Buffer.from(JSON.stringify({ v: 9, query: "x" })).toString("base64url")}`),
      undefined
    );
    assert.equal(
      parseShareFragment(`#s=${Buffer.from(JSON.stringify({ v: 1 })).toString("base64url")}`),
      undefined
    );
  });

  it("drops a resource IRI that is not safe to query with", () => {
    const parsed = parseShareFragment(
      `#s=${Buffer.from(
        JSON.stringify({ v: 1, query: "", connection: { kind: "local" }, resource: "http://a/ b>c" })
      ).toString("base64url")}`
    );

    assert.equal(parsed?.resource, undefined);
  });

  it("sanitises a canvas from an untrusted link", () => {
    const parsed = parseShareFragment(
      `#s=${Buffer.from(
        JSON.stringify({
          v: 1,
          query: "",
          connection: { kind: "local" },
          canvas: {
            name: "  ",
            graph: {
              nodes: [{ term: { type: "uri", value: "http://evil/ a>b" }, x: 0, y: 0 }],
              edges: [{ from: "a", to: "b", predicate: "http://p" }],
            },
            viewport: { scale: 500 },
          },
        })
      ).toString("base64url")}`
    );

    assert.equal(parsed?.canvas?.name, "Shared canvas");
    assert.equal(parsed?.canvas?.graph.nodes.length, 0);
    assert.equal(parsed?.canvas?.graph.edges.length, 0);
    assert.equal(parsed?.canvas?.viewport.scale, 2.5);
  });
});

describe("applyShare", () => {
  const existing: Connection[] = [localConnection(), remote()];

  it("selects the built-in store for a local payload", () => {
    const applied = applyShare(existing, {
      v: 1,
      query: "SELECT 1",
      connection: { kind: "local" },
    });

    assert.equal(applied.activeId, LOCAL_CONNECTION_ID);
    assert.equal(applied.connections, existing);
  });

  it("reuses a matching endpoint rather than adding a second one", () => {
    const applied = applyShare(existing, {
      v: 1,
      query: "SELECT 1",
      connection: {
        kind: "remote",
        name: "Their name for it",
        endpoint: "https://example.org/sparql",
        method: "get",
      },
    });

    assert.equal(applied.connections.length, 2);
    assert.equal(applied.activeId, "r1");
    assert.equal(applied.notice?.created, false);
  });

  it("matches endpoints that differ only cosmetically", () => {
    for (const endpoint of [
      "https://example.org/sparql/",
      "https://EXAMPLE.org/sparql",
      "HTTPS://example.org/sparql",
    ]) {
      const applied = applyShare(existing, {
        v: 1,
        query: "",
        connection: { kind: "remote", name: "x", endpoint, method: "get" },
      });

      assert.equal(applied.connections.length, 2, endpoint);
      assert.equal(applied.activeId, "r1", endpoint);
    }
  });

  it("adds an unknown endpoint and selects it", () => {
    const applied = applyShare(existing, {
      v: 1,
      query: "",
      connection: {
        kind: "remote",
        name: "New",
        endpoint: "https://other.example/sparql",
        method: "post-direct",
        headers: [{ name: "X", value: "1" }],
        auth: { username: "u", password: "p" },
      },
    });

    assert.equal(applied.connections.length, 3);
    const created = applied.connections[2];
    assert.equal(created.id, applied.activeId);
    assert.equal(created.kind === "remote" && created.auth.type, "basic");
    assert.equal(applied.notice?.created, true);
    assert.equal(applied.notice?.needsCredentials, false);
  });

  it("tells the recipient when credentials were withheld", () => {
    const applied = applyShare(existing, {
      v: 1,
      query: "",
      connection: {
        kind: "remote",
        name: "New",
        endpoint: "https://other.example/sparql",
        method: "post-form",
        omitted: true,
      },
    });

    assert.equal(applied.notice?.needsCredentials, true);
  });

  it("leaves the recipient's own credentials alone on a match", () => {
    const mine = [localConnection(), secured()];
    const applied = applyShare(mine, {
      v: 1,
      query: "",
      connection: {
        kind: "remote",
        name: "Theirs",
        endpoint: "https://example.org/sparql",
        method: "get",
        omitted: true,
      },
    });

    assert.equal(applied.connections, mine);
    const used = applied.connections.find((c) => c.id === applied.activeId);
    assert.equal(used?.kind === "remote" && used.auth.type, "basic");
  });
});

describe("navigation state", () => {
  it("writes nothing for the default", () => {
    assert.equal(writeNav(DEFAULT_NAV), "");
  });

  it("round-trips mode and resource", () => {
    for (const state of [
      { mode: "explore" as const, resource: "" },
      { mode: "resource" as const, resource: "urn:tbbt:penny" },
      { mode: "resource" as const, resource: "http://a/b?c=d#e" },
    ]) {
      assert.deepEqual(readNav(writeNav(state)), state);
    }
  });

  it("drops the resource outside resource mode", () => {
    assert.equal(writeNav({ mode: "explore", resource: "http://a" }), "?mode=explore");
  });

  it("ignores an unknown mode and an unusable IRI", () => {
    assert.deepEqual(readNav("?mode=nonsense&uri=not%20an%20iri"), DEFAULT_NAV);
    assert.deepEqual(readNav("?mode=resource&uri=http://a%3Eb"), {
      mode: "resource",
      resource: "",
    });
    assert.deepEqual(readNav(""), DEFAULT_NAV);
  });
});
