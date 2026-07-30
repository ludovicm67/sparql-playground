import { newId, readJson, STORAGE_KEYS, writeJson } from "./storage";

export type HttpHeader = {
  name: string;
  value: string;
};

export type ConnectionAuth =
  | { type: "none" }
  | { type: "basic"; username: string; password: string };

/**
 * How the query travels to the endpoint. Every SPARQL 1.1 Protocol server
 * supports at least one of these; form-encoded POST is the safest default.
 */
export type RequestMethod = "post-form" | "post-direct" | "get";

export const REQUEST_METHODS: { value: RequestMethod; label: string; hint: string }[] =
  [
    {
      value: "post-form",
      label: "POST form-encoded",
      hint: "query= in an application/x-www-form-urlencoded body — the most widely supported",
    },
    {
      value: "post-direct",
      label: "POST query body",
      hint: "The query as an application/sparql-query body, per the SPARQL 1.1 Protocol",
    },
    {
      value: "get",
      label: "GET",
      hint: "?query= in the URL — cacheable, but long queries can exceed URL limits",
    },
  ];

export type LocalConnection = {
  id: string;
  kind: "local";
  name: string;
};

export type RemoteConnection = {
  id: string;
  kind: "remote";
  name: string;
  endpoint: string;
  method: RequestMethod;
  headers: HttpHeader[];
  auth: ConnectionAuth;
};

export type Connection = LocalConnection | RemoteConnection;

/** The bundled in-browser store. Always present, never deletable. */
export const LOCAL_CONNECTION_ID = "local-tbbt";

export const localConnection = (): LocalConnection => ({
  id: LOCAL_CONNECTION_ID,
  kind: "local",
  name: "TBBT (Oxigraph in browser)",
});

export const emptyRemoteConnection = (): RemoteConnection => ({
  id: newId(),
  kind: "remote",
  name: "",
  endpoint: "",
  method: "post-form",
  headers: [],
  auth: { type: "none" },
});

export const isLocal = (connection: Connection): connection is LocalConnection =>
  connection.kind === "local";

/**
 * Stored data is user-editable and survives app upgrades, so treat anything
 * coming back from localStorage as untrusted and rebuild known-good objects.
 */
const sanitizeConnection = (value: unknown): Connection | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id ? raw.id : newId();
  const name = typeof raw.name === "string" ? raw.name : "";

  if (raw.kind === "local" || id === LOCAL_CONNECTION_ID) {
    return { ...localConnection(), name: name || localConnection().name };
  }

  if (typeof raw.endpoint !== "string" || !raw.endpoint) {
    return undefined;
  }

  const method = REQUEST_METHODS.some((entry) => entry.value === raw.method)
    ? (raw.method as RequestMethod)
    : "post-form";

  const headers = Array.isArray(raw.headers)
    ? raw.headers.flatMap((header): HttpHeader[] => {
        if (typeof header !== "object" || header === null) {
          return [];
        }
        const entry = header as Record<string, unknown>;
        return typeof entry.name === "string" && typeof entry.value === "string"
          ? [{ name: entry.name, value: entry.value }]
          : [];
      })
    : [];

  const rawAuth = raw.auth as Record<string, unknown> | undefined;
  const auth: ConnectionAuth =
    rawAuth?.type === "basic"
      ? {
          type: "basic",
          username: typeof rawAuth.username === "string" ? rawAuth.username : "",
          password: typeof rawAuth.password === "string" ? rawAuth.password : "",
        }
      : { type: "none" };

  return {
    id,
    kind: "remote",
    name: name || raw.endpoint,
    endpoint: raw.endpoint,
    method,
    headers,
    auth,
  };
};

export const loadConnections = (): Connection[] => {
  const stored = readJson<unknown>(STORAGE_KEYS.connections, undefined);
  const parsed = Array.isArray(stored)
    ? stored.flatMap((entry) => {
        const connection = sanitizeConnection(entry);
        return connection ? [connection] : [];
      })
    : [];

  // The in-browser store is the app's fallback: re-seed it if it went missing.
  return parsed.some(isLocal) ? parsed : [localConnection(), ...parsed];
};

export const saveConnections = (connections: Connection[]) =>
  writeJson(STORAGE_KEYS.connections, connections);

export const loadActiveConnectionId = (connections: Connection[]) => {
  const stored = readJson<unknown>(STORAGE_KEYS.activeConnection, undefined);

  return typeof stored === "string" &&
    connections.some((connection) => connection.id === stored)
    ? stored
    : LOCAL_CONNECTION_ID;
};

export const saveActiveConnectionId = (id: string) =>
  writeJson(STORAGE_KEYS.activeConnection, id);

/** Move an entry one slot up or down, returning a new array. */
export const reorder = <T>(items: T[], index: number, direction: -1 | 1): T[] => {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return items;
  }

  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

/** What a connection shows underneath its name in the sidebar. */
export const describeConnection = (connection: Connection) =>
  isLocal(connection) ? "Built-in WebAssembly store" : connection.endpoint;
