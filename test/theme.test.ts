import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isTheme,
  loadTheme,
  nextTheme,
  resolveTheme,
  saveTheme,
  themeLabel,
  THEMES,
} from "../lib/theme";
import { clearStoredData, STORAGE_KEYS } from "../lib/storage";
import { withStorage } from "./helpers";

describe("theme", () => {
  let scope: ReturnType<typeof withStorage>;

  beforeEach(() => {
    scope = withStorage();
  });

  afterEach(() => {
    scope.restore();
  });

  it("defaults to following the system", () => {
    assert.equal(loadTheme(), "system");
  });

  it("round-trips a choice", () => {
    for (const theme of THEMES) {
      saveTheme(theme);
      assert.equal(loadTheme(), theme);
    }
  });

  it("falls back to the system when storage holds nonsense", () => {
    for (const rubbish of ['"sepia"', "42", "null", "{}", "not json at all"]) {
      scope.storage.setItem(STORAGE_KEYS.theme, rubbish);
      assert.equal(loadTheme(), "system", `for ${rubbish}`);
    }
  });

  it("recognises only the three themes", () => {
    assert.ok(isTheme("system") && isTheme("light") && isTheme("dark"));
    for (const value of ["", "System", "auto", 0, null, undefined, {}]) {
      assert.equal(isTheme(value), false, `for ${String(value)}`);
    }
  });

  it("cycles through every theme and returns to the start", () => {
    const seen = [];
    let theme = nextTheme("system");
    for (let step = 0; step < THEMES.length; step++) {
      seen.push(theme);
      theme = nextTheme(theme);
    }

    assert.deepEqual(seen, ["light", "dark", "system"]);
    // A full cycle is back where it began, so the button always has a way home.
    assert.equal(theme, "light");
  });

  it("resolves what each theme renders as", () => {
    assert.equal(resolveTheme("light", true), "light");
    assert.equal(resolveTheme("dark", false), "dark");
    // Only "system" defers to the OS.
    assert.equal(resolveTheme("system", true), "dark");
    assert.equal(resolveTheme("system", false), "light");
  });

  it("names each theme for the button", () => {
    assert.equal(themeLabel("system"), "System theme");
    assert.equal(themeLabel("light"), "Light theme");
    assert.equal(themeLabel("dark"), "Dark theme");
  });

  it("survives clearing the stored data", () => {
    saveTheme("light");
    scope.storage.setItem(STORAGE_KEYS.draft, '"SELECT * WHERE { ?s ?p ?o }"');

    clearStoredData();

    // The confirmation promises connections, history and canvases — not the
    // way the interface looks.
    assert.equal(loadTheme(), "light");
    assert.equal(scope.storage.getItem(STORAGE_KEYS.draft), null);
  });
});
