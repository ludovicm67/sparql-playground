import { useEffect, useRef, useState } from "react";

/**
 * One tooltip layer for the whole app, driven by `data-tooltip` attributes.
 *
 * Delegated from the document rather than wrapping every trigger: tooltips are
 * needed on a few dozen scattered controls, and half of them live inside lists
 * that re-render constantly.
 *
 * Rendered as a popover so it joins the top layer — otherwise anything shown
 * over a modal `<dialog>` would be painted underneath it.
 */

const HOVER_DELAY_MS = 350;
/** Distance between the trigger and the tooltip. */
const GAP = 9;
/** Closest the tooltip may come to the edge of the viewport. */
const MARGIN = 8;

type Active = { text: string; target: HTMLElement };

const accessibleName = (element: HTMLElement) =>
  element.getAttribute("aria-label")?.trim() ?? element.textContent?.trim() ?? "";

const Tooltips = () => {
  const [active, setActive] = useState<Active | undefined>();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // A tooltip that only appears on hover is unreachable by touch, and one
    // that appears on tap gets stuck. Leave coarse pointers alone.
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");

    const cancel = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = undefined;
      }
    };

    const hide = () => {
      cancel();
      setActive(undefined);
    };

    const triggerFor = (target: EventTarget | null) =>
      target instanceof Element
        ? (target.closest<HTMLElement>("[data-tooltip]") ?? undefined)
        : undefined;

    const onPointerOver = (event: PointerEvent) => {
      if (!fine.matches) {
        return;
      }

      const trigger = triggerFor(event.target);
      if (!trigger) {
        return;
      }

      const text = trigger.dataset.tooltip?.trim();
      if (!text) {
        return;
      }

      cancel();
      timer.current = setTimeout(
        () => setActive({ text, target: trigger }),
        HOVER_DELAY_MS
      );
    };

    const onPointerOut = (event: PointerEvent) => {
      const trigger = triggerFor(event.target);
      const next = triggerFor(event.relatedTarget);
      if (trigger && trigger !== next) {
        hide();
      }
    };

    // Keyboard users get it immediately: there is no hover to linger on.
    const onFocusIn = (event: FocusEvent) => {
      const trigger = triggerFor(event.target);
      const text = trigger?.dataset.tooltip?.trim();

      cancel();
      if (trigger && text) {
        setActive({ text, target: trigger });
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hide();
      }
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);

    return () => {
      cancel();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Position and show. Everything here writes to the DOM rather than to state,
  // so measuring the tooltip does not cost a second render.
  useEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip || !active) {
      return;
    }

    // Without popover support it still works, just painted below any modal.
    if (typeof tooltip.showPopover === "function") {
      tooltip.showPopover();
    }

    const anchor = active.target.getBoundingClientRect();
    const own = tooltip.getBoundingClientRect();

    // Above by default; below when there is no room up there.
    const fitsAbove = anchor.top - own.height - GAP >= MARGIN;
    const top = fitsAbove ? anchor.top - own.height - GAP : anchor.bottom + GAP;

    const centred = anchor.left + anchor.width / 2 - own.width / 2;
    const left = Math.min(
      Math.max(MARGIN, centred),
      window.innerWidth - own.width - MARGIN
    );

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.dataset.side = fitsAbove ? "top" : "bottom";

    // Describe the trigger, unless the tooltip merely repeats its name — a
    // screen reader should not say "Delete, Delete".
    const target = active.target;
    const duplicate =
      accessibleName(target).toLowerCase() === active.text.toLowerCase();

    if (!duplicate) {
      target.setAttribute("aria-describedby", "app-tooltip");
    }

    return () => {
      target.removeAttribute("aria-describedby");
    };
  }, [active]);

  if (!active) {
    return null;
  }

  return (
    <div
      id="app-tooltip"
      ref={tooltipRef}
      className="tooltip"
      role="tooltip"
      popover="manual"
    >
      {active.text}
    </div>
  );
};

export default Tooltips;
