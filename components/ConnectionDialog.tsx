import { useEffect, useRef, useState } from "react";
import type * as oxigraph from "oxigraph/web";
import {
  type Connection,
  type HttpHeader,
  type RemoteConnection,
  REQUEST_METHODS,
  type RequestMethod,
} from "../lib/connections";
import { PROBE_QUERY, probeConnection, type ProbeResult } from "../lib/sparql";
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  PlusIcon,
  SpinnerIcon,
  TrashIcon,
} from "./icons";

type Props = {
  /** The connection being edited; a fresh one means "create". */
  connection: RemoteConnection;
  isNew: boolean;
  store: oxigraph.Store | undefined;
  onSave: (connection: Connection) => void;
  onCancel: () => void;
};

const ConnectionDialog: React.FC<Props> = ({
  connection,
  isNew,
  store,
  onSave,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<RemoteConnection>(connection);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | undefined>();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const update = (patch: Partial<RemoteConnection>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setProbe(undefined);
  };

  const updateHeader = (index: number, patch: Partial<HttpHeader>) =>
    update({
      headers: draft.headers.map((header, position) =>
        position === index ? { ...header, ...patch } : header
      ),
    });

  const endpointIsValid = (() => {
    try {
      const url = new URL(draft.endpoint);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  })();

  const mixedContent =
    endpointIsValid &&
    draft.endpoint.startsWith("http://") &&
    typeof window !== "undefined" &&
    window.location.protocol === "https:";

  const runProbe = async () => {
    setProbing(true);
    setProbe(undefined);
    setProbe(await probeConnection(draft, store));
    setProbing(false);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!endpointIsValid) {
      return;
    }

    onSave({
      ...draft,
      name: draft.name.trim() || draft.endpoint,
      endpoint: draft.endpoint.trim(),
      headers: draft.headers.filter((header) => header.name.trim()),
    });
  };

  return (
    <dialog className="dialog" ref={dialogRef} onCancel={onCancel} onClose={onCancel}>
      <form className="dialog-form" onSubmit={submit}>
        <header className="dialog-header">
          <h2>{isNew ? "New connection" : "Edit connection"}</h2>
          <button
            className="icon-btn"
            type="button"
            onClick={onCancel}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="dialog-body">
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={draft.name}
              placeholder="My endpoint"
              onChange={(event) => update({ name: event.target.value })}
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field-label">
              Endpoint URL <span className="field-required">required</span>
            </span>
            <input
              className="input"
              value={draft.endpoint}
              placeholder="https://example.org/sparql"
              inputMode="url"
              onChange={(event) => update({ endpoint: event.target.value })}
            />
            {draft.endpoint && !endpointIsValid ? (
              <span className="field-error">
                Enter an absolute http:// or https:// URL.
              </span>
            ) : null}
            {mixedContent ? (
              <span className="field-warning">
                <AlertIcon size={13} />
                This page is served over HTTPS, so the browser will block requests
                to a plain HTTP endpoint.
              </span>
            ) : null}
          </label>

          <fieldset className="field">
            <legend className="field-label">Request method</legend>
            <div className="segmented">
              {REQUEST_METHODS.map((method) => (
                <button
                  key={method.value}
                  className="segment"
                  type="button"
                  data-tooltip={method.hint}
                  aria-pressed={draft.method === method.value}
                  onClick={() => update({ method: method.value as RequestMethod })}
                >
                  {method.label}
                </button>
              ))}
            </div>
            <span className="field-hint">
              {REQUEST_METHODS.find((entry) => entry.value === draft.method)?.hint}
            </span>
          </fieldset>

          <fieldset className="field">
            <legend className="field-label">Authentication</legend>
            <div className="segmented">
              <button
                className="segment"
                type="button"
                aria-pressed={draft.auth.type === "none"}
                onClick={() => update({ auth: { type: "none" } })}
              >
                None
              </button>
              <button
                className="segment"
                type="button"
                aria-pressed={draft.auth.type === "basic"}
                onClick={() =>
                  update({
                    auth: { type: "basic", username: "", password: "" },
                  })
                }
              >
                Basic auth
              </button>
            </div>

            {draft.auth.type === "basic" ? (
              <>
                <div className="field-row">
                  <input
                    className="input"
                    value={draft.auth.username}
                    placeholder="Username"
                    autoComplete="off"
                    onChange={(event) =>
                      update({
                        auth: {
                          type: "basic",
                          username: event.target.value,
                          password:
                            draft.auth.type === "basic" ? draft.auth.password : "",
                        },
                      })
                    }
                  />
                  <input
                    className="input"
                    type="password"
                    value={draft.auth.password}
                    placeholder="Password"
                    autoComplete="off"
                    onChange={(event) =>
                      update({
                        auth: {
                          type: "basic",
                          username:
                            draft.auth.type === "basic" ? draft.auth.username : "",
                          password: event.target.value,
                        },
                      })
                    }
                  />
                </div>
                <span className="field-warning">
                  <AlertIcon size={13} />
                  Credentials are saved in this browser&rsquo;s local storage in
                  plain text, and sent on every request to this endpoint. Avoid
                  reusing a password you care about.
                </span>
              </>
            ) : null}
          </fieldset>

          <fieldset className="field">
            <legend className="field-label">Custom headers</legend>
            {draft.headers.length === 0 ? (
              <span className="field-hint">
                No custom headers. Add one for an API key or a specific Accept
                value.
              </span>
            ) : null}

            {draft.headers.map((header, index) => (
              <div className="field-row" key={index}>
                <input
                  className="input"
                  value={header.name}
                  placeholder="Header"
                  onChange={(event) =>
                    updateHeader(index, { name: event.target.value })
                  }
                />
                <input
                  className="input"
                  value={header.value}
                  placeholder="Value"
                  onChange={(event) =>
                    updateHeader(index, { value: event.target.value })
                  }
                />
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`Remove header ${header.name || index + 1}`}
                  onClick={() =>
                    update({
                      headers: draft.headers.filter(
                        (_, position) => position !== index
                      ),
                    })
                  }
                >
                  <TrashIcon />
                </button>
              </div>
            ))}

            <button
              className="btn-ghost"
              type="button"
              onClick={() =>
                update({ headers: [...draft.headers, { name: "", value: "" }] })
              }
            >
              <PlusIcon size={13} /> Add header
            </button>
          </fieldset>

          {probe ? (
            <div className={`probe ${probe.ok ? "is-ok" : "is-error"}`} role="status">
              {probe.ok ? <CheckIcon /> : <AlertIcon />}
              <div>
                <p className="probe-title">
                  {probe.ok ? "Connection works" : "Connection failed"}
                  <span className="probe-timing">
                    {probe.duration.toFixed(0)} ms
                  </span>
                </p>
                <p className="probe-message">{probe.message}</p>
              </div>
            </div>
          ) : null}
        </div>

        <footer className="dialog-footer">
          <button
            className="btn-secondary"
            type="button"
            onClick={runProbe}
            disabled={!endpointIsValid || probing}
            data-tooltip={`Runs "${PROBE_QUERY}" against the endpoint`}
          >
            {probing ? <SpinnerIcon /> : null}
            {probing ? "Testing…" : "Try connection"}
          </button>

          <div className="dialog-actions">
            <button className="btn-secondary" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn-run" type="submit" disabled={!endpointIsValid}>
              {isNew ? "Add connection" : "Save changes"}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
};

export default ConnectionDialog;
