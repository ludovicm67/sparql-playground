export const STORAGE_KEYS = {
  connections: "sparql-playground:connections",
  activeConnection: "sparql-playground:active-connection",
  history: "sparql-playground:history",
  canvas: "sparql-playground:canvas",
  resources: "sparql-playground:resources",
  draft: "sparql-playground:draft",
  theme: "sparql-playground:theme",
} as const;

export const readJson = <T>(key: string, fallback: T): T => {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // Corrupted entry, private-mode restrictions, quota errors… all recoverable
    // by falling back to the default value.
    return fallback;
  }
};

export const writeJson = (key: string, value: unknown) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode, quota). Losing persistence is
    // preferable to breaking the app.
  }
};

/**
 * Keys that survive "Clear all stored data". The theme is a display
 * preference rather than something the user put here, and the confirmation
 * promises to remove connections, history and canvases — so throwing the
 * interface back to the system scheme would be a surprise nobody agreed to.
 */
const KEPT_ON_CLEAR: readonly string[] = [STORAGE_KEYS.theme];

export const clearStoredData = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    Object.values(STORAGE_KEYS)
      .filter((key) => !KEPT_ON_CLEAR.includes(key))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Nothing sensible to do if storage refuses to cooperate.
  }
};

export const newId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `id-${Date.now().toString(36)}-${Math.floor(
    Math.random() * 1e9
  ).toString(36)}`;
};
