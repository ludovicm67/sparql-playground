import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadTourChoice,
  saveTourChoice,
  shouldOfferTour,
  TOUR_STEPS,
} from "../lib/tour";
import { clearStoredData, STORAGE_KEYS } from "../lib/storage";
import { withStorage } from "./helpers";

describe("tour", () => {
  let scope: ReturnType<typeof withStorage>;

  beforeEach(() => {
    scope = withStorage();
  });

  afterEach(() => {
    scope.restore();
  });

  it("is offered on a first visit and never again", () => {
    assert.equal(shouldOfferTour(), true);

    for (const choice of ["taken", "declined"] as const) {
      saveTourChoice(choice);
      assert.equal(loadTourChoice(), choice);
      assert.equal(shouldOfferTour(), false, `after ${choice}`);
    }
  });

  it("treats a corrupted choice as never having been asked", () => {
    for (const rubbish of ['"maybe"', "true", "null", "[]", "{{"]) {
      scope.storage.setItem(STORAGE_KEYS.tour, rubbish);
      assert.equal(shouldOfferTour(), true, `for ${rubbish}`);
    }
  });

  it("is offered again once the stored data is cleared", () => {
    saveTourChoice("declined");
    clearStoredData();

    // Unlike the theme: someone wiping the app is starting over.
    assert.equal(shouldOfferTour(), true);
  });
});

describe("tour steps", () => {
  it("has unique ids", () => {
    const ids = TOUR_STEPS.map((step) => step.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("says something on every step", () => {
    for (const step of TOUR_STEPS) {
      assert.ok(step.title.length > 0, `${step.id} has a title`);
      assert.ok(step.body.length > 40, `${step.id} says something`);
    }
  });

  it("opens without depending on anything being on screen", () => {
    // The tour can be restarted from any mode, so the first step may not wait
    // for an element that might not be there.
    assert.equal(TOUR_STEPS[0].target, undefined);
  });

  it("shows each handover as the button it actually is", () => {
    // Saying "you can get from here to there" is not the same as pointing at
    // the control that does it, which is the whole claim the tour makes.
    const targets = TOUR_STEPS.map((step) => step.target);

    for (const control of [
      '.results-table .term-link[data-iri="urn:tbbt:sheldon-cooper"]',
      '[data-tour="resource-query"]',
      '[data-tour="resource-canvas"]',
    ]) {
      assert.ok(targets.includes(control), `${control} is pointed at`);
    }
  });

  it("leaves something to run at the end", () => {
    const last = TOUR_STEPS[TOUR_STEPS.length - 1];
    const query = (last.actions ?? []).find((action) => action.kind === "query");

    assert.ok(query, "the closing step hands over a query");
    assert.match(
      query.kind === "query" ? query.text : "",
      /penny/i,
      "and it picks up the thread the story left hanging"
    );
  });

  it("tells one story: the thread is picked up and carried through", () => {
    const ids = TOUR_STEPS.map((step) => step.id);

    // A query, then its results, then the same subject as a page, then as a
    // graph — in that order, or the narrative does not hold together.
    const order = [
      "editor",
      "run",
      "results",
      "term-link",
      "resource",
      "mary",
      "canvas",
    ];
    const positions = order.map((id) => ids.indexOf(id));

    assert.ok(
      positions.every((position) => position >= 0),
      "every stage of the story is present"
    );
    assert.deepEqual(
      [...positions].sort((a, b) => a - b),
      positions,
      "the stages stay in order"
    );
  });

  it("visits Sheldon before the person who points at him", () => {
    const sheldon = TOUR_STEPS.findIndex((step) => step.id === "resource");
    const incoming = TOUR_STEPS.findIndex((step) => step.id === "incoming");
    const mary = TOUR_STEPS.findIndex((step) => step.id === "mary");

    assert.ok(sheldon < incoming && incoming < mary);
  });

  it("puts both ends of the link on the canvas, so there is an edge to see", () => {
    const canvas = TOUR_STEPS.find((step) => step.id === "canvas");
    const added = (canvas?.actions ?? []).filter((action) => action.kind === "canvas");

    assert.equal(added.length, 2, "two nodes, or nothing connects");
    assert.equal(canvas?.waitFor, ".edge", "and the step waits for the link");
  });

  it("only spotlights a target it has put on screen", () => {
    // A step highlighting the query panel must be in query mode by then, and
    // so on: a target belonging to another mode would dim the whole screen.
    const modeOf: Record<string, string> = {
      '[data-tour="editor"]': "query",
      '[data-tour="run"]': "query",
      '[data-tour="results"]': "query",
      '[data-tour="share"]': "query",
      '[data-tour="resource"]': "resource",
      '[data-tour="resource-query"]': "resource",
      '[data-tour="resource-canvas"]': "resource",
      ".resource-section:last-of-type": "resource",
      '.results-table .term-link[data-iri="urn:tbbt:sheldon-cooper"]': "query",
      ".canvas": "explore",
      ".explore-panel": "explore",
    };

    let mode = "query";
    for (const step of TOUR_STEPS) {
      for (const action of step.actions ?? []) {
        if (action.kind === "mode") {
          mode = action.mode;
        } else if (action.kind === "query" || action.kind === "run") {
          mode = "query";
        } else if (action.kind === "resource") {
          mode = "resource";
        } else if (action.kind === "canvas") {
          mode = "explore";
        }
      }

      const needed = step.target ? modeOf[step.target] : undefined;
      if (needed) {
        assert.equal(mode, needed, `${step.id} spotlights something in ${needed}`);
      }
    }
  });
});
