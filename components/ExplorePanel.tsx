import { useCallback } from "react";
import {
  type ClassEntry,
  type InstanceEntry,
  localName,
  type NodeKind,
  type TermRef,
} from "../lib/explore";
import { nearBottom, usePagedQuery } from "../lib/usePagedQuery";
import {
  ChevronUpIcon,
  ChipIcon,
  CloudIcon,
  PlusIcon,
  QueryIcon,
  ResourceIcon,
} from "./icons";

type Row = {
  key: string;
  kind: NodeKind;
  term: TermRef;
  primary: string;
  secondary?: string;
  badge?: string;
  onOpen?: () => void;
  onDereference?: () => void;
};

const setDragPayload = (event: React.DragEvent, row: Row) => {
  event.dataTransfer.setData(
    "application/x-sparql-term",
    JSON.stringify({ kind: row.kind, term: row.term })
  );
  event.dataTransfer.effectAllowed = "copy";
};

type ListProps = {
  load: (offset: number) => Promise<Row[]>;
  pageSize: number;
  emptyMessage: string;
  onAdd: (row: Row) => void;
  onSelectRow?: (row: Row) => void;
};

/** One scrollable, lazily-paged list of draggable rows. */
const RowList: React.FC<ListProps> = ({
  load,
  pageSize,
  emptyMessage,
  onAdd,
  onSelectRow,
}) => {
  const { items, loading, error, exhausted, loadMore } = usePagedQuery(load, pageSize);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (nearBottom(event.currentTarget)) {
      loadMore();
    }
  };

  return (
    <div className="explore-list" onScroll={handleScroll}>
      {error ? (
        <div className="explore-error" role="alert">
          {error}
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <p className="sidebar-empty">{emptyMessage}</p>
      ) : null}

      <ul className="explore-rows">
        {items.map((row) => (
          <li key={row.key}>
            <div className="explore-row" draggable onDragStart={(e) => setDragPayload(e, row)}>
              <button
                className="explore-row-main"
                type="button"
                onClick={() => onSelectRow?.(row)}
                disabled={!onSelectRow}
                title={row.term.type === "uri" ? row.term.value : row.primary}
              >
                <span className="explore-row-icon">
                  {row.kind === "class" ? <ChipIcon size={13} /> : <CloudIcon size={13} />}
                </span>
                <span className="explore-row-text">
                  <span className="explore-row-primary">{row.primary}</span>
                  {row.secondary ? (
                    <span className="explore-row-secondary">{row.secondary}</span>
                  ) : null}
                </span>
                {row.badge ? <span className="explore-count">{row.badge}</span> : null}
              </button>

              <div className="explore-row-actions">
                <button
                  className="icon-btn"
                  type="button"
                  onClick={() => onAdd(row)}
                  aria-label={`Add ${row.primary} to the canvas`}
                  title="Add to the canvas"
                >
                  <PlusIcon size={13} />
                </button>
                {row.onDereference ? (
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={row.onDereference}
                    aria-label={`Open ${row.primary} as a resource`}
                    title="Open as a resource"
                  >
                    <ResourceIcon size={13} />
                  </button>
                ) : null}
                {row.onOpen ? (
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={row.onOpen}
                    aria-label={`Open a query for ${row.primary}`}
                    title="Open as a query"
                  >
                    <QueryIcon size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {loading ? <p className="explore-loading">Loading…</p> : null}
      {!loading && !exhausted && items.length > 0 ? (
        <button className="btn-ghost explore-more" type="button" onClick={loadMore}>
          Load more
        </button>
      ) : null}
    </div>
  );
};

type Props = {
  classPageSize: number;
  instancePageSize: number;
  openedClass: ClassEntry | undefined;
  loadClasses: (offset: number) => Promise<ClassEntry[]>;
  loadInstances: (classIri: string, offset: number) => Promise<InstanceEntry[]>;
  onOpenClass: (entry: ClassEntry | undefined) => void;
  onAddTerm: (kind: NodeKind, term: TermRef) => void;
  onQueryClass: (classIri: string) => void;
  onQueryInstance: (iri: string) => void;
  onOpenResource: (iri: string) => void;
};

const ExplorePanel: React.FC<Props> = ({
  classPageSize,
  instancePageSize,
  openedClass,
  loadClasses,
  loadInstances,
  onOpenClass,
  onAddTerm,
  onQueryClass,
  onQueryInstance,
  onOpenResource,
}) => {
  const classRows = useCallback(
    async (offset: number): Promise<Row[]> =>
      (await loadClasses(offset)).map((entry) => ({
        key: entry.iri,
        kind: "class" as const,
        term: { type: "uri" as const, value: entry.iri },
        primary: entry.label ?? localName(entry.iri),
        secondary: entry.iri,
        badge: entry.count === undefined ? undefined : entry.count.toLocaleString(),
        onOpen: () => onQueryClass(entry.iri),
        onDereference: () => onOpenResource(entry.iri),
      })),
    [loadClasses, onQueryClass, onOpenResource]
  );

  const instanceRows = useCallback(
    async (offset: number): Promise<Row[]> => {
      if (!openedClass) {
        return [];
      }

      return (await loadInstances(openedClass.iri, offset)).map((entry) => ({
        key: entry.iri,
        kind: "instance" as const,
        term: { type: "uri" as const, value: entry.iri },
        primary: entry.label ?? localName(entry.iri),
        secondary: entry.iri,
        onOpen: () => onQueryInstance(entry.iri),
        onDereference: () => onOpenResource(entry.iri),
      }));
    },
    [loadInstances, openedClass, onQueryInstance, onOpenResource]
  );

  return (
    <section className="panel explore-panel" aria-label="Explore">
      <div className="panel-header">
        {openedClass ? (
          <button
            className="explore-back"
            type="button"
            onClick={() => onOpenClass(undefined)}
          >
            <ChevronUpIcon size={13} />
            <span className="panel-title">Classes</span>
          </button>
        ) : (
          <span className="panel-title">Classes</span>
        )}
      </div>

      {openedClass ? (
        <div className="explore-context" title={openedClass.iri}>
          <ChipIcon size={13} />
          <span>{localName(openedClass.iri)}</span>
          {openedClass.count === undefined ? null : (
            <span className="explore-count">
              {openedClass.count.toLocaleString()}
            </span>
          )}
        </div>
      ) : null}

      {openedClass ? (
        <RowList
          key={`instances:${openedClass.iri}`}
          load={instanceRows}
          pageSize={instancePageSize}
          emptyMessage="This class has no instances."
          onAdd={(row) => onAddTerm(row.kind, row.term)}
        />
      ) : (
        <RowList
          key="classes"
          load={classRows}
          pageSize={classPageSize}
          emptyMessage="No classes found. The endpoint may use no rdf:type statements."
          onAdd={(row) => onAddTerm(row.kind, row.term)}
          onSelectRow={(row) =>
            onOpenClass({
              iri: row.term.value,
              count: row.badge ? Number(row.badge.replace(/[^\d]/g, "")) : undefined,
            })
          }
        />
      )}
    </section>
  );
};

export default ExplorePanel;
