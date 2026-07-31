import { createServer } from "node:http";

const PORT = Number(process.argv[2] || 4567);

const SELECT_RESULT = {
  head: { vars: ["s", "p", "o"] },
  results: {
    bindings: [
      {
        s: { type: "uri", value: "http://example.org/alice" },
        p: { type: "uri", value: "http://xmlns.com/foaf/0.1/name" },
        o: { type: "literal", value: "Alice" },
      },
      {
        s: { type: "uri", value: "http://example.org/bob" },
        p: { type: "uri", value: "http://xmlns.com/foaf/0.1/age" },
        o: {
          type: "literal",
          value: "42",
          datatype: "http://www.w3.org/2001/XMLSchema#integer",
        },
      },
      {
        s: { type: "bnode", value: "b0" },
        p: { type: "uri", value: "http://xmlns.com/foaf/0.1/name" },
        o: { type: "literal", value: "Céline", "xml:lang": "fr" },
      },
    ],
  },
};

const CONSTRUCT_RESULT = `<http://example.org/alice> <http://xmlns.com/foaf/0.1/name> "Alice" .
<http://example.org/bob> <http://xmlns.com/foaf/0.1/name> "Bob" .
`;

const log = [];

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

const cors = (res, req) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ||
      "content-type, authorization, accept, x-api-key"
  );
  res.setHeader("Access-Control-Max-Age", "600");
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  cors(res, req);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  // Inspection endpoint for the test driver
  if (url.pathname === "/__log") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(log));
    return;
  }
  if (url.pathname === "/__reset") {
    log.length = 0;
    res.writeHead(204).end();
    return;
  }

  const body = req.method === "POST" ? await readBody(req) : "";
  let query = url.searchParams.get("query") ?? "";
  if (req.method === "POST") {
    query = (req.headers["content-type"] || "").includes("sparql-query")
      ? body
      : (new URLSearchParams(body).get("query") ?? "");
  }

  log.push({
    path: url.pathname,
    method: req.method,
    contentType: req.headers["content-type"] ?? null,
    accept: req.headers.accept ?? null,
    authorization: req.headers.authorization ?? null,
    apiKey: req.headers["x-api-key"] ?? null,
    query,
  });

  if (url.pathname === "/secure") {
    const expected = "Basic " + Buffer.from("neo:trinity").toString("base64");
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("Unauthorized: bad credentials");
      return;
    }
  }

  if (url.pathname === "/broken") {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal boom: the triple store fell over");
    return;
  }

  if (url.pathname === "/notjson") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("<<< not json at all >>>");
    return;
  }

  // Strip comments and the prologue so the query form can be detected, the way
  // a real parser would. "#" inside an IRI or a string is NOT a comment.
  const withoutComments = query.replace(
    /<[^>\n]*>|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|#[^\n]*/g,
    (match) => (match.startsWith("#") ? "" : match)
  );

  // A tiny triangle: every node links to both others, plus labels and a
  // self-link. Exercises link discovery, naming and multi-edge rendering.
  if (url.pathname === "/triangle") {
    const json = (body) => {
      res.writeHead(200, { "content-type": "application/sparql-results+json" });
      res.end(JSON.stringify(body));
    };
    const NODES = ["a", "b", "c"];
    const NAMES = { a: "Alpha", b: "Beta" };
    const iri = (name) => `http://ex.org/${name}`;

    if (/\?class/.test(query)) {
      return json({
        head: { vars: ["class", "count"] },
        results: {
          bindings: [
            { class: { type: "uri", value: "http://ex.org/Thing" }, count: { type: "literal", value: "3" } },
          ],
        },
      });
    }
    if (/\?instance/.test(query)) {
      return json({
        head: { vars: ["instance"] },
        results: {
          bindings: NODES.map((name) => ({ instance: { type: "uri", value: iri(name) } })),
        },
      });
    }
    if (/\?subject.*\?label|\?label.*\?subject/s.test(query)) {
      const asked = [...query.matchAll(/<http:\/\/ex\.org\/([a-z]+)>/g)].map((m) => m[1]);
      const RDFS = "http://www.w3.org/2000/01/rdf-schema#label";
      const SCHEMA = "http://schema.org/name";
      const FOAF = "http://xmlns.com/foaf/0.1/name";
      const bindings = [];

      for (const name of new Set(asked)) {
        if (!NAMES[name]) continue;
        // "a" carries all three, in the wrong order, to prove the ranking.
        // "b" has only schema:name. "c" has none, so it keeps its local name.
        if (name === "a") {
          bindings.push(
            { subject: { type: "uri", value: iri(name) }, predicate: { type: "uri", value: FOAF }, label: { type: "literal", value: "WRONG (foaf)" } },
            { subject: { type: "uri", value: iri(name) }, predicate: { type: "uri", value: SCHEMA }, label: { type: "literal", value: "WRONG (schema)" } },
            { subject: { type: "uri", value: iri(name) }, predicate: { type: "uri", value: RDFS }, label: { type: "literal", value: NAMES[name] } }
          );
        } else if (name === "b") {
          bindings.push({
            subject: { type: "uri", value: iri(name) },
            predicate: { type: "uri", value: SCHEMA },
            label: { type: "literal", value: NAMES[name] },
          });
        }
      }

      return json({ head: { vars: ["subject", "predicate", "label"] }, results: { bindings } });
    }
    if (/\?from.*\?to/s.test(query)) {
      // Every ordered pair that both sides of the query mention, plus a loop.
      const mentioned = new Set(
        [...query.matchAll(/<http:\/\/ex\.org\/([a-z]+)>/g)].map((m) => m[1])
      );
      const bindings = [];
      for (const from of mentioned) {
        for (const to of mentioned) {
          if (!NODES.includes(from) || !NODES.includes(to)) continue;
          bindings.push({
            from: { type: "uri", value: iri(from) },
            predicate: { type: "uri", value: from === to ? "http://ex.org/self" : "http://ex.org/links" },
            to: { type: "uri", value: iri(to) },
          });
          if (from !== to) {
            bindings.push({
              from: { type: "uri", value: iri(from) },
              predicate: { type: "uri", value: "http://ex.org/alsoLinks" },
              to: { type: "uri", value: iri(to) },
            });
          }
        }
      }
      return json({ head: { vars: ["from", "predicate", "to"] }, results: { bindings } });
    }
    if (/\?predicate/.test(query)) {
      return json({
        head: { vars: ["predicate", "count"] },
        results: {
          bindings: [
            { predicate: { type: "uri", value: "http://ex.org/links" }, count: { type: "literal", value: "2" } },
          ],
        },
      });
    }
    if (/\?object/.test(query)) {
      const subject = /<http:\/\/ex\.org\/([a-z]+)>/.exec(query)?.[1];
      return json({
        head: { vars: ["object"] },
        results: {
          bindings: NODES.filter((name) => name !== subject).map((name) => ({
            object: { type: "uri", value: iri(name) },
          })),
        },
      });
    }
    return json({ head: { vars: [] }, results: { bindings: [] } });
  }

  // A synthetic, paginating dataset so LIMIT/OFFSET behaviour can be tested.
  if (url.pathname === "/big") {
    const limit = Number(/LIMIT\s+(\d+)/i.exec(query)?.[1] ?? 50);
    const offset = Number(/OFFSET\s+(\d+)/i.exec(query)?.[1] ?? 0);
    const TOTAL = 137;
    const json = (body) => {
      res.writeHead(200, { "content-type": "application/sparql-results+json" });
      res.end(JSON.stringify(body));
    };

    if (/\?class/.test(query)) {
      return json({
        head: { vars: ["class", "count"] },
        results: {
          bindings: [
            { class: { type: "uri", value: "http://ex.org/Widget" }, count: { type: "literal", value: String(TOTAL) } },
            { class: { type: "uri", value: "http://ex.org/Gadget" }, count: { type: "literal", value: "12" } },
          ],
        },
      });
    }
    if (/\?instance/.test(query)) {
      const rows = [];
      for (let i = offset; i < Math.min(offset + limit, TOTAL); i += 1) {
        rows.push({ instance: { type: "uri", value: `http://ex.org/widget/${i}` } });
      }
      return json({ head: { vars: ["instance"] }, results: { bindings: rows } });
    }
    if (/\?predicate/.test(query)) {
      return json({
        head: { vars: ["predicate", "count"] },
        results: {
          bindings: [
            { predicate: { type: "uri", value: "http://ex.org/relatesTo" }, count: { type: "literal", value: "90" } },
          ],
        },
      });
    }
    if (/\?object/.test(query)) {
      const rows = [];
      for (let i = offset; i < Math.min(offset + limit, 90); i += 1) {
        rows.push({ object: { type: "uri", value: `http://ex.org/widget/${i}` } });
      }
      return json({ head: { vars: ["object"] }, results: { bindings: rows } });
    }
    // labels / links: nothing
    return json({ head: { vars: [] }, results: { bindings: [] } });
  }

  const normalized = withoutComments
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/^(?:(?:PREFIX\s+\S*\s*|BASE\s+)<[^>]*>\s*)+/i, "")
    .trim()
    .toUpperCase();

  if (normalized.startsWith("ASK")) {
    res.writeHead(200, { "content-type": "application/sparql-results+json" });
    res.end(JSON.stringify({ head: {}, boolean: true }));
    return;
  }

  if (normalized.startsWith("CONSTRUCT") || normalized.startsWith("DESCRIBE")) {
    res.writeHead(200, { "content-type": "application/n-triples" });
    res.end(CONSTRUCT_RESULT);
    return;
  }

  if (!normalized.startsWith("SELECT")) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end(`Malformed query: ${query.slice(0, 80)}`);
    return;
  }

  res.writeHead(200, { "content-type": "application/sparql-results+json" });
  res.end(JSON.stringify(SELECT_RESULT));
});

server.listen(PORT, () => console.log(`mock SPARQL endpoint on :${PORT}`));
