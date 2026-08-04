import { useEffect, useRef } from "react";
import { CloseIcon } from "./icons";
import GraphMark from "./GraphMark";

type Props = {
  onAccept: () => void;
  onDecline: () => void;
};

/**
 * Shown once, on a first visit. Either answer is recorded, so this is the only
 * time it interrupts anyone.
 */
const TourInvite: React.FC<Props> = ({ onAccept, onDecline }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      className="dialog dialog--invite"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onDecline();
      }}
      onClose={onDecline}
    >
      <div className="dialog-form">
        <button
          className="icon-btn invite-close"
          type="button"
          onClick={onDecline}
          aria-label="No thanks"
        >
          <CloseIcon />
        </button>

        <div className="invite-art" aria-hidden="true">
          <GraphMark size={34} />
        </div>

        <div className="invite-body">
          <h2>First time here?</h2>
          <p>
            There is a triple store running inside this tab, with a little
            dataset about The Big Bang Theory in it. Two minutes and one thread
            to pull, and you will have seen how querying, browsing and drawing
            the graph are all the same thing from different angles.
          </p>
        </div>

        <div className="invite-actions">
          <button className="btn-secondary" type="button" onClick={onDecline}>
            I&rsquo;ll poke around myself
          </button>
          <button className="btn-run" type="button" onClick={onAccept} autoFocus>
            Show me around
          </button>
        </div>

        <p className="invite-note">Asked once — not on every visit.</p>
      </div>
    </dialog>
  );
};

export default TourInvite;
