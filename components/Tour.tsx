import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TOUR_STEPS, type TourAction, type TourStep } from "../lib/tour";
import { CloseIcon } from "./icons";
import GraphMark from "./GraphMark";

type Props = {
  /** Performs whatever a step asks of the app, before that step is shown. */
  onAct: (actions: readonly TourAction[]) => void;
  onFinish: () => void;
  onSkip: () => void;
};

type Box = { top: number; left: number; width: number; height: number };

const PADDING = 8;
/* A target that has not appeared by now is not going to. */
const TARGET_TIMEOUT = 2500;
const CARD_WIDTH = 380;
const GAP = 16;

/** Waits for an element to exist and have a size, giving up rather than hanging. */
const waitForTarget = (selector: string, signal: AbortSignal) =>
  new Promise<HTMLElement | undefined>((resolve) => {
    const deadline = Date.now() + TARGET_TIMEOUT;

    const look = () => {
      if (signal.aborted) {
        resolve(undefined);
        return;
      }

      const found = document.querySelector<HTMLElement>(selector);
      if (found && found.getBoundingClientRect().width > 0) {
        resolve(found);
        return;
      }

      if (Date.now() > deadline) {
        resolve(undefined);
        return;
      }

      requestAnimationFrame(look);
    };

    look();
  });

/**
 * Places the card beside the cut-out, preferring below, then above, then the
 * side with the most room — and never off-screen.
 */
const placeCard = (hole: Box | undefined, cardHeight: number) => {
  const view = { width: window.innerWidth, height: window.innerHeight };

  if (!hole) {
    return {
      left: Math.round((view.width - CARD_WIDTH) / 2),
      top: Math.round((view.height - cardHeight) / 2),
    };
  }

  const clampLeft = (value: number) =>
    Math.round(Math.min(Math.max(GAP, value), view.width - CARD_WIDTH - GAP));
  const clampTop = (value: number) =>
    Math.round(Math.min(Math.max(GAP, value), view.height - cardHeight - GAP));

  const below = hole.top + hole.height + GAP;
  if (below + cardHeight + GAP <= view.height) {
    return { left: clampLeft(hole.left + hole.width / 2 - CARD_WIDTH / 2), top: below };
  }

  const above = hole.top - cardHeight - GAP;
  if (above >= GAP) {
    return { left: clampLeft(hole.left + hole.width / 2 - CARD_WIDTH / 2), top: above };
  }

  const right = hole.left + hole.width + GAP;
  const left = hole.left - CARD_WIDTH - GAP;
  const top = clampTop(hole.top + hole.height / 2 - cardHeight / 2);

  if (right + CARD_WIDTH + GAP <= view.width) {
    return { left: right, top };
  }
  if (left >= GAP) {
    return { left, top };
  }

  return { left: clampLeft(hole.left), top: clampTop(hole.top + hole.height + GAP) };
};

const Tour: React.FC<Props> = ({ onAct, onFinish, onSkip }) => {
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Box | undefined>();
  const [card, setCard] = useState({ left: 0, top: 0 });

  const cardRef = useRef<HTMLDivElement>(null);
  const step: TourStep = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  const onActRef = useRef(onAct);
  useEffect(() => {
    onActRef.current = onAct;
  }, [onAct]);

  // Entering a step: ask the app to do its part, then find what to spotlight.
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    void (async () => {
      // The previous cut-out is deliberately left in place while the next one
      // is found: blanking it first threw the card to the middle of the screen
      // and back on every step. The card itself is never hidden — it is the
      // only way out of the tour, and a step whose target has gone (pressing
      // Back after the app moved on) used to leave nothing but the overlay.
      if (step.actions) {
        onActRef.current(step.actions);
      }

      const selector = step.waitFor ?? step.target;
      const element = selector
        ? await waitForTarget(selector, controller.signal)
        : undefined;

      if (!alive) {
        return;
      }

      // `waitFor` may guard on something other than what gets highlighted.
      const highlighted =
        step.target && step.target !== selector
          ? document.querySelector<HTMLElement>(step.target)
          : element;

      const rect = highlighted?.getBoundingClientRect();
      setHole(
        rect
          ? {
              top: rect.top - PADDING,
              left: rect.left - PADDING,
              width: rect.width + PADDING * 2,
              height: rect.height + PADDING * 2,
            }
          : undefined
      );
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [step]);

  // Position the card once it has been measured, and keep it there on resize.
  useLayoutEffect(() => {
    const reposition = () =>
      setCard(placeCard(hole, cardRef.current?.offsetHeight ?? 240));

    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [hole, index]);

  const back = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);
  const next = useCallback(() => {
    if (last) {
      onFinish();
    } else {
      setIndex((current) => current + 1);
    }
  }, [last, onFinish]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onSkip();
      } else if (event.key === "ArrowRight") {
        next();
      } else if (event.key === "ArrowLeft") {
        back();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, next, onSkip]);

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* One element dims everything: an enormous shadow cast outward from the
          cut-out, which is cheaper and sharper than four separate panels. */}
      <div
        className={`tour-hole${hole ? "" : " is-centred"}`}
        style={
          hole
            ? { top: hole.top, left: hole.left, width: hole.width, height: hole.height }
            : undefined
        }
        aria-hidden="true"
      />

      <div
        className="tour-card"
        ref={cardRef}
        style={{ left: card.left, top: card.top }}
      >
        <div className="tour-card-head">
          <span className="tour-mark">
            <GraphMark size={15} />
          </span>
          <span className="tour-progress">
            {index + 1} of {TOUR_STEPS.length}
          </span>
          <button
            className="icon-btn"
            type="button"
            onClick={onSkip}
            aria-label="End the tour"
            data-tooltip="End the tour"
          >
            <CloseIcon size={13} />
          </button>
        </div>

        <h2 className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>

        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((each, position) => (
            <span
              key={each.id}
              className={`tour-dot${position === index ? " is-current" : ""}${
                position < index ? " is-done" : ""
              }`}
            />
          ))}
        </div>

        <div className="tour-actions">
          <button className="btn-link" type="button" onClick={onSkip}>
            Skip
          </button>
          <div className="tour-actions-main">
            <button
              className="btn-secondary"
              type="button"
              onClick={back}
              disabled={index === 0}
            >
              Back
            </button>
            <button className="btn-run" type="button" onClick={next} autoFocus>
              {last ? "Start exploring" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tour;
