import {
  sanitizeCanvasName,
  sanitizeGraph,
  sanitizeViewport,
  StoredViewport,
} from "./canvas";
import {
  Connection,
  HttpHeader,
  isLocal,
  LOCAL_CONNECTION_ID,
  RemoteConnection,
  REQUEST_METHODS,
  RequestMethod,
} from "./connections";
import { Graph } from "./graph";
import { newId } from "./storage";

/**
 * A shared link carries the query and enough of the connection to reproduce it.
 * It lives in the URL *fragment* on purpose: fragments are never sent to a
 * server, so a link that carries credentials does not leak them to whoever
 * hosts this page or to any proxy in between.
 */
export type SharedConnection =
  | { kind: "local" }
  | {
      kind: "remote";
      name: string;
      endpoint: string;
      method: RequestMethod;
      headers?: HttpHeader[];
      auth?: { username: string; password: string };
      /**
       * Set when the sender deliberately left credentials out. Without it a
       * stripped connection is indistinguishable from one that never needed
       * any, and the recipient could not be told to fill them in.
       */
      omitted?: true;
    };

export type SharedCanvas = {
  name: string;
  graph: Graph;
  viewport: StoredViewport;
};

export type SharePayload = {
  v: 1;
  query: string;
  connection: SharedConnection;
  /** Present when a canvas was shared instead of (or as well as) a query. */
  canvas?: SharedCanvas;
};

export const SHARE_PARAM = "s";

/** Whether sharing this connection involves anything secret. */
export const hasSecrets = (connection: Connection) =>
  !isLocal(connection) &&
  (connection.auth.type === "basic" || connection.headers.length > 0);

const toBase64Url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
};

export const buildSharePayload = (
  connection: Connection,
  query: string,
  includeSecrets: boolean,
  canvas?: SharedCanvas
): SharePayload => {
  if (isLocal(connection)) {
    return { v: 1, query, connection: { kind: "local" }, ...(canvas ? { canvas } : {}) };
  }

  const shared: SharedConnection = {
    kind: "remote",
    name: connection.name,
    endpoint: connection.endpoint,
    method: connection.method,
  };

  if (includeSecrets) {
    if (connection.headers.length > 0) {
      shared.headers = connection.headers;
    }
    if (connection.auth.type === "basic") {
      shared.auth = {
        username: connection.auth.username,
        password: connection.auth.password,
      };
    }
  } else if (hasSecrets(connection)) {
    shared.omitted = true;
  }

  return { v: 1, query, connection: shared, ...(canvas ? { canvas } : {}) };
};

export const buildShareUrl = (payload: SharePayload, base?: string) => {
  const origin =
    base ??
    (typeof window === "undefined"
      ? ""
      : `${window.location.origin}${window.location.pathname}`);

  return `${origin}#${SHARE_PARAM}=${toBase64Url(JSON.stringify(payload))}`;
};

/**
 * Parse a fragment produced by {@link buildShareUrl}. The input comes from a
 * link someone else wrote, so every field is validated rather than trusted.
 */
export const parseShareFragment = (hash: string): SharePayload | undefined => {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment) {
    return undefined;
  }

  const encoded = new URLSearchParams(fragment).get(SHARE_PARAM);
  if (!encoded) {
    return undefined;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(encoded));
  } catch {
    return undefined;
  }

  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const payload = raw as Record<string, unknown>;
  if (payload.v !== 1 || typeof payload.query !== "string") {
    return undefined;
  }

  // A shared canvas arrives from an untrusted link, so it goes through the same
  // validation as one loaded from storage.
  const rawCanvas = payload.canvas as Record<string, unknown> | undefined;
  const canvas: SharedCanvas | undefined = rawCanvas
    ? {
        name: sanitizeCanvasName(rawCanvas.name, "Shared canvas"),
        graph: sanitizeGraph(rawCanvas.graph),
        viewport: sanitizeViewport(rawCanvas.viewport),
      }
    : undefined;

  const connection = payload.connection as Record<string, unknown> | undefined;
  if (connection?.kind === "local") {
    return {
      v: 1,
      query: payload.query,
      connection: { kind: "local" },
      ...(canvas ? { canvas } : {}),
    };
  }

  if (
    typeof connection?.endpoint !== "string" ||
    !connection.endpoint ||
    typeof connection.name !== "string"
  ) {
    return undefined;
  }

  const method = REQUEST_METHODS.some((entry) => entry.value === connection.method)
    ? (connection.method as RequestMethod)
    : "post-form";

  const headers = Array.isArray(connection.headers)
    ? connection.headers.flatMap((header): HttpHeader[] => {
        if (typeof header !== "object" || header === null) {
          return [];
        }
        const entry = header as Record<string, unknown>;
        return typeof entry.name === "string" && typeof entry.value === "string"
          ? [{ name: entry.name, value: entry.value }]
          : [];
      })
    : undefined;

  const rawAuth = connection.auth as Record<string, unknown> | undefined;
  const auth =
    typeof rawAuth?.username === "string" && typeof rawAuth?.password === "string"
      ? { username: rawAuth.username, password: rawAuth.password }
      : undefined;

  return {
    v: 1,
    query: payload.query,
    connection: {
      kind: "remote",
      name: connection.name || connection.endpoint,
      endpoint: connection.endpoint,
      method,
      ...(headers && headers.length > 0 ? { headers } : {}),
      ...(auth ? { auth } : {}),
      ...(connection.omitted === true ? { omitted: true as const } : {}),
    },
    ...(canvas ? { canvas } : {}),
  };
};

/** Compare endpoints ignoring the parts that never change what is queried. */
const normalizeEndpoint = (endpoint: string) => {
  try {
    const url = new URL(endpoint.trim());
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname.replace(
      /\/+$/,
      ""
    )}${url.search}`;
  } catch {
    return endpoint.trim();
  }
};

export type AppliedShare = {
  connections: Connection[];
  activeId: string;
  query: string;
  /** Handed to Explore, which adopts it as a new canvas for that connection. */
  canvas?: SharedCanvas;
  notice?: SharedNotice;
};

export type SharedNotice = {
  connectionName: string;
  endpoint?: string;
  /** True when the connection was created rather than matched. */
  created: boolean;
  /** True when the sender's endpoint needs credentials the link did not carry. */
  needsCredentials: boolean;
  /** Name of the canvas the link carried, if any. */
  canvasName?: string;
};

/**
 * Fold a shared payload into the stored connections: reuse a matching endpoint
 * if there is one, otherwise add the shared connection to the list.
 */
export const applyShare = (
  connections: Connection[],
  payload: SharePayload
): AppliedShare => {
  if (payload.connection.kind === "local") {
    const local = connections.find(isLocal);
    return {
      connections,
      activeId: local?.id ?? LOCAL_CONNECTION_ID,
      query: payload.query,
      canvas: payload.canvas,
      notice: payload.canvas
        ? {
            connectionName: local?.name ?? "the built-in store",
            created: false,
            needsCredentials: false,
            canvasName: payload.canvas.name,
          }
        : undefined,
    };
  }

  const shared = payload.connection;
  const target = normalizeEndpoint(shared.endpoint);
  const existing = connections.find(
    (connection): connection is RemoteConnection =>
      !isLocal(connection) && normalizeEndpoint(connection.endpoint) === target
  );

  if (existing) {
    // The recipient already configured this endpoint; their own settings win.
    return {
      connections,
      activeId: existing.id,
      query: payload.query,
      canvas: payload.canvas,
      notice: {
        connectionName: existing.name,
        endpoint: existing.endpoint,
        created: false,
        needsCredentials: false,
        canvasName: payload.canvas?.name,
      },
    };
  }

  const created: RemoteConnection = {
    id: newId(),
    kind: "remote",
    name: shared.name,
    endpoint: shared.endpoint,
    method: shared.method,
    headers: shared.headers ?? [],
    auth: shared.auth
      ? { type: "basic", username: shared.auth.username, password: shared.auth.password }
      : { type: "none" },
  };

  return {
    connections: [...connections, created],
    activeId: created.id,
    query: payload.query,
    canvas: payload.canvas,
    notice: {
      connectionName: created.name,
      endpoint: created.endpoint,
      created: true,
      needsCredentials: shared.omitted === true,
      canvasName: payload.canvas?.name,
    },
  };
};
