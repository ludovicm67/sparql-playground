import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { StoreContext } from "./StoreProvider";
import { type QueryResult, type ResultKind, summarizeResult } from "../lib/results";
import { defineEditorTheme, EDITOR_THEME } from "../lib/monaco";
import {
  attachDiagnostics,
  configureBackend,
  registerSparqlLanguageFeatures,
} from "../lib/languageServer";
import { defaultExample, examplesFor } from "../lib/examples";
import {
  type Connection,
  emptyRemoteConnection,
  isLocal,
  loadActiveConnectionId,
  loadConnections,
  localConnection,
  LOCAL_CONNECTION_ID,
  type RemoteConnection,
  reorder,
  saveActiveConnectionId,
  saveConnections,
} from "../lib/connections";
import {
  addHistoryEntry,
  type History,
  type HistoryEntry,
  loadHistory,
  pruneHistory,
  removeHistoryEntry,
  saveHistory,
} from "../lib/history";
import { pruneCanvases } from "../lib/canvas";
import {
  addResourceEntry,
  loadResourceHistory,
  pruneResourceHistory,
  removeResourceEntry,
  type ResourceHistory,
  resourceQuery,
  saveResourceHistory,
} from "../lib/resources";
import { runQuery } from "../lib/sparql";
import {
  applyShare,
  parseShareFragment,
  type SharedCanvas,
  type SharedNotice,
} from "../lib/share";
import { clearStoredData } from "../lib/storage";
import { loadDraft, saveDraft } from "../lib/drafts";
import { DEFAULT_NAV, type Mode, readNav, syncNav } from "../lib/navigation";
import { useConfirm } from "./ConfirmProvider";
import ConnectionDialog from "./ConnectionDialog";
import Explore from "./Explore";
import ResourceView from "./ResourceView";
import ShareDialog from "./ShareDialog";
import GraphMark from "./GraphMark";
import Results from "./Results";
import Sidebar from "./Sidebar";
import {
  AlertIcon,
  CloseIcon,
  FormatIcon,
  GraphIcon,
  ResourceIcon,
  ShareIcon,
  SidebarIcon,
  SpinnerIcon,
} from "./icons";

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

/**
 * Resolve the starting state once, folding in a shared link when the URL
 * carries one. Everything here is client-only: `StoreProvider` renders us
 * after its effect resolves, so reading localStorage and the URL is safe.
 */
const bootstrap = () => {
  const stored = loadConnections();
  const shared =
    typeof window === "undefined"
      ? undefined
      : parseShareFragment(window.location.hash);

  // Where the address bar says we were, and what was in the editor.
  const nav =
    typeof window === "undefined" ? DEFAULT_NAV : readNav(window.location.search);
  const draft = loadDraft();

  if (!shared) {
    return {
      connections: stored,
      activeId: loadActiveConnectionId(stored),
      query: draft ?? defaultExample.query,
      activeExample: (draft ? undefined : defaultExample.id) as string | undefined,
      canvas: undefined as SharedCanvas | undefined,
      resource: nav.resource || undefined,
      mode: nav.mode as Mode,
      notice: undefined as SharedNotice | undefined,
      fromLink: false,
    };
  }

  const applied = applyShare(stored, shared);
  return {
    connections: applied.connections,
    activeId: applied.activeId,
    query: applied.query,
    activeExample: undefined as string | undefined,
    canvas: applied.canvas,
    resource: applied.resource,
    // A share link wins over the address bar: it is the more explicit intent.
    mode: (applied.resource
      ? "resource"
      : applied.canvas
        ? "explore"
        : "query") as Mode,
    notice: applied.notice,
    fromLink: true,
  };
};

const Interface = () => {
  const store = useContext(StoreContext);
  const confirm = useConfirm();

  const [initial] = useState(bootstrap);

  const [connections, setConnections] = useState<Connection[]>(initial.connections);
  const [activeId, setActiveId] = useState(initial.activeId);
  const [history, setHistory] = useState<History>(loadHistory);
  const [now, setNow] = useState(() => Date.now());

  const [query, setQuery] = useState<string>(initial.query);
  const [activeExample, setActiveExample] = useState<string | undefined>(
    initial.activeExample
  );
  const [notice, setNotice] = useState(initial.notice);
  const [sharing, setSharing] = useState(false);
  const [sharingCanvas, setSharingCanvas] = useState<
    (SharedCanvas & { nodeCount: number }) | undefined
  >();
  const [formatting, setFormatting] = useState(false);
  const [mode, setMode] = useState<Mode>(initial.mode);
  // Explore is mounted on first use, then kept alive: its opening query is not
  // worth running for someone who never leaves Query mode, but the canvas they
  // built should survive switching back and forth.
  const [exploreOpened, setExploreOpened] = useState(initial.mode === "explore");
  const [storageGeneration, setStorageGeneration] = useState(0);
  const [resourceHistory, setResourceHistory] =
    useState<ResourceHistory>(loadResourceHistory);
  const [resourceUri, setResourceUri] = useState(initial.resource ?? "");
  const [pendingCanvasUri, setPendingCanvasUri] = useState<string | undefined>();
  const [sharingResource, setSharingResource] = useState<string | undefined>();
  const editorRef = useRef<Parameters<OnMount>[0] | undefined>(undefined);
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
  useEffect(() => saveResourceHistory(resourceHistory), [resourceHistory]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), RELATIVE_TIME_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  // A consumed link should not be reapplied on refresh, and leaving a fragment
  // with credentials in the address bar would be careless.
  const consumeFragment = () =>
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`
    );

  useEffect(() => {
    if (initial.fromLink) {
      consumeFragment();
    }
  }, [initial.fromLink]);

  // Reflect where we are, so a refresh lands in the same place.
  useEffect(() => {
    syncNav({ mode, resource: resourceUri });
  }, [mode, resourceUri]);

  useEffect(() => {
    const timer = setTimeout(() => saveDraft(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const connectionsRef = useRef(connections);
  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  const activeConnection = useMemo(
    () =>
      connections.find((connection) => connection.id === activeId) ??
      connections.find(isLocal) ??
      localConnection(),
    [connections, activeId]
  );

  const examples = examplesFor(activeConnection.kind);
  const connectionHistory = history[activeConnection.id] ?? [];

  // Tell the language server which endpoint is in play, so its prefix-aware
  // completion follows the connection the user is actually querying.
  useEffect(() => {
    void configureBackend(
      activeConnection.name || activeConnection.id,
      isLocal(activeConnection) ? "inmemory://oxigraph" : activeConnection.endpoint
    );
  }, [activeConnection]);

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
    editorRef.current = editor;

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      execRef.current()
    );

    // qlue-ls ships several MB of WebAssembly, so it boots in the background:
    // the editor stays usable and gains completion once the server is up.
    registerSparqlLanguageFeatures(monaco);
    attachDiagnostics(monaco, editor);
  }, []);

  // Formatting goes through the language server, so the very first run may have
  // to wait for its WebAssembly to finish loading.
  const formatQuery = async () => {
    const editor = editorRef.current;
    if (!editor || formatting) {
      return;
    }

    setFormatting(true);
    try {
      await editor.getAction("editor.action.formatDocument")?.run();
    } finally {
      setFormatting(false);
    }
  };

  const clearResults = () => {
    pending.current?.abort();
    setRunning(false);
    setResults(undefined);
    setStats(undefined);
    setError(undefined);
  };

  // Following a shared link while the app is already open only changes the
  // fragment, which is a same-document navigation: no reload, so `bootstrap`
  // never runs again and the link would silently do nothing.
  useEffect(() => {
    const onHashChange = () => {
      const shared = parseShareFragment(window.location.hash);
      if (!shared) {
        return;
      }

      const applied = applyShare(connectionsRef.current, shared);
      setConnections(applied.connections);
      setActiveId(applied.activeId);
      setQuery(applied.query);
      setActiveExample(undefined);
      setNotice(applied.notice);

      pending.current?.abort();
      setRunning(false);
      setResults(undefined);
      setStats(undefined);
      setError(undefined);

      consumeFragment();
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

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

  const deleteConnection = async (connection: Connection) => {
    if (isLocal(connection)) {
      return;
    }

    const confirmed = await confirm({
      title: "Delete this connection?",
      message: (
        <>
          <b>{connection.name}</b> will be removed, along with its query history
          and any canvases built against it.
        </>
      ),
      confirmLabel: "Delete",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    const remaining = connections.filter(
      (candidate) => candidate.id !== connection.id
    );

    const remainingIds = remaining.map((candidate) => candidate.id);

    setConnections(remaining);
    setHistory((current) => pruneHistory(current, remainingIds));
    setResourceHistory((current) => pruneResourceHistory(current, remainingIds));
    pruneCanvases(remainingIds);

    if (activeId === connection.id) {
      clearResults();
      setActiveId(remaining.find(isLocal)?.id ?? LOCAL_CONNECTION_ID);
    }
  };

  // Loads the query into the editor only: picking something out of the history
  // should never fire a request on its own.
  /** Entry point used by every other mode to hand over an IRI. */
  const openResource = useCallback((uri: string) => {
    setResourceUri(uri);
    setMode("resource");
  }, []);

  const recordResource = useCallback(
    (connectionId: string, uri: string, label?: string, statements?: number) => {
      setResourceHistory((current) =>
        addResourceEntry(current, connectionId, {
          uri,
          at: Date.now(),
          label,
          statements,
        })
      );
      setNow(Date.now());
    },
    []
  );

  const loadHistoryEntry = (entry: HistoryEntry) => {
    setQuery(entry.query);
    setActiveExample(undefined);
  };

  const resetEverything = async () => {
    const confirmed = await confirm({
      title: "Clear all stored data?",
      message:
        "Every saved connection, all query and resource history, and every canvas will be removed from this browser. This cannot be undone.",
      confirmLabel: "Clear everything",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    clearStoredData();
    clearResults();
    setConnections([localConnection()]);
    setActiveId(LOCAL_CONNECTION_ID);
    setHistory({});
    setResourceHistory({});
    setResourceUri("");
    // Explore owns its canvas state, so bump its key to remount it against the
    // now-empty storage; otherwise its debounced save writes the graph back.
    setStorageGeneration((generation) => generation + 1);
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
            data-tooltip="Toggle the sidebar"
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

        <div className="mode-switch" role="group" aria-label="Mode">
          <button
            className="segment"
            type="button"
            aria-pressed={mode === "query"}
            onClick={() => setMode("query")}
          >
            <FormatIcon size={13} />
            Query
          </button>
          <button
            className="segment"
            type="button"
            aria-pressed={mode === "explore"}
            onClick={() => {
              setExploreOpened(true);
              setMode("explore");
            }}
          >
            <GraphIcon size={13} />
            Explore
          </button>
          <button
            className="segment"
            type="button"
            aria-pressed={mode === "resource"}
            onClick={() => setMode("resource")}
          >
            <ResourceIcon size={13} />
            Resource
          </button>
        </div>

        <div className="header-meta">
          <span className="pill" data-tooltip={activeConnection.name}>
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
            data-tooltip="View the source on GitHub"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            <span className="sr-only">GitHub repository</span>
          </a>
        </div>
      </header>

      {notice ? (
        <div
          className={`notice${notice.needsCredentials ? " is-warning" : ""}`}
          role="status"
        >
          <AlertIcon size={15} />
          <p className="notice-text">
            {notice.created ? (
              <>
                Added <b>{notice.connectionName}</b>{" "}
                <span className="notice-endpoint">({notice.endpoint})</span> from a
                shared link.
                {notice.needsCredentials ? (
                  <>
                    {" "}
                    The link left the credentials out, so edit the connection and
                    add them before running the query.
                  </>
                ) : null}
              </>
            ) : (
              <>
                Opened a shared{" "}
                {notice.canvasName
                  ? "canvas"
                  : notice.resource
                    ? "resource"
                    : "query"}{" "}
                against your existing <b>{notice.connectionName}</b> connection.
              </>
            )}
            {notice.canvasName ? (
              <>
                {" "}
                The canvas <b>{notice.canvasName}</b> is waiting in{" "}
                <b>Explore</b>.
              </>
            ) : null}
            {notice.resource ? (
              <>
                {" "}
                Showing <b>{notice.resource}</b>.
              </>
            ) : null}
          </p>
          <button
            className="icon-btn"
            type="button"
            onClick={() => setNotice(undefined)}
            aria-label="Dismiss"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}

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
            resourceHistory={resourceHistory[activeConnection.id] ?? []}
            showResources={mode === "resource"}
            now={now}
            onSelectResource={(entry) => setResourceUri(entry.uri)}
            onDeleteResource={(entry) =>
              setResourceHistory((current) =>
                removeResourceEntry(current, activeConnection.id, entry.id)
              )
            }
            onClearResources={() =>
              setResourceHistory((current) => ({
                ...current,
                [activeConnection.id]: [],
              }))
            }
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
            onDelete={(connection) => void deleteConnection(connection)}
            onMove={(index, direction) =>
              setConnections((current) => reorder(current, index, direction))
            }
            onSelectHistoryEntry={loadHistoryEntry}
            onDeleteHistoryEntry={(entry) =>
              setHistory((current) =>
                removeHistoryEntry(current, activeConnection.id, entry.id)
              )
            }
            onClearHistory={() =>
              setHistory((current) => ({ ...current, [activeConnection.id]: [] }))
            }
            onClearStoredData={() => void resetEverything()}
          />
        ) : null}

        {exploreOpened ? (
          <Explore
            key={`${activeConnection.id}:${storageGeneration}`}
            connection={activeConnection}
            store={store}
            hidden={mode !== "explore"}
            incomingCanvas={initial.canvas}
            pendingUri={pendingCanvasUri}
            onPendingUriConsumed={() => setPendingCanvasUri(undefined)}
            onOpenResource={openResource}
            onOpenQuery={(text) => {
              setQuery(text);
              setActiveExample(undefined);
              clearResults();
              setMode("query");
            }}
            onShareCanvas={setSharingCanvas}
          />
        ) : null}

        <ResourceView
          key={`${activeConnection.id}:${resourceUri}`}
          connection={activeConnection}
          store={store}
          hidden={mode !== "resource"}
          uri={resourceUri}
          onUriChange={setResourceUri}
          onLoaded={(uri, details) =>
            recordResource(
              activeConnection.id,
              uri,
              details?.label,
              details?.statements
            )
          }
          onOpenQuery={(text) => {
            setQuery(text);
            setActiveExample(undefined);
            clearResults();
            setMode("query");
          }}
          onAddToCanvas={(uri) => {
            setPendingCanvasUri(uri);
            setExploreOpened(true);
            setMode("explore");
          }}
          onShare={() => setSharingResource(resourceUri)}
        />

        <main className="workspace" hidden={mode !== "query"}>
          <section className="panel" aria-label="Query">
            <div className="panel-header">
              <span className="panel-title">Query</span>
              <div className="panel-header-actions">
                <button
                  className="icon-btn"
                  type="button"
                  onClick={() => void formatQuery()}
                  disabled={formatting}
                  aria-label="Format this query"
                  data-tooltip={`Format the query (${
                    shortcut.startsWith("⌘") ? "⇧ ⌥ F" : "Shift+Alt+F"
                  })`}
                >
                  {formatting ? <SpinnerIcon /> : <FormatIcon />}
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  onClick={() => setSharing(true)}
                  aria-label="Share this query"
                  data-tooltip="Get a link to this query"
                >
                  <ShareIcon />
                </button>
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
                  // Otherwise Monaco pads the language server's suggestions
                  // with words scraped out of the query itself.
                  wordBasedSuggestions: "off",
                  quickSuggestions: { other: true, comments: false, strings: false },
                  suggestSelection: "first",
                  tabCompletion: "on",
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
                  data-tooltip={example.description}
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
                <Results results={results} onOpenResource={openResource} />
              )}
            </div>
          </section>
        </main>
      </div>

      {sharing || sharingCanvas || sharingResource ? (
        <ShareDialog
          connection={activeConnection}
          query={sharingResource ? resourceQuery(sharingResource) : query}
          canvas={sharingCanvas}
          resource={sharingResource}
          onClose={() => {
            setSharing(false);
            setSharingCanvas(undefined);
            setSharingResource(undefined);
          }}
        />
      ) : null}

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
