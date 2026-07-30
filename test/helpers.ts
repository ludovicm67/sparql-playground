/**
 * A localStorage good enough for the storage layer, plus the `window` the app
 * checks for before touching it.
 */
export class MemoryStorage {
  private entries = new Map<string, string>();

  get length() {
    return this.entries.size;
  }

  getItem(key: string) {
    return this.entries.has(key) ? (this.entries.get(key) as string) : null;
  }

  setItem(key: string, value: string) {
    this.entries.set(key, String(value));
  }

  removeItem(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  key(index: number) {
    return Array.from(this.entries.keys())[index] ?? null;
  }
}

type FakeWindow = { localStorage: MemoryStorage; location: { protocol: string } };

// The app only ever reads `window.localStorage` and `window.location.protocol`,
// so a stand-in with those is enough; cast rather than model the whole DOM.
type GlobalWithWindow = { window?: unknown };

/**
 * Install a fresh fake `window` for one test and return a disposer. Tests that
 * touch persistence must call this, otherwise the storage layer takes its
 * "no window" branch and silently does nothing.
 */
export const withStorage = () => {
  const storage = new MemoryStorage();
  const scope = globalThis as unknown as GlobalWithWindow;
  const previous = scope.window;

  const fake: FakeWindow = {
    localStorage: storage,
    location: { protocol: "https:" },
  };
  scope.window = fake;

  return {
    storage,
    restore: () => {
      if (previous === undefined) {
        delete scope.window;
      } else {
        scope.window = previous;
      }
    },
  };
};

/** Build a SPARQL JSON result from plain rows, for the parsers to chew on. */
export type Binding =
  | { type: "uri"; value: string }
  | { type: "bnode"; value: string }
  | { type: "literal"; value: string; datatype?: string; "xml:lang"?: string };

export const sparqlJson = (vars: string[], rows: Record<string, Binding>[]) => ({
  head: { vars },
  results: { bindings: rows },
});

export const uri = (value: string) => ({ type: "uri" as const, value });

export const literal = (
  value: string,
  extra: { datatype?: string; "xml:lang"?: string } = {}
) => ({ type: "literal" as const, value, ...extra });

export const bnode = (value: string) => ({ type: "bnode" as const, value });
