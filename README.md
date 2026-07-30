# SPARQL playground

This is a playground for SPARQL queries, running fully in the browser.
The editor is based on Monaco.

It ships with a small demo dataset served by [Oxigraph] compiled to
WebAssembly, and it can also query **external SPARQL endpoints**.

## Connections

The left panel holds the list of connections:

- **TBBT (Oxigraph in browser)** — the built-in store. It needs no network and
  cannot be deleted.
- **Any SPARQL endpoint** you add yourself. For each one you can pick how the
  query is sent (form-encoded `POST`, `POST` with an `application/sparql-query`
  body, or `GET`), add custom headers, and set basic-auth credentials.
  **Try connection** probes the endpoint with `ASK {}`, the cheapest query that
  still proves it speaks SPARQL.

Connections and the per-connection query history are kept in the browser's
local storage, and **Clear all stored data** wipes them. Nothing is ever sent
anywhere except to the endpoint you are querying.

> [!WARNING]
> Basic-auth credentials are stored in local storage in plain text and sent on
> every request to that endpoint. Do not reuse a password you care about.

Because queries are issued straight from the browser, an external endpoint has
to send CORS headers (`Access-Control-Allow-Origin`) for this site, and a plain
`http://` endpoint cannot be reached from the `https://` deployment. The app
says so explicitly when a request fails that way.

[Oxigraph]: https://github.com/oxigraph/oxigraph

## Explore mode

The **Explore** tab swaps the editor for a browser and a canvas, against the
same connection.

On the left, every class in the dataset with its instance count; open one to
page through its instances. Both lists load more as you scroll. Each row has a
button to open the matching query back in **Query** mode.

Drag a class or an instance onto the canvas — or use its **+**. Dropping an IRI
asks the endpoint how it relates to what is already there, in both directions,
and draws the predicates it finds. Between classes it also looks for
*schema-level* links: a predicate whose subjects are instances of one class and
whose objects are instances of another.

Click a node to list its predicates, then a predicate to list its values. Tick
any of them — or **Select all** — to drop them onto the canvas, already wired to
the node they came from. Literals land as nodes too.

Drag nodes to arrange them, drag the background to pan, scroll to zoom, and use
the percentage in the header to reset the view. The **tidy** button runs a
force-directed layout and fits the result to the window; it starts from where
the nodes already are, so running it twice settles rather than reshuffles.

### Canvases

Each connection has its own set of canvases, listed as tabs above the graph.
Add one with **+**, click the active tab to rename it, and use its **×** to
delete it. Everything — node positions, zoom, which tab was open — is saved in
this browser per connection, so it is all still there after a reload.

Emptying a canvas drops its stored entry, deleting a connection takes its
canvases with it, and **Clear all stored data** removes them all.

The share button on a canvas produces a link that carries the whole graph, its
layout and its name, alongside the endpoint — the same fragment-based link
described below. Opening it adds the canvas as a new tab rather than replacing
anything. Large canvases make long links, and the dialog says so when one gets
long enough that chat clients are likely to cut it.

Every explore query is bounded with `LIMIT`, and the canvas asks nothing of the
endpoint until you interact with it. Two caveats on large public endpoints: the
class list is a `GROUP BY` over every typed subject, and the schema-level link
query is the most expensive thing here — both can be slow, and a failure leaves
the canvas without those edges rather than breaking it.

## Editor intelligence

The editor is backed by [Qlue-ls], a SPARQL language server compiled to
WebAssembly, so all of this runs in the browser with no language server to host:

- **Completion** that follows the grammar — query forms at the start, `DISTINCT`
  after `SELECT`, `FILTER` / `OPTIONAL` / `BIND` inside a `WHERE`, solution
  modifiers after it. Press <kbd>Ctrl</kbd>+<kbd>Space</kbd> to invoke it.
- **Prefixes declare themselves.** Write `foaf:name` and the matching
  `PREFIX foaf: <http://xmlns.com/foaf/0.1/>` is inserted for you. A prefix the
  playground does not know is left alone and flagged instead of guessed at.
- **Diagnostics** for syntax errors, undeclared prefixes, unused declarations
  and IRIs that could be shortened.
- **Quick fixes** on those diagnostics (<kbd>Ctrl</kbd>+<kbd>.</kbd>), such as
  replacing a full IRI with its prefixed form.
- **Formatting**, via the button in the query panel or
  <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>.

The known prefixes are listed in `COMMON_PREFIXES` in
[lib/languageServer.ts](lib/languageServer.ts) — add your own vocabularies
there.

The language server loads lazily and in the background: the editor is usable
immediately and gains these features a moment later. Qlue-ls can also draw
completions from the endpoint itself (real subjects and predicates), but that
needs per-engine completion queries and would fire SPARQL at the endpoint as you
type, so it is deliberately left off.

[Qlue-ls]: https://github.com/IoannisNezis/qlue-ls

## Sharing a query

The **Share** button in the query panel builds a link that carries the query and
the connection it runs against. Everything is packed into the URL *fragment*
(after the `#`), which browsers never send to a server — so the link works on a
static host and its contents stay between you and whoever you send it to.

Opening a shared link:

- if the endpoint is already in the recipient's list, their own connection is
  used, credentials and all;
- otherwise the connection is added to their list and selected.

When the connection has custom headers or basic auth, sharing asks whether to
include them. It does **not** by default: the link then carries only the
endpoint, and the recipient has to fill in the credentials themselves before the
query will run. The app tells them so when they open it.

> [!WARNING]
> Choosing to include credentials puts them in the link in plain sight
> (base64 is encoding, not encryption). Anyone with the link can query that
> endpoint as you, and it will persist in chat logs, mail and browser history.

## Start it locally

```sh
# Install required dependencies
npm install

# Start the development server
npm run dev
```

And then open your browser at http://localhost:3000/

## Generate static content

To generate the static content, run the following command:

```sh
npm run build
```

And it would be available in the `out` directory.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
