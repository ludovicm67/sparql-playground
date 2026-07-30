import type * as oxigraph from "oxigraph/web";
import { Connection, RemoteConnection } from "./connections";
import { handleResults, QueryResult } from "./results";

/**
 * The cheapest query that still proves an endpoint speaks SPARQL: an empty
 * group pattern matches exactly once and touches no data, so testing a
 * connection costs the remote server nothing.
 */
export const PROBE_QUERY = "ASK {}";

const ACCEPT =
  "application/sparql-results+json;q=1.0, application/n-triples;q=0.9, text/turtle;q=0.8, */*;q=0.1";

const REQUEST_TIMEOUT_MS = 60_000;

/** btoa() throws on non-Latin1 input, so encode to UTF-8 bytes first. */
const basicAuthToken = (username: string, password: string) => {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
};

const buildHeaders = (connection: RemoteConnection) => {
  const headers = new Headers({ Accept: ACCEPT });

  for (const header of connection.headers) {
    const name = header.name.trim();
    if (name) {
      headers.set(name, header.value);
    }
  }

  if (connection.auth.type === "basic") {
    headers.set(
      "Authorization",
      `Basic ${basicAuthToken(connection.auth.username, connection.auth.password)}`
    );
  }

  return headers;
};

const buildRequest = (connection: RemoteConnection, query: string) => {
  const headers = buildHeaders(connection);

  if (connection.method === "get") {
    const url = new URL(connection.endpoint);
    url.searchParams.set("query", query);
    return { url: url.toString(), init: { method: "GET", headers } };
  }

  if (connection.method === "post-direct") {
    headers.set("Content-Type", "application/sparql-query");
    return {
      url: connection.endpoint,
      init: { method: "POST", headers, body: query },
    };
  }

  headers.set("Content-Type", "application/x-www-form-urlencoded");
  return {
    url: connection.endpoint,
    init: {
      method: "POST",
      headers,
      body: new URLSearchParams({ query }).toString(),
    },
  };
};

/**
 * SPARQL results JSON already matches our `QueryResult` shape, but it arrives
 * from an untrusted server, so verify rather than cast.
 */
const parseResultsJson = (payload: unknown): QueryResult => {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("The endpoint returned JSON that is not a SPARQL result.");
  }

  const raw = payload as Record<string, unknown>;

  if (typeof raw.boolean === "boolean") {
    return { head: {}, boolean: raw.boolean };
  }

  const head = (raw.head ?? {}) as Record<string, unknown>;
  const results = (raw.results ?? {}) as Record<string, unknown>;

  if (!Array.isArray(results.bindings)) {
    throw new Error(
      "The endpoint returned JSON without a `results.bindings` array."
    );
  }

  return {
    head: {
      vars: Array.isArray(head.vars)
        ? head.vars.filter((entry): entry is string => typeof entry === "string")
        : [],
    },
    results: { bindings: results.bindings },
  };
};

/**
 * Browsers deliberately hide *why* a cross-origin request failed, so map the
 * opaque "Failed to fetch" onto the handful of causes that actually produce it.
 */
const describeNetworkFailure = (endpoint: string) => {
  const reasons = [
    "the endpoint does not send CORS headers (it must return Access-Control-Allow-Origin for this site)",
  ];

  if (typeof window !== "undefined") {
    const pageIsSecure = window.location.protocol === "https:";
    if (pageIsSecure && endpoint.startsWith("http://")) {
      reasons.unshift(
        "this page is served over HTTPS and the endpoint uses plain HTTP, so the browser blocks the request as mixed content"
      );
    }
  }

  reasons.push("the host is unreachable, or the request was blocked");

  return `Could not reach the endpoint. The browser gives no detail, but this usually means ${reasons.join(
    "; or "
  )}.`;
};

export const runRemoteQuery = async (
  connection: RemoteConnection,
  query: string,
  signal?: AbortSignal
): Promise<QueryResult> => {
  const { url, init } = buildRequest(connection, query);

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const signals = [timeout.signal, signal].filter(
    (candidate): candidate is AbortSignal => Boolean(candidate)
  );

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.any(signals) });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    if (timeout.signal.aborted) {
      throw new Error(
        `The endpoint did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
      );
    }
    throw new Error(describeNetworkFailure(connection.endpoint));
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  if (!response.ok) {
    const detail = body.trim().slice(0, 500);
    throw new Error(
      `The endpoint answered ${response.status} ${response.statusText}.${
        detail ? `\n\n${detail}` : ""
      }`
    );
  }

  if (contentType.includes("json")) {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error("The endpoint announced JSON but sent something else.");
    }
    return parseResultsJson(payload);
  }

  // Turtle, N-Triples, RDF/XML… anything graph-shaped is shown as text.
  return body;
};

export const runQuery = async (
  connection: Connection,
  query: string,
  store: oxigraph.Store | undefined,
  signal?: AbortSignal
): Promise<QueryResult> => {
  if (connection.kind === "local") {
    if (!store) {
      throw new Error("The in-browser store is not ready yet.");
    }
    return handleResults(store.query(query));
  }

  return runRemoteQuery(connection, query, signal);
};

export type ProbeResult = {
  ok: boolean;
  message: string;
  duration: number;
};

/** Run {@link PROBE_QUERY} against a connection to check it answers. */
export const probeConnection = async (
  connection: Connection,
  store: oxigraph.Store | undefined
): Promise<ProbeResult> => {
  const startedAt = performance.now();

  try {
    const result = await runQuery(connection, PROBE_QUERY, store);
    const duration = performance.now() - startedAt;

    const answered =
      typeof result !== "string" &&
      Object.hasOwnProperty.call(result, "boolean");

    return {
      ok: true,
      duration,
      message: answered
        ? "The endpoint answered the probe query correctly."
        : "The endpoint answered, but not with a boolean. It should still work for regular queries.",
    };
  } catch (error) {
    return {
      ok: false,
      duration: performance.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
