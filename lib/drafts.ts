import { readJson, STORAGE_KEYS, writeJson } from "./storage";

const MAX_LENGTH = 100_000;

/**
 * The query currently in the editor. Kept out of the URL on purpose — a query
 * is far too long to live in an address bar — but still restored on reload so
 * a refresh does not throw away what you were writing.
 */
export const loadDraft = (): string | undefined => {
  const stored = readJson<unknown>(STORAGE_KEYS.draft, undefined);
  return typeof stored === "string" && stored.length <= MAX_LENGTH
    ? stored
    : undefined;
};

export const saveDraft = (query: string) =>
  writeJson(STORAGE_KEYS.draft, query.slice(0, MAX_LENGTH));
