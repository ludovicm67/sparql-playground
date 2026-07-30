import { useCallback, useEffect, useRef, useState } from "react";
import type * as oxigraph from "oxigraph/web";
import { Connection } from "../lib/connections";
import { isSafeIri, labelsQuery, localName, parseLabels, TermRef } from "../lib/explore";
import {
  parseResource,
  ResourceDetails,
  ResourceProperty,
  resourceIris,
  resourceQuery,
  withLabels,
} from "../lib/resources";
import { runQuery } from "../lib/sparql";
import {
  AlertIcon,
  ChipIcon,
  GraphIcon,
  QueryIcon,
  ShareIcon,
  SpinnerIcon,
} from "./icons";

type Props = {
  connection: Connection;
  store: oxigraph.Store | undefined;
  hidden?: boolean;
  uri: string;
  onUriChange: (uri: string) => void;
  onLoaded: (uri: string, details: ResourceDetails | undefined) => void;
  onOpenQuery: (query: string) => void;
  onAddToCanvas: (uri: string) => void;
  onShare: () => void;
};

const TermValue: React.FC<{
  value: { term: TermRef; label?: string };
  onOpen: (uri: string) => void;
}> = ({ value, onOpen }) => {
  const { term } = value;

  if (term.type === "uri") {
    return (
      <button
        className="resource-link"
        type="button"
        onClick={() => onOpen(term.value)}
        title={term.value}
      >
        <span className="resource-link-label">
          {value.label ?? localName(term.value)}
        </span>
        <span className="resource-link-iri">{term.value}</span>
      </button>
    );
  }

  if (term.type === "bnode") {
    return <span className="term term-bnode">_:{term.value}</span>;
  }

  const note = term.lang
    ? `@${term.lang}`
    : term.datatype && !term.datatype.endsWith("#string")
      ? `^^${localName(term.datatype)}`
      : undefined;

  return (
    <span className="term term-literal resource-literal">
      {term.value}
      {note ? (
        <span className="term-note" title={term.datatype}>
          {note}
        </span>
      ) : null}
    </span>
  );
};

const PropertyTable: React.FC<{
  title: string;
  hint: string;
  properties: ResourceProperty[];
  onOpen: (uri: string) => void;
}> = ({ title, hint, properties, onOpen }) => {
  if (properties.length === 0) {
    return null;
  }

  return (
    <section className="resource-section">
      <h3 className="resource-section-title">
        {title}
        <span className="explore-count">{properties.length}</span>
      </h3>
      <p className="resource-section-hint">{hint}</p>

      <dl className="resource-properties">
        {properties.map((property) => (
          <div className="resource-property" key={property.predicate}>
            <dt title={property.predicate}>
              {property.label ?? localName(property.predicate)}
              {property.values.length > 1 ? (
                <span className="explore-count">{property.values.length}</span>
              ) : null}
            </dt>
            <dd>
              {property.values.map((value, index) => (
                <TermValue key={index} value={value} onOpen={onOpen} />
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
};

const ResourceView: React.FC<Props> = ({
  connection,
  store,
  hidden,
  uri,
  onUriChange,
  onLoaded,
  onOpenQuery,
  onAddToCanvas,
  onShare,
}) => {
  const [draft, setDraft] = useState(uri);
  const [details, setDetails] = useState<ResourceDetails | undefined>();
  const [error, setError] = useState<string | undefined>();
  // The parent keys this component on the IRI, so a fresh one mounts fresh:
  // if there is something to fetch, we are already loading.
  const [loading, setLoading] = useState(() => Boolean(uri && isSafeIri(uri)));
  const [reloadToken, setReloadToken] = useState(0);

  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  const valid = isSafeIri(draft.trim());

  /** Fetch and shape a resource. State handling lives at the call sites. */
  const load = useCallback(
    async (target: string) => {
      const parsed = parseResource(
        target,
        await runQuery(connection, resourceQuery(target), store)
      );

      // Labels are a nicety; a failure here should not lose the resource.
      try {
        const labels = parseLabels(
          await runQuery(connection, labelsQuery(resourceIris(parsed)), store)
        );
        return withLabels(parsed, labels);
      } catch {
        return parsed;
      }
    },
    [connection, store]
  );

  useEffect(() => {
    if (!uri || !isSafeIri(uri)) {
      return;
    }

    let active = true;

    // Every state update below sits after an await, so mounting does not
    // cascade a synchronous re-render.
    void (async () => {
      try {
        const fetched = await load(uri);
        if (!active) {
          return;
        }
        setDetails(fetched);
        setError(undefined);
        onLoadedRef.current(uri, fetched);
      } catch (failure) {
        if (!active) {
          return;
        }
        setDetails(undefined);
        setError(failure instanceof Error ? failure.message : String(failure));
        onLoadedRef.current(uri, undefined);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [uri, load, reloadToken]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const target = draft.trim();
    if (!isSafeIri(target)) {
      return;
    }

    if (target === uri) {
      // Same IRI: nothing for the parent to change, so re-run explicitly.
      setLoading(true);
      setReloadToken((token) => token + 1);
    } else {
      onUriChange(target);
    }
  };

  return (
    <main className="workspace workspace--resource" hidden={hidden}>
      <section className="panel resource-panel" aria-label="Resource">
        <div className="panel-header">
          <form className="resource-form" onSubmit={submit}>
            <input
              className="input resource-input"
              value={draft}
              placeholder="http://example.org/resource"
              inputMode="url"
              spellCheck={false}
              aria-label="Resource IRI"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="btn-run" type="submit" disabled={!valid || loading}>
              {loading ? <SpinnerIcon /> : null}
              {loading ? "Loading…" : "Dereference"}
            </button>
          </form>

          <div className="panel-header-actions">
            <button
              className="icon-btn"
              type="button"
              onClick={() => onOpenQuery(resourceQuery(uri || draft.trim()))}
              disabled={!valid}
              aria-label="Open as a query"
              title="Open the query behind this page"
            >
              <QueryIcon size={14} />
            </button>
            <button
              className="icon-btn"
              type="button"
              onClick={() => onAddToCanvas(uri || draft.trim())}
              disabled={!valid}
              aria-label="Add to the canvas"
              title="Add this resource to the Explore canvas"
            >
              <GraphIcon size={14} />
            </button>
            <button
              className="icon-btn"
              type="button"
              onClick={onShare}
              disabled={!valid}
              aria-label="Share this resource"
              title="Get a link to this resource"
            >
              <ShareIcon size={14} />
            </button>
          </div>
        </div>

        <div className="panel-body resource-body">
          {draft && !valid ? (
            <div className="explore-error" role="alert">
              That is not a usable IRI. It must be absolute and contain no
              spaces, angle brackets or quotes.
            </div>
          ) : null}

          {error ? (
            <div className="error-box" role="alert">
              <AlertIcon size={17} />
              <div>
                <p className="error-title">Could not load the resource</p>
                <p className="error-message">{error}</p>
              </div>
            </div>
          ) : null}

          {loading && !details ? (
            <div className="state">
              <SpinnerIcon size={26} />
              <p className="state-title">Fetching…</p>
            </div>
          ) : null}

          {!uri && !loading && !error ? (
            <div className="state">
              <ChipIcon size={30} />
              <p className="state-title">No resource yet</p>
              <p className="state-hint">
                Paste an IRI above, or open one from a query result, the Explore
                panel or a canvas node.
              </p>
            </div>
          ) : null}

          {details ? (
            <article className="resource">
              <header className="resource-header">
                <h2 className="resource-title">
                  {details.label ?? localName(details.uri)}
                </h2>
                <p className="resource-iri">{details.uri}</p>

                {details.types.length > 0 ? (
                  <div className="resource-types">
                    {details.types.map((type) => (
                      <button
                        key={type.iri}
                        className="chip"
                        type="button"
                        title={type.iri}
                        onClick={() => onUriChange(type.iri)}
                      >
                        {type.label ?? localName(type.iri)}
                      </button>
                    ))}
                  </div>
                ) : null}

                <p className="resource-meta">
                  {details.statements}{" "}
                  {details.statements === 1 ? "statement" : "statements"}
                  {details.truncated ? " (truncated)" : ""}
                </p>

                {details.truncated ? (
                  <p className="field-warning">
                    <AlertIcon size={13} />
                    Only the first {details.statements} statements are shown. Open
                    the query to raise the limit.
                  </p>
                ) : null}
              </header>

              {details.outgoing.length === 0 && details.incoming.length === 0 ? (
                <p className="sidebar-empty">
                  The endpoint knows nothing about this IRI.
                </p>
              ) : null}

              <PropertyTable
                title="Properties"
                hint="Statements where this resource is the subject."
                properties={details.outgoing}
                onOpen={onUriChange}
              />
              <PropertyTable
                title="Referenced by"
                hint="Statements where this resource is the object."
                properties={details.incoming}
                onOpen={onUriChange}
              />
            </article>
          ) : null}
        </div>
      </section>
    </main>
  );
};

export default ResourceView;
