import { newId, readJson, STORAGE_KEYS, writeJson } from "./storage";

export type HistoryEntry = {
  id: string;
  query: string;
  at: number;
  status: "ok" | "error";
  /** `null` when the result has no row count (ASK) or the query failed. */
  rows: number | null;
  duration: number;
};

/** History is scoped per connection: the same query means different things. */
export type History = Record<string, HistoryEntry[]>;

const MAX_ENTRIES_PER_CONNECTION = 50;

const sanitizeEntry = (value: unknown): HistoryEntry | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  if (typeof raw.query !== "string" || !raw.query.trim()) {
    return undefined;
  }

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
    query: raw.query,
    at: typeof raw.at === "number" ? raw.at : 0,
    status: raw.status === "error" ? "error" : "ok",
    rows: typeof raw.rows === "number" ? raw.rows : null,
    duration: typeof raw.duration === "number" ? raw.duration : 0,
  };
};

export const loadHistory = (): History => {
  const stored = readJson<unknown>(STORAGE_KEYS.history, undefined);
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return {};
  }

  const history: History = {};
  for (const [connectionId, entries] of Object.entries(stored)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    history[connectionId] = entries
      .flatMap((entry) => {
        const parsed = sanitizeEntry(entry);
        return parsed ? [parsed] : [];
      })
      .slice(0, MAX_ENTRIES_PER_CONNECTION);
  }

  return history;
};

export const saveHistory = (history: History) =>
  writeJson(STORAGE_KEYS.history, history);

/**
 * Record a run at the top of a connection's history. Re-running a query the
 * user already ran moves that entry back to the top with fresh stats instead
 * of piling up duplicates.
 */
export const addHistoryEntry = (
  history: History,
  connectionId: string,
  entry: Omit<HistoryEntry, "id">
): History => {
  const previous = history[connectionId] ?? [];
  const withoutDuplicate = previous.filter(
    (candidate) => candidate.query !== entry.query
  );

  return {
    ...history,
    [connectionId]: [{ ...entry, id: newId() }, ...withoutDuplicate].slice(
      0,
      MAX_ENTRIES_PER_CONNECTION
    ),
  };
};

export const removeHistoryEntry = (
  history: History,
  connectionId: string,
  entryId: string
): History => ({
  ...history,
  [connectionId]: (history[connectionId] ?? []).filter(
    (entry) => entry.id !== entryId
  ),
});

/** Drop history belonging to connections that no longer exist. */
export const pruneHistory = (history: History, connectionIds: string[]): History =>
  Object.fromEntries(
    Object.entries(history).filter(([connectionId]) =>
      connectionIds.includes(connectionId)
    )
  );

/** First line of a query that is neither blank nor a comment. */
export const summarizeQuery = (query: string) => {
  const line = query
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate && !candidate.startsWith("#"));

  if (!line) {
    return query.trim().split("\n")[0] || "(empty query)";
  }

  // Drop the dangling brace that opens the next line, so the preview reads as
  // "SELECT ?a ?b WHERE" rather than "SELECT ?a ?b WHERE {".
  return line.replace(/\s*\{$/, "").replace(/\s+/g, " ") || line;
};

const UNITS: [limit: number, divisor: number, unit: Intl.RelativeTimeFormatUnit][] =
  [
    [60_000, 1_000, "second"],
    [3_600_000, 60_000, "minute"],
    [86_400_000, 3_600_000, "hour"],
    [604_800_000, 86_400_000, "day"],
  ];

export const formatRelativeTime = (timestamp: number, now: number) => {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 5_000) {
    return "just now";
  }

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [limit, divisor, unit] of UNITS) {
    if (elapsed < limit) {
      return formatter.format(-Math.floor(elapsed / divisor), unit);
    }
  }

  return formatter.format(-Math.floor(elapsed / 604_800_000), "week");
};
