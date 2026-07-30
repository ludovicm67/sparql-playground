import { isSafeIri } from "./explore";

export type Mode = "query" | "explore" | "resource";

export type NavState = {
  mode: Mode;
  /** Only meaningful in resource mode. */
  resource: string;
};

const MODES: Mode[] = ["query", "explore", "resource"];

export const DEFAULT_NAV: NavState = { mode: "query", resource: "" };

/**
 * Navigation lives in the query string, not the fragment: the fragment is
 * reserved for share payloads, and the two need to coexist on the same URL.
 *
 * Only what localStorage cannot already restore goes here — the connection,
 * canvases and the query draft are persisted per browser, so putting their ids
 * in the URL would add noise without adding recall.
 */
export const readNav = (search: string): NavState => {
  const params = new URLSearchParams(search);

  const mode = params.get("mode");
  const resource = params.get("uri") ?? "";

  return {
    mode: MODES.includes(mode as Mode) ? (mode as Mode) : "query",
    resource: isSafeIri(resource) ? resource : "",
  };
};

/** The query string for a state, empty when it is the default. */
export const writeNav = (state: NavState) => {
  const params = new URLSearchParams();

  if (state.mode !== "query") {
    params.set("mode", state.mode);
  }
  if (state.mode === "resource" && state.resource) {
    params.set("uri", state.resource);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
};

/**
 * Reflect the current state in the address bar without touching the fragment.
 * `replaceState` rather than `pushState`: this mirrors where you are so a
 * refresh lands in the same place, and should not fill the back stack.
 */
export const syncNav = (state: NavState) => {
  if (typeof window === "undefined") {
    return;
  }

  const next = `${window.location.pathname}${writeNav(state)}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (next !== current) {
    window.history.replaceState(window.history.state, "", next);
  }
};
