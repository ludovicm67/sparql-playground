import type { Monaco } from "@monaco-editor/react";
import type { editor, languages, Position } from "monaco-editor";

/**
 * A minimal LSP client for qlue-ls compiled to WebAssembly.
 *
 * qlue-ls speaks JSON-RPC over a pair of Web Streams, one *whole message per
 * chunk* and **without** the usual `Content-Length` framing — its WASM entry
 * point hands each chunk straight to `serde_json`. So this client just writes
 * JSON strings and parses the ones that come back.
 */

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };

type LspTextEdit = { range: LspRange; newText: string };

type LspCompletionItem = {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: LspTextEdit | { newText: string; insert: LspRange; replace: LspRange };
};

type LspDiagnostic = {
  range: LspRange;
  severity?: number;
  message: string;
  source?: string;
  code?: string;
  data?: unknown;
};

type LspCodeAction = {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  diagnostics?: LspDiagnostic[];
  edit?: { changes?: Record<string, LspTextEdit[]> };
};

export const DOCUMENT_URI = "inmemory://sparql-playground/query.rq";

class SparqlLanguageClient {
  private writer: WritableStreamDefaultWriter<string>;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  private version = 0;
  private opened = false;
  private lastText: string | undefined;
  private backends = new Set<string>();
  private lastDiagnostics: LspDiagnostic[] = [];

  private constructor(writer: WritableStreamDefaultWriter<string>) {
    this.writer = writer;
  }

  static async start(): Promise<SparqlLanguageClient> {
    const qlueLs = await import("qlue-ls");
    await qlueLs.default();

    // Client -> server. Never close this: qlue-ls's read loop spins forever on
    // a closed stream because a `done` chunk carries no string to decode.
    const toServer = new TransformStream<string, string>();
    const client = new SparqlLanguageClient(toServer.writable.getWriter());

    // Server -> client.
    const fromServer = new WritableStream<string>({
      write: (chunk) => client.receive(chunk),
    });

    const server = qlueLs.init_language_server(fromServer.getWriter());
    void qlueLs.listen(server, toServer.readable.getReader());

    await client.request("initialize", {
      processId: null,
      clientInfo: { name: "sparql-playground" },
      rootUri: null,
      capabilities: {
        // Both flags are required for qlue-ls to auto-declare missing
        // prefixes: it checks `applyEdit` *and* `workspaceEdit.documentChanges`
        // before pushing a `workspace/applyEdit`.
        workspace: {
          applyEdit: true,
          workspaceEdit: { documentChanges: true },
        },
        textDocument: {
          synchronization: { dynamicRegistration: false },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ["markdown", "plaintext"],
            },
          },
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: { valueSet: ["quickfix", "refactor", "source"] },
            },
          },
          publishDiagnostics: {},
          formatting: {},
          hover: { contentFormat: ["markdown", "plaintext"] },
        },
      },
    });
    client.notify("initialized", {});

    return client;
  }

  /** Applies a server-pushed `workspace/applyEdit`. Set by the Monaco glue. */
  onApplyEdit: ((edits: LspTextEdit[]) => boolean) | undefined;

  private receive(raw: string) {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    // Server -> client request. qlue-ls uses this to declare prefixes the
    // query uses but never defined, without the user asking.
    if (message.method === "workspace/applyEdit" && message.id !== undefined) {
      const params = message.params as
        | { edit?: { changes?: Record<string, LspTextEdit[]> } }
        | undefined;
      const edits = params?.edit?.changes?.[DOCUMENT_URI] ?? [];
      const applied = edits.length > 0 && (this.onApplyEdit?.(edits) ?? false);

      this.send({ jsonrpc: "2.0", id: message.id, result: { applied } });
      return;
    }

    if (
      typeof message.id === "number" &&
      (message.result !== undefined || message.error !== undefined)
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
  }

  private send(payload: object) {
    void this.writer.write(JSON.stringify(payload));
  }

  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });

      // A wedged server must not leak a pending promise per keystroke.
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`qlue-ls did not answer ${method} in time`));
        }
      }, 10_000);
    });
  }

  /** Push the current text, but only when it actually changed. */
  sync(text: string) {
    if (text === this.lastText) {
      return;
    }
    this.lastText = text;
    this.version += 1;

    if (!this.opened) {
      this.opened = true;
      this.notify("textDocument/didOpen", {
        textDocument: {
          uri: DOCUMENT_URI,
          languageId: "sparql",
          version: this.version,
          text,
        },
      });
      return;
    }

    this.notify("textDocument/didChange", {
      textDocument: { uri: DOCUMENT_URI, version: this.version },
      contentChanges: [{ text }],
    });
  }

  /**
   * qlue-ls answers diagnostics on request rather than pushing
   * `publishDiagnostics`, so this is a pull.
   */
  async diagnose(): Promise<LspDiagnostic[]> {
    const report = (await this.request("textDocument/diagnostic", {
      textDocument: { uri: DOCUMENT_URI },
    })) as { kind?: string; items?: LspDiagnostic[] } | null;

    this.lastDiagnostics = report?.items ?? [];
    return this.lastDiagnostics;
  }

  /**
   * The diagnostics as qlue-ls sent them. Monaco markers cannot carry the LSP
   * `code`/`data` fields, and its code-action handler needs both to know which
   * prefix a fix refers to — so hand back the originals instead of rebuilding
   * them from markers.
   */
  diagnosticsIn(range: LspRange) {
    const overlaps = (diagnostic: LspDiagnostic) =>
      diagnostic.range.start.line <= range.end.line &&
      diagnostic.range.end.line >= range.start.line;

    return this.lastDiagnostics.filter(overlaps);
  }

  async complete(position: LspPosition, triggerCharacter?: string) {
    const result = (await this.request("textDocument/completion", {
      textDocument: { uri: DOCUMENT_URI },
      position,
      context: triggerCharacter
        ? { triggerKind: 2, triggerCharacter }
        : { triggerKind: 1 },
    })) as LspCompletionItem[] | { items?: LspCompletionItem[] } | null;

    if (!result) {
      return [];
    }

    return Array.isArray(result) ? result : (result.items ?? []);
  }

  async codeActions(range: LspRange, diagnostics: LspDiagnostic[]) {
    const result = (await this.request("textDocument/codeAction", {
      textDocument: { uri: DOCUMENT_URI },
      range,
      context: { diagnostics },
    })) as LspCodeAction[] | null;

    return result ?? [];
  }

  async format(options: { tabSize: number; insertSpaces: boolean }) {
    const result = (await this.request("textDocument/formatting", {
      textDocument: { uri: DOCUMENT_URI },
      options: {
        tabSize: options.tabSize,
        insertSpaces: options.insertSpaces,
      },
    })) as LspTextEdit[] | null;

    return result ?? [];
  }

  /**
   * Register a SPARQL endpoint so completions can use its prefix map. Sent as
   * a notification, per the `qlueLs/addBackend` handler.
   */
  addBackend(config: {
    name: string;
    url: string;
    prefixMap: Record<string, string>;
    makeDefault?: boolean;
  }) {
    if (!this.backends.has(config.name)) {
      this.backends.add(config.name);
      this.notify("qlueLs/addBackend", {
        name: config.name,
        url: config.url,
        prefixMap: config.prefixMap,
        default: config.makeDefault ?? false,
        // No completion templates: those would make qlue-ls fire SPARQL at the
        // endpoint while the user types, which is not ours to spend.
        queries: {},
      });
    }

    if (config.makeDefault) {
      this.notify("qlueLs/updateDefaultBackend", { backendName: config.name });
    }
  }
}

export type { SparqlLanguageClient };

/**
 * Vocabularies qlue-ls offers when completing a `PREFIX` declaration, and which
 * it uses to suggest compacting a full IRI. `schema:` is in there because the
 * bundled demo dataset uses it.
 */
export const COMMON_PREFIXES: Record<string, string> = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  schema: "http://schema.org/",
  foaf: "http://xmlns.com/foaf/0.1/",
  skos: "http://www.w3.org/2004/02/skos/core#",
  dc: "http://purl.org/dc/elements/1.1/",
  dcterms: "http://purl.org/dc/terms/",
  sh: "http://www.w3.org/ns/shacl#",
  geo: "http://www.opengis.net/ont/geosparql#",
  wgs: "http://www.w3.org/2003/01/geo/wgs84_pos#",
  prov: "http://www.w3.org/ns/prov#",
  void: "http://rdfs.org/ns/void#",
  vann: "http://purl.org/vocab/vann/",
  time: "http://www.w3.org/2006/time#",
  wd: "http://www.wikidata.org/entity/",
  wdt: "http://www.wikidata.org/prop/direct/",
  dbo: "http://dbpedia.org/ontology/",
  dbr: "http://dbpedia.org/resource/",
};

/**
 * Point the language server at the connection currently in use, so completion
 * and the "uncompacted IRI" hint know which prefixes are in play.
 */
export const configureBackend = async (name: string, url: string) => {
  try {
    const client = await getLanguageClient();
    client.addBackend({
      name,
      url,
      prefixMap: COMMON_PREFIXES,
      makeDefault: true,
    });
  } catch {
    // Completion simply stays keyword-only if the server never came up.
  }
};

let clientPromise: Promise<SparqlLanguageClient> | undefined;

/** Boot the language server once, lazily — the WASM payload is several MB. */
export const getLanguageClient = () => {
  if (!clientPromise) {
    clientPromise = SparqlLanguageClient.start().catch((error) => {
      // Let a later attempt retry rather than caching the failure forever.
      clientPromise = undefined;
      throw error;
    });
  }

  return clientPromise;
};

/* ------------------------------------------------------------ conversions */

const toMonacoRange = (range: LspRange) => ({
  startLineNumber: range.start.line + 1,
  startColumn: range.start.character + 1,
  endLineNumber: range.end.line + 1,
  endColumn: range.end.character + 1,
});

const completionKind = (monaco: Monaco, kind: number | undefined) => {
  const kinds = monaco.languages.CompletionItemKind;

  // LSP CompletionItemKind is 1-based and numbered differently from Monaco's,
  // so map by name instead of trusting the integers to line up.
  const byLspNumber: Record<number, languages.CompletionItemKind> = {
    1: kinds.Text,
    2: kinds.Method,
    3: kinds.Function,
    4: kinds.Constructor,
    5: kinds.Field,
    6: kinds.Variable,
    7: kinds.Class,
    8: kinds.Interface,
    9: kinds.Module,
    10: kinds.Property,
    11: kinds.Unit,
    12: kinds.Value,
    13: kinds.Enum,
    14: kinds.Keyword,
    15: kinds.Snippet,
    16: kinds.Color,
    17: kinds.File,
    18: kinds.Reference,
    19: kinds.Folder,
    20: kinds.EnumMember,
    21: kinds.Constant,
    22: kinds.Struct,
    23: kinds.Event,
    24: kinds.Operator,
    25: kinds.TypeParameter,
  };

  return kind !== undefined ? (byLspNumber[kind] ?? kinds.Text) : kinds.Text;
};

const markerSeverity = (monaco: Monaco, severity: number | undefined) => {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Info;
  }
};

const toMonacoCompletion = (
  monaco: Monaco,
  item: LspCompletionItem,
  fallbackRange: ReturnType<typeof toMonacoRange>
): languages.CompletionItem => {
  const edit = item.textEdit;
  const range =
    edit && "range" in edit
      ? toMonacoRange(edit.range)
      : edit && "replace" in edit
        ? toMonacoRange(edit.replace)
        : fallbackRange;

  const insertText = edit?.newText ?? item.insertText ?? item.label;

  return {
    label: item.label,
    kind: completionKind(monaco, item.kind),
    detail: item.detail,
    documentation:
      typeof item.documentation === "object"
        ? { value: item.documentation.value }
        : item.documentation,
    sortText: item.sortText,
    filterText: item.filterText,
    insertText,
    insertTextRules:
      item.insertTextFormat === 2
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    range,
  };
};

/* -------------------------------------------------------- monaco wiring */

let registered = false;

/**
 * Register SPARQL completion and formatting backed by qlue-ls. Safe to call
 * repeatedly; the providers are global to the Monaco instance.
 */
export const registerSparqlLanguageFeatures = (monaco: Monaco) => {
  if (registered) {
    return;
  }
  registered = true;

  monaco.languages.registerCompletionItemProvider("sparql", {
    // "?" and "$" start variables, ":" completes a prefixed name, "<" an IRI.
    triggerCharacters: [" ", "?", "$", ":", "<", "\n"],

    provideCompletionItems: async (
      model: editor.ITextModel,
      position: Position,
      context: languages.CompletionContext
    ) => {
      let client: SparqlLanguageClient;
      try {
        client = await getLanguageClient();
      } catch {
        return { suggestions: [] };
      }

      // Keep the server's copy exact before asking: notifications and requests
      // travel the same stream in order, so this cannot race.
      client.sync(model.getValue());

      const word = model.getWordUntilPosition(position);
      const fallbackRange = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      };

      try {
        const items = await client.complete(
          { line: position.lineNumber - 1, character: position.column - 1 },
          context.triggerCharacter
        );

        return {
          suggestions: items.map((item) =>
            toMonacoCompletion(monaco, item, fallbackRange)
          ),
        };
      } catch {
        return { suggestions: [] };
      }
    },
  });

  monaco.languages.registerCodeActionProvider("sparql", {
    provideCodeActions: async (
      model: editor.ITextModel,
      range: import("monaco-editor").Range
    ) => {
      let client: SparqlLanguageClient;
      try {
        client = await getLanguageClient();
      } catch {
        return { actions: [], dispose: () => {} };
      }

      client.sync(model.getValue());

      const lspRange = {
        start: {
          line: range.startLineNumber - 1,
          character: range.startColumn - 1,
        },
        end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
      };

      try {
        const actions = await client.codeActions(
          lspRange,
          client.diagnosticsIn(lspRange)
        );

        return {
          actions: actions.flatMap((action) => {
            const edits = action.edit?.changes?.[DOCUMENT_URI] ?? [];
            if (edits.length === 0) {
              return [];
            }

            return [
              {
                title: action.title,
                kind: action.kind ?? "quickfix",
                isPreferred: action.isPreferred,
                edit: {
                  edits: edits.map((edit) => ({
                    resource: model.uri,
                    versionId: undefined,
                    textEdit: {
                      range: toMonacoRange(edit.range),
                      text: edit.newText,
                    },
                  })),
                },
              },
            ];
          }),
          dispose: () => {},
        };
      } catch {
        return { actions: [], dispose: () => {} };
      }
    },
  });

  monaco.languages.registerDocumentFormattingEditProvider("sparql", {
    provideDocumentFormattingEdits: async (
      model: editor.ITextModel,
      options: languages.FormattingOptions
    ) => {
      let client: SparqlLanguageClient;
      try {
        client = await getLanguageClient();
      } catch {
        return [];
      }

      client.sync(model.getValue());

      try {
        const edits = await client.format({
          tabSize: options.tabSize,
          insertSpaces: options.insertSpaces,
        });

        return edits.map((edit) => ({
          range: toMonacoRange(edit.range),
          text: edit.newText,
        }));
      } catch {
        return [];
      }
    },
  });
};

/**
 * Keep one editor model in sync with the server and surface its diagnostics as
 * Monaco markers. Returns a disposer.
 */
export const attachDiagnostics = (
  monaco: Monaco,
  editorInstance: editor.IStandaloneCodeEditor
) => {
  const model = editorInstance.getModel();
  if (!model) {
    return () => {};
  }

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const publish = (diagnostics: LspDiagnostic[]) => {
    if (disposed || model.isDisposed()) {
      return;
    }

    monaco.editor.setModelMarkers(
      model,
      "qlue-ls",
      diagnostics.map((diagnostic) => ({
        ...toMonacoRange(diagnostic.range),
        message: diagnostic.message,
        severity: markerSeverity(monaco, diagnostic.severity),
        source: diagnostic.source ?? "qlue-ls",
      }))
    );
  };

  /**
   * qlue-ls pushes `workspace/applyEdit` off the back of a diagnostics run to
   * declare prefixes the query uses but never defined. Push it onto the undo
   * stack so a stray insertion is one Ctrl+Z away.
   */
  const applyEdit = (edits: LspTextEdit[]) => {
    if (disposed || model.isDisposed()) {
      return false;
    }

    model.pushEditOperations(
      null,
      edits.map((edit) => ({
        range: toMonacoRange(edit.range),
        text: edit.newText,
      })),
      () => null
    );

    return true;
  };

  const refresh = async () => {
    if (disposed || model.isDisposed()) {
      return;
    }

    try {
      const client = await getLanguageClient();
      if (disposed || model.isDisposed()) {
        return;
      }

      client.onApplyEdit = applyEdit;
      client.sync(model.getValue());
      publish(await client.diagnose());
    } catch {
      // Without the server the editor simply has no diagnostics.
    }
  };

  // Debounced: re-parsing on every keystroke is wasted work, and markers that
  // flicker while a token is half-typed are noise.
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => void refresh(), 300);
  };

  void refresh();
  const subscription = model.onDidChangeContent(schedule);

  return () => {
    disposed = true;
    if (timer) {
      clearTimeout(timer);
    }
    subscription.dispose();
    if (!model.isDisposed()) {
      monaco.editor.setModelMarkers(model, "qlue-ls", []);
    }
  };
};
