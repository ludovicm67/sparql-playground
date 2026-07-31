import { useEffect, useRef, useState } from "react";
import { type CanvasDoc } from "../lib/canvas";
import { useConfirm } from "./ConfirmProvider";
import { CloseIcon, PlusIcon } from "./icons";

type Props = {
  canvases: CanvasDoc[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

const CanvasTabs: React.FC<Props> = ({
  canvases,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}) => {
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      inputRef.current?.select();
    }
  }, [editingId]);

  const startRename = (doc: CanvasDoc) => {
    setEditingId(doc.id);
    setDraft(doc.name);
  };

  const commit = () => {
    if (editingId) {
      const name = draft.trim();
      if (name) {
        onRename(editingId, name.slice(0, 80));
      }
    }
    setEditingId(undefined);
  };

  return (
    <div className="canvas-tabs" role="tablist" aria-label="Canvases">
      <div className="canvas-tabs-scroll">
        {canvases.map((doc) => {
          const isActive = doc.id === activeId;

          return (
            <div
              key={doc.id}
              className={`canvas-tab${isActive ? " is-active" : ""}`}
              role="tab"
              aria-selected={isActive}
            >
              {editingId === doc.id ? (
                <input
                  ref={inputRef}
                  className="canvas-tab-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commit}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commit();
                    }
                    if (event.key === "Escape") {
                      setEditingId(undefined);
                    }
                  }}
                  aria-label="Canvas name"
                />
              ) : (
                <button
                  className="canvas-tab-name"
                  type="button"
                  onClick={() => (isActive ? startRename(doc) : onSelect(doc.id))}
                  onDoubleClick={() => startRename(doc)}
                  data-tooltip={
                    isActive
                      ? "Click again to rename"
                      : `${doc.name} — ${doc.graph.nodes.length} nodes`
                  }
                >
                  {doc.name}
                  <span className="canvas-tab-count">{doc.graph.nodes.length}</span>
                </button>
              )}

              <button
                className="icon-btn canvas-tab-close"
                type="button"
                onClick={() => {
                  void (async () => {
                    // An empty canvas is not worth a confirmation.
                    if (doc.graph.nodes.length === 0) {
                      onDelete(doc.id);
                      return;
                    }

                    const confirmed = await confirm({
                      title: "Delete this canvas?",
                      message: (
                        <>
                          <b>{doc.name}</b> and its {doc.graph.nodes.length}{" "}
                          {doc.graph.nodes.length === 1 ? "node" : "nodes"} will be
                          removed.
                        </>
                      ),
                      confirmLabel: "Delete",
                      danger: true,
                    });

                    if (confirmed) {
                      onDelete(doc.id);
                    }
                  })();
                }}
                aria-label={`Delete ${doc.name}`}
                data-tooltip="Delete this canvas"
              >
                <CloseIcon size={11} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        className="icon-btn canvas-tab-add"
        type="button"
        onClick={onCreate}
        aria-label="New canvas"
        data-tooltip="New canvas"
      >
        <PlusIcon size={14} />
      </button>
    </div>
  );
};

export default CanvasTabs;
