import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import { StoreContext } from "./StoreProvider";
import { handleResults, QueryResult } from "../lib/results";
import { defineEditorTheme, EDITOR_THEME } from "../lib/monaco";
import { defaultExample, examples } from "../lib/examples";
import GraphMark from "./GraphMark";
import Results from "./Results";

const REPOSITORY = "https://github.com/ludovicm67/sparql-playground";

type RunStats = {
  /** `null` for results that have no row count, such as ASK. */
  rows: number | null;
  duration: number;
  kind: "table" | "boolean" | "graph";
};

const KIND_LABELS: Record<RunStats["kind"], string> = {
  table: "bindings",
  boolean: "boolean",
  graph: "graph",
};

const describe = (results: QueryResult): RunStats["kind"] => {
  if (typeof results === "string") {
    return "graph";
  }

  return Object.hasOwnProperty.call(results, "boolean") ? "boolean" : "table";
};

const countRows = (results: QueryResult, kind: RunStats["kind"]) => {
  if (kind === "boolean") {
    return null;
  }

  if (typeof results === "string") {
    return results ? results.split("\n").filter(Boolean).length : 0;
  }

  return results.results?.bindings?.length ?? 0;
};

const Interface = () => {
  const store = useContext(StoreContext);

  const [query, setQuery] = useState<string>(defaultExample.query);
  const [activeExample, setActiveExample] = useState<string | undefined>(
    defaultExample.id
  );
  const [results, setResults] = useState<QueryResult | undefined>();
  const [stats, setStats] = useState<RunStats | undefined>();
  const [error, setError] = useState<string | undefined>();

  // Safe to read here: `StoreProvider` only renders us once the store is
  // built, which happens in an effect, so this never runs on the server.
  const shortcut = useMemo(
    () =>
      typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
        ? "⌘ ↵"
        : "Ctrl ↵",
    []
  );

  const execQuery = useCallback(() => {
    if (!store) {
      return;
    }

    try {
      const startedAt = performance.now();
      const queryResults = store.query(query);
      const parsedResults = handleResults(queryResults);
      const duration = performance.now() - startedAt;

      const kind = describe(parsedResults);
      setResults(parsedResults);
      setStats({ kind, rows: countRows(parsedResults, kind), duration });
      setError(undefined);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setResults(undefined);
      setStats(undefined);
    }
  }, [store, query]);

  // Keep the editor's Cmd/Ctrl+Enter binding pointing at the latest closure.
  const execRef = useRef(execQuery);
  useEffect(() => {
    execRef.current = execQuery;
  }, [execQuery]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      execRef.current()
    );
  }, []);

  const loadExample = (id: string) => {
    const example = examples.find((candidate) => candidate.id === id);
    if (!example) {
      return;
    }

    setQuery(example.query);
    setActiveExample(example.id);
  };

  if (!store) {
    return <div className="state">Missing store!</div>;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <GraphMark size={24} className="brand-mark" />
          <div>
            <h1>SPARQL Playground</h1>
            <p className="brand-sub">Oxigraph, running entirely in your browser</p>
          </div>
        </div>

        <div className="header-meta">
          <span className="pill">
            <b>{store.size}</b> triples
          </span>
          <a
            className="header-link"
            href={REPOSITORY}
            target="_blank"
            rel="noreferrer"
            title="View the source on GitHub"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            <span className="sr-only">GitHub repository</span>
          </a>
        </div>
      </header>

      <main className="workspace">
        <section className="panel" aria-label="Query">
          <div className="panel-header">
            <span className="panel-title">Query</span>
            <button className="btn-run" onClick={execQuery} type="button">
              Run query
              <kbd>{shortcut}</kbd>
            </button>
          </div>

          <div className="panel-body panel-body--flush">
            <Editor
              height="100%"
              value={query}
              defaultLanguage="sparql"
              language="sparql"
              theme={EDITOR_THEME}
              beforeMount={defineEditorTheme}
              onMount={handleEditorMount}
              onChange={(value) => {
                setQuery(value ?? "");
                setActiveExample(undefined);
              }}
              options={{
                scrollBeyondLastLine: false,
                fontSize: 13.5,
                lineHeight: 22,
                padding: { top: 14, bottom: 14 },
                minimap: { enabled: false },
                overviewRulerLanes: 0,
                scrollbar: {
                  verticalScrollbarSize: 10,
                  horizontalScrollbarSize: 10,
                },
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on",
                lineNumbersMinChars: 3,
                smoothScrolling: true,
                fixedOverflowWidgets: true,
              }}
            />
          </div>

          <div className="examples">
            <span className="examples-label">Examples</span>
            {examples.map((example) => (
              <button
                key={example.id}
                className="chip"
                type="button"
                title={example.description}
                aria-pressed={activeExample === example.id}
                onClick={() => loadExample(example.id)}
              >
                {example.label}
              </button>
            ))}
          </div>
        </section>

        <section className="panel" aria-label="Results">
          <div className="panel-header">
            <span className="panel-title">Results</span>
            {stats ? (
              <span className="panel-status">
                <span className="badge">{KIND_LABELS[stats.kind]}</span>
                {stats.rows !== null ? (
                  <span>
                    {stats.rows} {stats.rows === 1 ? "row" : "rows"}
                  </span>
                ) : null}
                <span className="timing">{stats.duration.toFixed(1)} ms</span>
              </span>
            ) : null}
          </div>

          <div
            className={
              typeof results === "string"
                ? "panel-body panel-body--flush"
                : "panel-body"
            }
          >
            {error ? (
              <div className="error-box" role="alert">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
                  <path
                    d="M12 7.5v5.5M12 16.2v.6"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
                <div>
                  <p className="error-title">Query failed</p>
                  <p className="error-message">{error}</p>
                </div>
              </div>
            ) : results === undefined ? (
              <div className="state">
                <GraphMark size={30} />
                <p className="state-title">Nothing to show yet</p>
                <p className="state-hint">
                  Press <kbd>{shortcut}</kbd> or hit <b>Run query</b> to execute the
                  query against the store.
                </p>
              </div>
            ) : (
              <Results results={results} />
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default Interface;
