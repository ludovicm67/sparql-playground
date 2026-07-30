import { useEffect, useMemo, useRef, useState } from "react";
import { Connection, isLocal } from "../lib/connections";
import { buildSharePayload, buildShareUrl, hasSecrets } from "../lib/share";
import { AlertIcon, CheckIcon, CloseIcon, CopyIcon } from "./icons";

type Props = {
  connection: Connection;
  query: string;
  onClose: () => void;
};

const ShareDialog: React.FC<Props> = ({ connection, query, onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const secrets = hasSecrets(connection);

  // Never leak credentials by default: the sender has to opt in.
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const url = useMemo(
    () => buildShareUrl(buildSharePayload(connection, query, includeSecrets)),
    [connection, query, includeSecrets]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the field is selectable as a fallback.
      dialogRef.current?.querySelector("input")?.select();
    }
  };

  const describeAuth = () => {
    if (isLocal(connection)) {
      return null;
    }

    const parts: string[] = [];
    if (connection.auth.type === "basic") {
      parts.push("basic auth credentials");
    }
    if (connection.headers.length > 0) {
      parts.push(
        `${connection.headers.length} custom header${
          connection.headers.length === 1 ? "" : "s"
        }`
      );
    }

    return parts.join(" and ");
  };

  return (
    <dialog className="dialog" ref={dialogRef} onCancel={onClose} onClose={onClose}>
      <div className="dialog-form">
        <header className="dialog-header">
          <h2>Share this query</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="dialog-body">
          <p className="share-summary">
            The link carries the query and{" "}
            {isLocal(connection) ? (
              <>
                points at the <b>built-in store</b>, so anyone can open it.
              </>
            ) : (
              <>
                the endpoint <b>{connection.endpoint}</b>. If the recipient already
                has that endpoint configured, their own connection is used;
                otherwise it is added to their list.
              </>
            )}
          </p>

          {secrets ? (
            <fieldset className="field">
              <legend className="field-label">Credentials</legend>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={includeSecrets}
                  onChange={(event) => {
                    setIncludeSecrets(event.target.checked);
                    setCopied(false);
                  }}
                />
                <span>
                  Include this connection&rsquo;s {describeAuth()} in the link
                </span>
              </label>

              {includeSecrets ? (
                <span className="field-warning">
                  <AlertIcon size={13} />
                  Anyone holding this link can read those secrets and query the
                  endpoint as you. The link keeps them in the URL fragment, so
                  they are not sent to any web server — but they will sit in chat
                  logs, mail and browser history wherever you paste it.
                </span>
              ) : (
                <span className="field-hint">
                  The link will not carry them. Whoever opens it has to open the
                  connection and fill in the credentials before the query can run.
                </span>
              )}
            </fieldset>
          ) : null}

          <label className="field">
            <span className="field-label">Link</span>
            <div className="field-row">
              <input
                className="input"
                value={url}
                readOnly
                onFocus={(event) => event.target.select()}
              />
              <button className="btn-secondary" type="button" onClick={copy}>
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <span className="field-hint">
              Everything after <code>#</code> stays in the browser: the fragment
              is never sent to the server hosting this page.
            </span>
          </label>
        </div>

        <footer className="dialog-footer">
          <div className="dialog-actions">
            <button className="btn-run" type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
};

export default ShareDialog;
