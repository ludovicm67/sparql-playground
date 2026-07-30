import { expect, test } from "@playwright/test";
import {
  editorValue,
  runQuery,
  setEditorValue,
  waitForEditor,
} from "./support";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForEditor(page);
});

test("runs the bundled example against the in-browser store", async ({ page }) => {
  await runQuery(page);

  await expect(page.locator(".results-table tbody tr").first()).toBeVisible();
  await expect(page.locator(".panel-status").first()).toContainText("bindings");
  await expect(page.locator(".results-table tbody tr")).toHaveCount(20);
});

test("every bundled example executes", async ({ page }) => {
  const chips = await page.locator(".chip").allInnerTexts();
  expect(chips.length).toBeGreaterThan(5);

  for (const label of chips) {
    await page.locator(".chip", { hasText: new RegExp(`^${label}$`) }).click();
    await runQuery(page);
    await page.waitForTimeout(400);

    await expect(page.locator(".error-box"), `example "${label}" failed`).toHaveCount(0);
    await expect(page.locator(".panel-status").first()).toBeVisible();
  }
});

test("renders each result shape differently", async ({ page }) => {
  await setEditorValue(page, "ASK { ?s ?p ?o }");
  await runQuery(page);
  await expect(page.locator(".boolean-value")).toHaveText("true");

  await setEditorValue(page, "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 3");
  await runQuery(page);
  await expect(page.locator(".panel-status").first()).toContainText("graph");

  await setEditorValue(page, "SELECT * WHERE { <urn:nope> <urn:nope> ?o }");
  await runQuery(page);
  await expect(page.getByText("No matches")).toBeVisible();
});

test("surfaces a syntax error without wiping the editor", async ({ page }) => {
  await setEditorValue(page, "SELECT * WHERE { this is not sparql }");
  await runQuery(page);

  await expect(page.locator(".error-box")).toBeVisible();
  await expect(page.locator(".error-message")).toContainText("error at");
  expect(await editorValue(page)).toContain("not sparql");
});

test("keeps a per-connection history that loads without re-running", async ({ page }) => {
  await page.locator(".chip", { hasText: /^People$/ }).click();
  await runQuery(page);
  await expect(page.locator(".results-table tbody tr").first()).toBeVisible();

  await page.locator(".chip", { hasText: /^Vocabulary$/ }).click();
  await runQuery(page);
  await page.waitForTimeout(500);

  await expect(page.locator(".history-query")).toHaveCount(2);
  const rowsBefore = await page.locator(".results-table tbody tr").count();

  // Picking from history fills the editor; it must not fire the query.
  await page.locator(".history-main").last().click();
  await page.waitForTimeout(1500);

  expect(await editorValue(page)).toContain("schema:");
  expect(await page.locator(".results-table tbody tr").count()).toBe(rowsBefore);
  await expect(page.locator(".history-query")).toHaveCount(2);
});

test("formats a query through the language server", async ({ page }) => {
  await setEditorValue(page, "PREFIX x: <http://e.org/>\nSELECT ?a WHERE{?a x:p ?b.?b x:q ?c}");
  await page.getByRole("button", { name: "Format this query" }).click();

  await expect
    .poll(() => editorValue(page), { timeout: 60_000 })
    .toContain("SELECT ?a WHERE {");
  expect(await editorValue(page)).toContain("  ?a x:p ?b .");
});

test("declares a missing prefix by itself", async ({ page }) => {
  await setEditorValue(page, "SELECT * WHERE { ?s foaf:name ?o }");

  await expect
    .poll(() => editorValue(page), { timeout: 60_000 })
    .toContain("PREFIX foaf: <http://xmlns.com/foaf/0.1/>");
});

test("flags an unknown prefix instead of inventing a namespace", async ({ page }) => {
  await setEditorValue(page, "SELECT * WHERE { ?s zzz:thing ?o }");
  await page.waitForTimeout(3_000);

  expect(await editorValue(page)).toBe("SELECT * WHERE { ?s zzz:thing ?o }");
  const markers = await page.evaluate(() => {
    const model = window.monaco.editor
      .getEditors()
      .find((candidate) => !candidate.getRawOptions().readOnly)
      ?.getModel();
    return model
      ? window.monaco.editor.getModelMarkers({ resource: model.uri }).map((m) => m.message)
      : [];
  });

  expect(markers.join(" ")).toContain("zzz");
});

test("offers completions from the language server only", async ({ page }) => {
  await setEditorValue(page, "SELECT * WHERE { ?myVariable ?p ?o }\n");
  await page.locator(".monaco-editor").first().click();
  await page.evaluate(() => {
    const editor = window.monaco.editor
      .getEditors()
      .find((candidate) => !candidate.getRawOptions().readOnly);
    editor?.setPosition({ lineNumber: 2, column: 1 });
    editor?.focus();
  });
  await page.keyboard.press("Control+Space");

  const rows = page.locator(".suggest-widget.visible .monaco-list-row");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });

  const labels = await rows.allInnerTexts();
  expect(labels.join(" ")).toContain("LIMIT");
  // Monaco's word-based suggestions are off, so nothing scraped from the text.
  expect(labels.join(" ")).not.toContain("myVariable");
});

test("runs with the keyboard shortcut it advertises", async ({ page }) => {
  // Monaco binds CtrlCmd from the *browser's* reported platform, so press
  // whichever modifier the button is actually offering.
  const label = await page.locator(".btn-run kbd").innerText();
  const modifier = label.includes("⌘") ? "Meta" : "Control";

  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press(`${modifier}+Enter`);

  await expect(page.locator(".results-table tbody tr").first()).toBeVisible();
});
