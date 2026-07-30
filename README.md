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
