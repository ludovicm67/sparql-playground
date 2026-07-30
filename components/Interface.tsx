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
import { QueryResult, ResultKind, summarizeResult } from "../lib/results";
import { defineEditorTheme, EDITOR_THEME } from "../lib/monaco";
import { defaultExample, examplesFor } from "../lib/examples";
import {
  Connection,
  emptyRemoteConnection,
  isLocal,
  loadActiveConnectionId,
  loadConnections,
  localConnection,
  LOCAL_CONNECTION_ID,
  RemoteConnection,
  reorder,
  saveActiveConnectionId,
  saveConnections,
} from "../lib/connections";
import {
  addHistoryEntry,
  History,
  HistoryEntry,
  loadHistory,
  pruneHistory,
  removeHistoryEntry,
  saveHistory,
} from "../lib/history";
import { runQuery } from "../lib/sparql";
import { clearStoredData } from "../lib/storage";
import ConnectionDialog from "./ConnectionDialog";
import GraphMark from "./GraphMark";
import Results from "./Results";
import Sidebar from "./Sidebar";
import { SidebarIcon, SpinnerIcon } from "./icons";

const REPOSITORY = "https://github.com/ludovicm67/sparql-playground";
const RELATIVE_TIME_REFRESH_MS = 30_000;

type RunStats = {
  kind: ResultKind;
  rows: number | null;
  duration: number;
};

const KIND_LABELS: Record<ResultKind, string> = {
  table: "bindings",
  boolean: "boolean",
  graph: "graph",
};

const hostOf = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
};

const Interface = () => {
  const store = useContext(StoreContext);

  // Everything below is client-only: `StoreProvider` renders us after its
  // effect resolves, so reading localStorage during init is safe.
  const [connections, setConnections] = useState<Connection[]>(loadConnections);
  const [activeId, setActiveId] = useState(() =>
    loadActiveConnectionId(loadConnections())
  );
  const [history, setHistory] = useState<History>(loadHistory);
  const [now, setNow] = useState(() => Date.now());

  const [query, setQuery] = useState<string>(defaultExample.query);
  const [activeExample, setActiveExample] = useState<string | undefined>(
    defaultExample.id
  );
  const [results, setResults] = useState<QueryResult | undefined>();
  const [stats, setStats] = useState<RunStats | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [running, setRunning] = useState(false);

  const [editing, setEditing] = useState<RemoteConnection | undefined>();
  const [creating, setCreating] = useState(false);
  // On a narrow screen the sidebar is an overlay, so starting it open would
  // bury the editor behind it.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > 760
  );

  const shortcut = useMemo(
    () =>
      typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
        ? "⌘ ↵"
        : "Ctrl ↵",
    []
  );

  useEffect(() => saveConnections(connections), [connections]);
  useEffect(() => saveActiveConnectionId(activeId), [activeId]);
  useEffect(() => saveHistory(history), [history]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), RELATIVE_TIME_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const activeConnection = useMemo(
    () =>
      connections.find((connection) => connection.id === activeId) ??
      connections.find(isLocal) ??
      localConnection(),
    [connections, activeId]
  );

  const examples = examplesFor(activeConnection.kind);
  const connectionHistory = history[activeConnection.id] ?? [];

  const pending = useRef<AbortController | undefined>(undefined);

  const execute = useCallback(
    async (text: string, connection: Connection) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;

      setRunning(true);
      const startedAt = performance.now();

      try {
        const parsed = await runQuery(connection, text, store, controller.signal);
        if (controller.signal.aborted) {
          return;
        }

        const duration = performance.now() - startedAt;
        const summary = summarizeResult(parsed);

        setResults(parsed);
        setStats({ ...summary, duration });
        setError(undefined);
        setHistory((current) =>
          addHistoryEntry(current, connection.id, {
            query: text,
            at: Date.now(),
            status: "ok",
            rows: summary.rows,
            duration,
          })
        );
      } catch (failure) {
        if (controller.signal.aborted) {
          return;
        }

        const duration = performance.now() - startedAt;
        setError(failure instanceof Error ? failure.message : String(failure));
        setResults(undefined);
        setStats(undefined);
        setHistory((current) =>
          addHistoryEntry(current, connection.id, {
            query: text,
            at: Date.now(),
            status: "error",
            rows: null,
            duration,
          })
        );
      } finally {
        // Only the run that still owns `pending` may clear the busy state: if a
        // newer run superseded this one it is now in charge, but a user-issued
        // cancel must not leave the panel stuck on "Running…".
        if (pending.current === controller) {
          pending.current = undefined;
          setRunning(false);
          setNow(Date.now());
        }
      }
    },
    [store]
  );

  const execQuery = useCallback(
    () => execute(query, activeConnection),
    [execute, query, activeConnection]
  );

  // The editor binds Cmd/Ctrl+Enter once, so route it through a ref to reach
  // the current query and connection rather than the ones captured at mount.
  const execRef = useRef(execQuery);
  useEffect(() => {
    execRef.current = execQuery;
  }, [execQuery]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      execRef.current()
    );
  }, []);

  const clearResults = () => {
    pending.current?.abort();
    setRunning(false);
    setResults(undefined);
    setStats(undefined);
    setError(undefined);
  };

  const selectConnection = (id: string) => {
    if (id === activeId) {
      return;
    }
    clearResults();
    setActiveId(id);
  };

  const saveConnection = (connection: Connection) => {
    setConnections((current) =>
      current.some((candidate) => candidate.id === connection.id)
        ? current.map((candidate) =>
            candidate.id === connection.id ? connection : candidate
          )
        : [...current, connection]
    );

    if (creating) {
      clearResults();
      setActiveId(connection.id);
    }

    setEditing(undefined);
    setCreating(false);
  };

  const deleteConnection = (connection: Connection) => {
    if (
      isLocal(connection) ||
      !window.confirm(`Delete the connection “${connection.name}” and its history?`)
    ) {
      return;
    }

    const remaining = connections.filter(
      (candidate) => candidate.id !== connection.id
    );

    setConnections(remaining);
    setHistory((current) =>
      pruneHistory(
        current,
        remaining.map((candidate) => candidate.id)
      )
    );

    if (activeId === connection.id) {
      clearResults();
      setActiveId(remaining.find(isLocal)?.id ?? LOCAL_CONNECTION_ID);
    }
  };

  const runHistoryEntry = (entry: HistoryEntry) => {
    setQuery(entry.query);
    setActiveExample(undefined);
    void execute(entry.query, activeConnection);
  };

  const resetEverything = () => {
    if (
      !window.confirm(
        "Remove every saved connection and all query history from this browser?"
      )
    ) {
      return;
    }

    clearStoredData();
    clearResults();
    setConnections([localConnection()]);
    setActiveId(LOCAL_CONNECTION_ID);
    setHistory({});
  };

  const loadExample = (id: string) => {
    const example = examples.find((candidate) => candidate.id === id);
    if (!example) {
      return;
    }

    setQuery(example.query);
    setActiveExample(example.id);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <button
            className="icon-btn"
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label={sidebarOpen ? "Hide the sidebar" : "Show the sidebar"}
            aria-expanded={sidebarOpen}
            title="Toggle the sidebar"
          >
            <SidebarIcon />
          </button>
          <GraphMark size={24} className="brand-mark" />
          <div>
            <h1>SPARQL Playground</h1>
            <p className="brand-sub">
              {isLocal(activeConnection)
                ? "Oxigraph, running entirely in your browser"
                : `Querying ${hostOf(activeConnection.endpoint)}`}
            </p>
          </div>
        </div>

        <div className="header-meta">
          <span className="pill" title={activeConnection.name}>
            {isLocal(activeConnection) && store ? (
              <>
                <b>{store.size}</b> triples
              </>
            ) : (
              <b className="pill-name">{activeConnection.name}</b>
            )}
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

      <div className={`app-body${sidebarOpen ? " with-sidebar" : ""}`}>
        {sidebarOpen ? (
          <button
            className="sidebar-backdrop"
            type="button"
            aria-label="Close the sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        {sidebarOpen ? (
          <Sidebar
            connections={connections}
            activeId={activeConnection.id}
            history={connectionHistory}
            now={now}
            onSelect={selectConnection}
            onCreate={() => {
              setCreating(true);
              setEditing(emptyRemoteConnection());
            }}
            onEdit={(connection) => {
              if (!isLocal(connection)) {
                setCreating(false);
                setEditing(connection);
              }
            }}
            onDelete={deleteConnection}
            onMove={(index, direction) =>
              setConnections((current) => reorder(current, index, direction))
            }
            onRunHistoryEntry={runHistoryEntry}
            onDeleteHistoryEntry={(entry) =>
              setHistory((current) =>
                removeHistoryEntry(current, activeConnection.id, entry.id)
              )
            }
            onClearHistory={() =>
              setHistory((current) => ({ ...current, [activeConnection.id]: [] }))
            }
            onClearStoredData={resetEverything}
          />
        ) : null}

        <main className="workspace">
          <section className="panel" aria-label="Query">
            <div className="panel-header">
              <span className="panel-title">Query</span>
              <button
                className="btn-run"
                onClick={() => (running ? pending.current?.abort() : execQuery())}
                type="button"
              >
                {running ? <SpinnerIcon /> : null}
                {running ? "Cancel" : "Run query"}
                {running ? null : <kbd>{shortcut}</kbd>}
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
              {stats && !running ? (
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
                typeof results === "string" && !running && !error
                  ? "panel-body panel-body--flush"
                  : "panel-body"
              }
            >
              {running ? (
                <div className="state">
                  <SpinnerIcon size={26} />
                  <p className="state-title">Running…</p>
                  <p className="state-hint">
                    {isLocal(activeConnection)
                      ? "Querying the in-browser store."
                      : `Waiting for ${hostOf(activeConnection.endpoint)}.`}
                  </p>
                </div>
              ) : error ? (
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
                    query against <b>{activeConnection.name}</b>.
                  </p>
                </div>
              ) : (
                <Results results={results} />
              )}
            </div>
          </section>
        </main>
      </div>

      {editing ? (
        <ConnectionDialog
          connection={editing}
          isNew={creating}
          store={store}
          onSave={saveConnection}
          onCancel={() => {
            setEditing(undefined);
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
};

export default Interface;
