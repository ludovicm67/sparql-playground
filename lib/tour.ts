import { readJson, STORAGE_KEYS, writeJson } from "./storage";
import type { Mode } from "./navigation";
import { LOCAL_CONNECTION_ID } from "./connections";

/**
 * What the visitor did with the invitation. Stored so the offer is made once:
 * either answer is an answer, and re-asking on every load would be rude.
 *
 * Deliberately *not* exempt from "Clear all stored data" — someone wiping the
 * app is starting over, and should be offered the tour again.
 */
export type TourChoice = "taken" | "declined";

export const loadTourChoice = (): TourChoice | undefined => {
  const stored = readJson<unknown>(STORAGE_KEYS.tour, undefined);
  return stored === "taken" || stored === "declined" ? stored : undefined;
};

export const saveTourChoice = (choice: TourChoice) => {
  writeJson(STORAGE_KEYS.tour, choice);
};

/** True only on a first visit, when no answer has been given yet. */
export const shouldOfferTour = () => loadTourChoice() === undefined;

/** Something the tour asks the app to do before a step is shown. */
export type TourAction =
  | { kind: "mode"; mode: Mode }
  | { kind: "query"; text: string }
  | { kind: "run" }
  | { kind: "resource"; uri: string }
  | { kind: "canvas"; uri: string }
  | { kind: "sidebar"; open: boolean }
  /** Switches connection, so the story runs against the data it describes. */
  | { kind: "connection"; id: string };

/**
 * Steps are entered in both directions: pressing Back re-enters one after the
 * app has moved on, so each carries whatever actions put its own screen back
 * rather than inheriting the state of the step before it.
 */
export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** Element to cut out of the dimmed overlay. Omitted centres the card. */
  target?: string;
  /** Waited for before the step is shown; defaults to `target`. */
  waitFor?: string;
  actions?: TourAction[];
};

export const SHELDON = "urn:tbbt:sheldon-cooper";
export const MARY = "urn:tbbt:mary-cooper";

const OPENING_QUERY = `PREFIX schema: <http://schema.org/>

# Everyone the store knows, and the apartment they live in
# — where it knows one. No LIMIT: this is all of them.
SELECT ?person ?name ?apartment WHERE {
  ?person a schema:Person ;
          schema:givenName ?name .
  OPTIONAL { ?person schema:address/schema:streetAddress ?apartment }
}
ORDER BY ?name`;

const CLOSING_QUERY = `PREFIX schema: <http://schema.org/>

# Your turn. Penny is across the hall in 4B and nobody
# has asked her anything yet. Hit Run — then try swapping
# her for anyone else you saw along the way.
SELECT ?predicate ?object WHERE {
  <urn:tbbt:penny> ?predicate ?object .
}`;

/**
 * One continuous thread rather than a feature list: a query finds an address,
 * the address turns out to be shared, and the same two people are then reached
 * again as a page and as a graph. The point being made throughout is that
 * these are three views of one thing, and that any of them hands you over to
 * the others — so every handover is shown as the button it actually is.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    title: "A story in 63 triples",
    body: "We have switched you to the built-in store for this: a triple store running on WebAssembly inside this tab, which knows a little about the people of The Big Bang Theory. Nothing here leaves your browser. We are going to pull on one thread until the whole thing unravels.",
    // Whoever is taking this may already have their own connection selected
    // and their own query open. Both are set here, so the tour always starts
    // from the state the rest of it describes.
    actions: [
      { kind: "connection", id: LOCAL_CONNECTION_ID },
      { kind: "query", text: OPENING_QUERY },
      { kind: "mode", mode: "query" },
      { kind: "sidebar", open: true },
    ],
  },
  {
    id: "editor",
    title: "Start with a question",
    body: "SPARQL asks for a shape and gets back everything that fits it. This one asks for every person, and the apartment they live in where there is one. The editor knows the syntax — it completes prefixes, marks mistakes as you type, and tidies up on demand.",
    target: '[data-tour="editor"]',
    actions: [{ kind: "query", text: OPENING_QUERY }],
  },
  {
    id: "run",
    title: "Ask it",
    body: "⌘↵ works too. The store answers in a millisecond or so, because it is right here.",
    target: '[data-tour="run"]',
    actions: [{ kind: "run" }],
  },
  {
    id: "results",
    title: "Two people, one door",
    body: "The whole cast, no truncation. Sheldon and Leonard share Apartment 4A; Penny is across the hall in 4B. And note Mary Cooper, who has no apartment here at all — she comes back later.",
    target: '[data-tour="results"]',
    waitFor: ".results-table tbody tr",
  },
  {
    id: "term-link",
    title: "That first column is clickable",
    body: "Those are not strings, they are identities — and every one of them is a button. The next step presses the one on Sheldon\u2019s row, here, and lands on his page without a second query being written.",
    target: `.results-table .term-link[data-iri="${SHELDON}"]`,
    waitFor: ".results-table .term-link",
    actions: [{ kind: "mode", mode: "query" }],
  },
  {
    id: "resource",
    title: "Through the door",
    body: "The same Sheldon, now as a page. Everything he points at comes first, and his address — a blank node with no name of its own — is expanded right where you need it. No second query, no dead end.",
    target: '[data-tour="resource"]',
    waitFor: ".resource-title",
    actions: [{ kind: "resource", uri: SHELDON }],
  },
  {
    id: "incoming",
    title: "And who points back",
    body: "Underneath is the other direction: statements where Sheldon is the object, not the subject. There is Mary Cooper again, claiming him as her child. In a graph, that is a link you can walk backwards, which is exactly what the next step does.",
    target: ".resource-section:last-of-type",
    waitFor: ".resource-section:last-of-type",
    actions: [{ kind: "resource", uri: SHELDON }],
  },
  {
    id: "mary",
    title: "One click, and you have moved",
    body: "Mary\u2019s page. Her schema:children is Sheldon\u2019s schema:parent seen from the other end — the same fact, told from where you happen to be standing. You could keep walking like this all day.",
    target: '[data-tour="resource"]',
    waitFor: ".resource-title",
    actions: [{ kind: "resource", uri: MARY }],
  },
  {
    id: "back-to-query",
    title: "A page is only a query",
    body: "This button hands you the SPARQL that built the page, straight into the editor — so anything you liked the look of becomes something you can change. Nothing here is a dead end you have to retype your way out of.",
    target: '[data-tour="resource-query"]',
    actions: [{ kind: "resource", uri: MARY }],
  },
  {
    id: "to-canvas",
    title: "Or send it to the canvas",
    body: "And this one drops whoever you are looking at onto the graph. That is the third way of seeing the same thing — we are about to use it on both Sheldon and Mary.",
    target: '[data-tour="resource-canvas"]',
    actions: [{ kind: "resource", uri: MARY }],
  },
  {
    id: "canvas",
    title: "Now look at it",
    body: "Those same two people, on the canvas. The arrows between them are the link you just followed as text — drawn, labelled in both directions, and pointing the way each one actually goes.",
    target: ".canvas",
    waitFor: ".edge",
    actions: [
      { kind: "canvas", uri: SHELDON },
      { kind: "canvas", uri: MARY },
    ],
  },
  {
    id: "explore",
    title: "Keep pulling",
    body: "Click any node to see what it connects to, then bring those in as well — the graph grows the way your curiosity does. The list on the left holds every class and instance in the store, and you can drag any of them straight onto the canvas.",
    target: ".explore-panel",
    actions: [{ kind: "mode", mode: "explore" }],
  },
  {
    id: "sidebar",
    title: "Nothing is one-way",
    body: "Every query you run is kept here, per connection, and this local store is only the default one. Point a connection at any SPARQL endpoint and the whole journey works exactly the same.",
    target: ".sidebar",
    actions: [{ kind: "sidebar", open: true }],
  },
  {
    id: "share",
    title: "Take it with you",
    body: "A query, a resource, a canvas you built — any of it becomes a link. It travels in the fragment, so what you share never touches a server, and credentials only come along if you say so.",
    target: '[data-tour="share"]',
    // The share button lives in the query panel, so go back for it.
    actions: [{ kind: "mode", mode: "query" }],
  },
  {
    id: "done",
    title: "One thread, three views",
    body: "A query found an address, a page let us walk backwards down a link, and the canvas drew it. Same 63 triples all the way through. There is a question about Penny waiting in the editor — press Run and carry on from there.",
    target: '[data-tour="editor"]',
    actions: [
      { kind: "mode", mode: "query" },
      { kind: "query", text: CLOSING_QUERY },
    ],
  },
];

export const TOUR_LENGTH = TOUR_STEPS.length;
