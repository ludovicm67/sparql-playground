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
