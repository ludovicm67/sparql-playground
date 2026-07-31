import { localName } from "../lib/explore";
import type { GraphNode } from "../lib/graph";
import { AlertIcon, CloseIcon } from "./icons";

type Props = {
  node: GraphNode;
  onClose: () => void;
};

/**
 * Literals are the leaves of the graph: nothing leads out of them and they have
 * no IRI to dereference. Selecting one used to do nothing at all, which reads
 * as a bug — so say what it is instead.
 */
const LiteralInspector: React.FC<Props> = ({ node, onClose }) => {
  const term = node.term;
  const language = term.type === "literal" ? term.lang : undefined;
  const datatype = term.type === "literal" ? term.datatype : undefined;

  return (
    <aside className="inspector" aria-label="Value details">
      <div className="panel-header">
        <span className="panel-title">Value</span>
        <div className="panel-header-actions">
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

      <div className="explore-list">
        <p className="literal-value">{term.value}</p>

        <dl className="literal-facts">
          <div>
            <dt>Kind</dt>
            <dd>{term.type === "bnode" ? "Blank node" : "Literal"}</dd>
          </div>
          {language ? (
            <div>
              <dt>Language</dt>
              <dd>{language}</dd>
            </div>
          ) : null}
          {datatype ? (
            <div>
              <dt>Datatype</dt>
              <dd data-tooltip={datatype}>{localName(datatype)}</dd>
            </div>
          ) : null}
        </dl>

        <p className="field-warning literal-note">
          <AlertIcon size={13} />
          {term.type === "bnode"
            ? "A blank node has no identity outside the query that found it, so it cannot be opened on its own."
            : "A value is not a resource: there is no IRI to dereference, so it has no page of its own."}
        </p>
      </div>
    </aside>
  );
};

export default LiteralInspector;
