import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertIcon, CloseIcon } from "./icons";

export type ConfirmOptions = {
  title: string;
  message: ReactNode;
  /** Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirming button as destructive. */
  danger?: boolean;
};

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | undefined>(undefined);

/**
 * A promise-shaped replacement for `window.confirm`, so a destructive action
 * asks in the app's own voice rather than the browser's.
 */
export const useConfirm = (): Ask => {
  const ask = useContext(ConfirmContext);
  if (!ask) {
    throw new Error("useConfirm was called outside a ConfirmProvider");
  }
  return ask;
};

type Pending = ConfirmOptions & { resolve: (answer: boolean) => void };

const ConfirmDialog: React.FC<{
  pending: Pending;
  onAnswer: (answer: boolean) => void;
}> = ({ pending, onAnswer }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      className="dialog dialog--confirm"
      ref={dialogRef}
      // Escape and the backdrop both mean "no".
      onCancel={(event) => {
        event.preventDefault();
        onAnswer(false);
      }}
      onClose={() => onAnswer(false)}
    >
      <div className="dialog-form">
        <header className="dialog-header">
          <h2>{pending.title}</h2>
          <button
            className="icon-btn"
            type="button"
            onClick={() => onAnswer(false)}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="dialog-body">
          <div className={`confirm-message${pending.danger ? " is-danger" : ""}`}>
            {pending.danger ? <AlertIcon size={17} /> : null}
            <div>{pending.message}</div>
          </div>
        </div>

        <footer className="dialog-footer">
          <div className="dialog-actions">
            <button
              className="btn-secondary"
              type="button"
              onClick={() => onAnswer(false)}
            >
              {pending.cancelLabel ?? "Cancel"}
            </button>
            <button
              className={pending.danger ? "btn-danger" : "btn-run"}
              type="button"
              autoFocus
              onClick={() => onAnswer(true)}
            >
              {pending.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
};

const ConfirmProvider: React.FC<{ children?: ReactNode }> = ({ children }) => {
  const [pending, setPending] = useState<Pending | undefined>();

  const ask = useCallback<Ask>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    []
  );

  const answer = (accepted: boolean) => {
    pending?.resolve(accepted);
    setPending(undefined);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending ? <ConfirmDialog pending={pending} onAnswer={answer} /> : null}
    </ConfirmContext.Provider>
  );
};

export default ConfirmProvider;
