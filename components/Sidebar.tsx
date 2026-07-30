import { Connection, describeConnection, isLocal } from "../lib/connections";
import {
  formatRelativeTime,
  HistoryEntry,
  summarizeQuery,
} from "../lib/history";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ChipIcon,
  CloudIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "./icons";

type Props = {
  connections: Connection[];
  activeId: string;
  history: HistoryEntry[];
  /** Passed in so relative timestamps stay stable within a render pass. */
  now: number;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onSelectHistoryEntry: (entry: HistoryEntry) => void;
  onDeleteHistoryEntry: (entry: HistoryEntry) => void;
  onClearHistory: () => void;
  onClearStoredData: () => void;
};

const Sidebar: React.FC<Props> = ({
  connections,
  activeId,
  history,
  now,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onMove,
  onSelectHistoryEntry,
  onDeleteHistoryEntry,
  onClearHistory,
  onClearStoredData,
}) => (
  <aside className="sidebar" aria-label="Connections and history">
    <section className="sidebar-section">
      <div className="sidebar-heading">
        <span className="panel-title">Connections</span>
        <button
          className="icon-btn"
          type="button"
          onClick={onCreate}
          aria-label="Add a connection"
          title="Add a connection"
        >
          <PlusIcon />
        </button>
      </div>

      <ul className="connection-list">
        {connections.map((connection, index) => {
          const active = connection.id === activeId;

          return (
            <li key={connection.id}>
              <div className={`connection${active ? " is-active" : ""}`}>
                <button
                  className="connection-main"
                  type="button"
                  onClick={() => onSelect(connection.id)}
                  aria-current={active}
                >
                  <span className="connection-icon">
                    {isLocal(connection) ? <ChipIcon /> : <CloudIcon />}
                  </span>
                  <span className="connection-text">
                    <span className="connection-name">{connection.name}</span>
                    <span className="connection-detail">
                      {describeConnection(connection)}
                    </span>
                  </span>
                </button>

                <div className="connection-actions">
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => onMove(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${connection.name} up`}
                    title="Move up"
                  >
                    <ChevronUpIcon size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => onMove(index, 1)}
                    disabled={index === connections.length - 1}
                    aria-label={`Move ${connection.name} down`}
                    title="Move down"
                  >
                    <ChevronDownIcon size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => onEdit(connection)}
                    disabled={isLocal(connection)}
                    aria-label={`Edit ${connection.name}`}
                    title={
                      isLocal(connection)
                        ? "The built-in store has nothing to configure"
                        : "Edit"
                    }
                  >
                    <PencilIcon size={13} />
                  </button>
                  <button
                    className="icon-btn is-danger"
                    type="button"
                    onClick={() => onDelete(connection)}
                    disabled={isLocal(connection)}
                    aria-label={`Delete ${connection.name}`}
                    title={
                      isLocal(connection)
                        ? "The built-in store cannot be deleted"
                        : "Delete"
                    }
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>

    <section className="sidebar-section sidebar-section--history">
      <div className="sidebar-heading">
        <span className="panel-title">
          <HistoryIcon size={12} /> History
        </span>
        {history.length > 0 ? (
          <button className="btn-link" type="button" onClick={onClearHistory}>
            Clear
          </button>
        ) : null}
      </div>

      {history.length === 0 ? (
        <p className="sidebar-empty">
          Queries you run against this connection show up here.
        </p>
      ) : (
        <ul className="history-list">
          {history.map((entry) => (
            <li key={entry.id}>
              <div className={`history${entry.status === "error" ? " is-error" : ""}`}>
                <button
                  className="history-main"
                  type="button"
                  onClick={() => onSelectHistoryEntry(entry)}
                  title={`Load this query into the editor:\n\n${entry.query}`}
                >
                  <span className="history-query">{summarizeQuery(entry.query)}</span>
                  <span className="history-meta">
                    {entry.status === "error"
                      ? "failed"
                      : entry.rows === null
                        ? "boolean"
                        : `${entry.rows} ${entry.rows === 1 ? "row" : "rows"}`}
                    <span className="history-dot">·</span>
                    {formatRelativeTime(entry.at, now)}
                  </span>
                </button>
                <button
                  className="icon-btn is-danger"
                  type="button"
                  onClick={() => onDeleteHistoryEntry(entry)}
                  aria-label="Remove from history"
                  title="Remove from history"
                >
                  <TrashIcon size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>

    <footer className="sidebar-footer">
      <button className="btn-link is-danger" type="button" onClick={onClearStoredData}>
        Clear all stored data
      </button>
      <p className="sidebar-note">
        Connections and history live in this browser only.
      </p>
    </footer>
  </aside>
);

export default Sidebar;
