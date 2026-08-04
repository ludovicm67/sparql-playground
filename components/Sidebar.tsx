import { type Connection, describeConnection, isLocal } from "../lib/connections";
import {
  formatRelativeTime,
  type HistoryEntry,
  summarizeQuery,
} from "../lib/history";
import { localName } from "../lib/explore";
import { type ResourceEntry } from "../lib/resources";
import {
  AUTHOR_URL,
  COMMIT_DIRTY,
  COMMIT_SHA,
  COMMIT_URL,
  SHORT_SHA,
} from "../lib/build";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ChipIcon,
  CommitIcon,
  CloudIcon,
  HistoryIcon,
  PencilIcon,
  ResourceIcon,
  PlusIcon,
  TrashIcon,
} from "./icons";

type Props = {
  connections: Connection[];
  activeId: string;
  history: HistoryEntry[];
  resourceHistory: ResourceEntry[];
  /** Explore and Query share the query history; Resource has its own. */
  showResources: boolean;
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
  onSelectResource: (entry: ResourceEntry) => void;
  onDeleteResource: (entry: ResourceEntry) => void;
  onClearResources: () => void;
  onClearStoredData: () => void;
  onStartTour: () => void;
};

const Sidebar: React.FC<Props> = ({
  connections,
  activeId,
  history,
  resourceHistory,
  showResources,
  now,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onMove,
  onSelectHistoryEntry,
  onDeleteHistoryEntry,
  onClearHistory,
  onSelectResource,
  onDeleteResource,
  onClearResources,
  onClearStoredData,
  onStartTour,
}) => (
  <aside className="sidebar" aria-label="Connections and history">
    <section className="sidebar-section sidebar-section--connections">
      <div className="sidebar-heading">
        <span className="panel-title">Connections</span>
        <button
          className="icon-btn"
          type="button"
          onClick={onCreate}
          aria-label="Add a connection"
          data-tooltip="Add a connection"
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
                    data-tooltip="Move up"
                  >
                    <ChevronUpIcon size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => onMove(index, 1)}
                    disabled={index === connections.length - 1}
                    aria-label={`Move ${connection.name} down`}
                    data-tooltip="Move down"
                  >
                    <ChevronDownIcon size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => onEdit(connection)}
                    disabled={isLocal(connection)}
                    aria-label={`Edit ${connection.name}`}
                    data-tooltip={
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
                    data-tooltip={
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

    {showResources ? (
      <section className="sidebar-section sidebar-section--history">
        <div className="sidebar-heading">
          <span className="panel-title">
            <ResourceIcon size={12} /> Resources
          </span>
          {resourceHistory.length > 0 ? (
            <button className="btn-link" type="button" onClick={onClearResources}>
              Clear
            </button>
          ) : null}
        </div>

        {resourceHistory.length === 0 ? (
          <p className="sidebar-empty">
            Resources you look up on this connection show up here.
          </p>
        ) : (
          <ul className="history-list">
            {resourceHistory.map((entry) => (
              <li key={entry.id}>
                <div
                  className={`history${entry.statements === undefined ? " is-error" : ""}`}
                >
                  <button
                    className="history-main"
                    type="button"
                    onClick={() => onSelectResource(entry)}
                    data-tooltip={entry.uri}
                  >
                    <span className="history-query">
                      {entry.label ?? localName(entry.uri)}
                    </span>
                    <span className="history-meta">
                      {entry.statements === undefined
                        ? "failed"
                        : `${entry.statements} ${
                            entry.statements === 1 ? "statement" : "statements"
                          }`}
                      <span className="history-dot">·</span>
                      {formatRelativeTime(entry.at, now)}
                    </span>
                  </button>
                  <button
                    className="icon-btn is-danger"
                    type="button"
                    onClick={() => onDeleteResource(entry)}
                    aria-label="Remove from history"
                    data-tooltip="Remove from history"
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    ) : (
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
                    data-tooltip={`Load this query into the editor:\n\n${entry.query}`}
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
                    data-tooltip="Remove from history"
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    )}

    <footer className="sidebar-footer">
      <div className="sidebar-footer-actions">
        <button
          className="btn-link is-danger"
          type="button"
          onClick={onClearStoredData}
        >
          Clear all stored data
        </button>
        <span className="sidebar-footer-sep" aria-hidden="true">
          ·
        </span>
        <button
          className="btn-link"
          type="button"
          onClick={onStartTour}
          data-tooltip="Walk through the app again"
        >
          Tour
        </button>
      </div>
      <p className="sidebar-note">
        Connections and history live in this browser only.
      </p>

      <p className="sidebar-credit">
        Made with{" "}
        <span className="sidebar-heart" role="img" aria-label="love">
          ♥
        </span>{" "}
        by{" "}
        <a href={AUTHOR_URL} target="_blank" rel="noreferrer">
          Ludovic Muller
        </a>
      </p>

      {SHORT_SHA ? (
        <p className="sidebar-build">
          <span className="sidebar-build-label">Version</span>
          <a
            href={COMMIT_URL}
            target="_blank"
            rel="noreferrer"
            data-tooltip={`Built from commit ${COMMIT_SHA}${
              COMMIT_DIRTY ? " with uncommitted changes" : ""
            }`}
          >
            <CommitIcon size={11} />
            {SHORT_SHA}
            {COMMIT_DIRTY ? <span className="sidebar-build-dirty">+</span> : null}
          </a>
        </p>
      ) : null}
    </footer>
  </aside>
);

export default Sidebar;
