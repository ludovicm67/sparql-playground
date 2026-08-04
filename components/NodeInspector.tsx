import { useCallback, useState } from "react";
import {
  displayTerm,
  isReferenceable,
  localName,
  type LinkDirection,
  type ObjectEntry,
  type PredicateEntry,
  termKey,
  type TermRef,
} from "../lib/explore";
import { type GraphNode } from "../lib/graph";
import { nearBottom, usePagedQuery } from "../lib/usePagedQuery";
import {
  ChevronUpIcon,
  ChipIcon,
  CloseIcon,
  CloudIcon,
  PlusIcon,
  QueryIcon,
  ResourceIcon,
  ArrowIcon,
} from "./icons";

type Props = {
  node: GraphNode;
  objectPageSize: number;
  loadPredicates: () => Promise<PredicateEntry[]>;
  loadObjects: (
    predicate: string,
    offset: number,
    direction: LinkDirection
  ) => Promise<ObjectEntry[]>;
  onAddObjects: (
    predicate: string,
    terms: TermRef[],
    direction: LinkDirection
  ) => void;
  onQueryNode: () => void;
  onOpenResource: () => void;
  onClose: () => void;
};

const DIRECTIONS: { key: LinkDirection; title: string; hint: string; empty: string }[] = [
  {
    key: "out",
    title: "Points at",
    hint: "Statements where this node is the subject.",
    empty: "Nothing links out of this node.",
  },
  {
    key: "in",
    title: "Pointed at by",
    hint: "Statements where this node is the object.",
    empty: "Nothing links to this node.",
  },
];

const PredicateList: React.FC<{
  load: () => Promise<PredicateEntry[]>;
  onPick: (predicate: PredicateEntry) => void;
}> = ({ load, onPick }) => {
  const loadPage = useCallback(
    async (offset: number) => (offset === 0 ? load() : []),
    [load]
  );
  const { items, loading, error } = usePagedQuery(loadPage, Number.MAX_SAFE_INTEGER);

  return (
    <div className="explore-list">
      {error ? (
        <div className="explore-error" role="alert">
          {error}
        </div>
      ) : null}

      {DIRECTIONS.map((group) => {
        const inGroup = items.filter((entry) => entry.direction === group.key);

        // An empty outgoing list is worth saying out loud; an empty incoming
        // one only when there is nothing at all, or every leaf node would
        // carry the same redundant line.
        if (inGroup.length === 0 && (group.key === "in" || items.length > 0)) {
          return loading || items.length > 0 ? null : (
            <p className="sidebar-empty" key={group.key}>
              {group.empty}
            </p>
          );
        }

        return (
          <section className="predicate-group" key={group.key}>
            <h4 className={`predicate-group-title is-${group.key}`}>
              <ArrowIcon size={12} direction={group.key} />
              {group.title}
              <span className="explore-count">{inGroup.length}</span>
            </h4>
            <p className="predicate-group-hint">{group.hint}</p>

            <ul className="explore-rows">
              {inGroup.map((predicate) => (
                <li key={`${group.key}:${predicate.iri}`}>
                  <div className="explore-row">
                    <button
                      className="explore-row-main"
                      type="button"
                      onClick={() => onPick(predicate)}
                      data-tooltip={predicate.iri}
                    >
                      <span className="explore-row-text">
                        <span className="explore-row-primary">
                          {localName(predicate.iri)}
                        </span>
                        <span className="explore-row-secondary">{predicate.iri}</span>
                      </span>
                      {predicate.count === undefined ? null : (
                        <span className="explore-count">
                          {predicate.count.toLocaleString()}
                        </span>
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {!loading && !error && items.length === 0 ? (
        <p className="sidebar-empty">Nothing links to or from this node.</p>
      ) : null}

      {loading ? <p className="explore-loading">Loading…</p> : null}
    </div>
  );
};

const ObjectList: React.FC<{
  predicate: PredicateEntry;
  pageSize: number;
  load: (offset: number) => Promise<ObjectEntry[]>;
  onAdd: (terms: TermRef[], direction: LinkDirection) => void;
}> = ({ predicate, pageSize, load, onAdd }) => {
  const { items, loading, error, exhausted, loadMore } = usePagedQuery(load, pageSize);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const addable = items.filter((item) => isReferenceable(item.term));
  const allSelected = addable.length > 0 && selected.size === addable.length;

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const toggleAll = () =>
    setSelected(
      allSelected ? new Set() : new Set(addable.map((item) => termKey(item.term)))
    );

  const addSelected = () => {
    const terms = addable
      .filter((item) => selected.has(termKey(item.term)))
      .map((item) => item.term);

    if (terms.length > 0) {
      onAdd(terms, predicate.direction);
      setSelected(new Set());
    }
  };

  return (
    <>
      <div className="explore-list" onScroll={(e) => nearBottom(e.currentTarget) && loadMore()}>
        {error ? (
          <div className="explore-error" role="alert">
            {error}
          </div>
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <p className="sidebar-empty">Nothing on the other end of this predicate.</p>
        ) : null}

        {addable.length > 0 ? (
          <label className="checkbox explore-select-all">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span>
              Select all {exhausted ? "" : "loaded "}({addable.length})
            </span>
          </label>
        ) : null}

        <ul className="explore-rows">
          {items.map((item) => {
            const key = termKey(item.term);
            const canAdd = isReferenceable(item.term);

            return (
              <li key={key}>
                <label
                  className={`explore-row explore-object${canAdd ? "" : " is-disabled"}`}
                  data-tooltip={item.term.value}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    disabled={!canAdd}
                    onChange={() => toggle(key)}
                  />
                  <span className="explore-row-text">
                    <span
                      className={`explore-row-primary term-${
                        item.term.type === "uri" ? "uri" : "literal"
                      }`}
                    >
                      {displayTerm(item.term)}
                    </span>
                    {item.term.type === "uri" ? (
                      <span className="explore-row-secondary">{item.term.value}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {loading ? <p className="explore-loading">Loading…</p> : null}
        {!loading && !exhausted && items.length > 0 ? (
          <button className="btn-ghost explore-more" type="button" onClick={loadMore}>
            Load more
          </button>
        ) : null}
      </div>

      <div className="inspector-footer">
        <button
          className="btn-run"
          type="button"
          onClick={addSelected}
          disabled={selected.size === 0}
        >
          <PlusIcon size={13} />
          Add {selected.size > 0 ? selected.size : ""} to canvas
        </button>
        <span className="field-hint">
          {predicate.direction === "in" ? "pointing here via " : "via "}
          {localName(predicate.iri)}
        </span>
      </div>
    </>
  );
};

const NodeInspector: React.FC<Props> = ({
  node,
  objectPageSize,
  loadPredicates,
  loadObjects,
  onAddObjects,
  onQueryNode,
  onOpenResource,
  onClose,
}) => {
  const [predicate, setPredicate] = useState<PredicateEntry | undefined>();

  const objects = useCallback(
    (offset: number) =>
      loadObjects(predicate?.iri ?? "", offset, predicate?.direction ?? "out"),
    [loadObjects, predicate]
  );

  return (
    <aside className="inspector" aria-label="Node details">
      <div className="panel-header">
        {predicate ? (
          <button
            className="explore-back"
            type="button"
            onClick={() => setPredicate(undefined)}
          >
            <ChevronUpIcon size={13} />
            <span className="panel-title">Predicates</span>
          </button>
        ) : (
          <span className="panel-title">Predicates</span>
        )}

        <div className="panel-header-actions">
          {node.term.type === "uri" ? (
            <>
              <button
                className="icon-btn"
                type="button"
                onClick={onOpenResource}
                aria-label="Open as a resource"
                data-tooltip="Open as a resource"
              >
                <ResourceIcon size={13} />
              </button>
              <button
                className="icon-btn"
                type="button"
                onClick={onQueryNode}
                aria-label="Open as a query"
                data-tooltip="Open as a query"
              >
                <QueryIcon size={13} />
              </button>
            </>
          ) : null}
          <button
            className="icon-btn"
            type="button"
            onClick={onClose}
            aria-label="Close the inspector"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      </div>

      <div className="explore-context" data-tooltip={node.term.value}>
        {node.kind === "class" ? <ChipIcon size={13} /> : <CloudIcon size={13} />}
        <span>{node.label ?? displayTerm(node.term)}</span>
      </div>

      {predicate ? (
        <>
          <div className="inspector-predicate" data-tooltip={predicate.iri}>
            {localName(predicate.iri)}
          </div>
          <ObjectList
            key={`${node.id}:${predicate.iri}`}
            predicate={predicate}
            pageSize={objectPageSize}
            load={objects}
            onAdd={(terms, direction) =>
              onAddObjects(predicate.iri, terms, direction)
            }
          />
        </>
      ) : (
        <PredicateList key={node.id} load={loadPredicates} onPick={setPredicate} />
      )}
    </aside>
  );
};

export default NodeInspector;
