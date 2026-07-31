import { expect, type Page } from "@playwright/test";

export const MOCK_URL = "http://127.0.0.1:4567";

/**
 * The app shell, not the editor: outside Query mode the editor is deliberately
 * hidden, so waiting for it to be visible would hang.
 */
export const waitForApp = async (page: Page) => {
  await page.waitForSelector(".app", { timeout: 60_000 });
  // Not the sidebar: it starts closed on a narrow viewport.
  await expect(page.locator(".app-header")).toBeVisible();
};

/** Query mode additionally needs Monaco up before it can be driven. */
export const waitForEditor = async (page: Page) => {
  await waitForApp(page);
  await page.waitForSelector(".monaco-editor", { state: "visible", timeout: 60_000 });
  await page.waitForTimeout(400);
};

export const editorValue = (page: Page) =>
  page.evaluate(() => {
    const editor = window.monaco.editor
      .getEditors()
      .find((candidate) => !candidate.getRawOptions().readOnly);
    return editor?.getValue() ?? "";
  });

export const setEditorValue = (page: Page, value: string) =>
  page.evaluate((text) => {
    const editor = window.monaco.editor
      .getEditors()
      .find((candidate) => !candidate.getRawOptions().readOnly);
    editor?.setValue(text);
  }, value);

export const switchMode = async (page: Page, mode: "Query" | "Explore" | "Resource") => {
  await page.getByRole("button", { name: mode, exact: true }).click();
  await page.waitForTimeout(400);
};

export const runQuery = async (page: Page) => {
  await page.getByRole("button", { name: /Run query/ }).click();
};

/** Add a connection pointing at the mock endpoint and switch to it. */
export const addMockConnection = async (
  page: Page,
  { name = "Mock", path = "/sparql" }: { name?: string; path?: string } = {}
) => {
  await page.getByRole("button", { name: "Add a connection" }).click();
  await page.waitForSelector("dialog.dialog");
  await page.locator(".field", { hasText: "Name" }).locator("input").first().fill(name);
  await page
    .locator(".field", { hasText: "Endpoint URL" })
    .locator("input")
    .first()
    .fill(`${MOCK_URL}${path}`);
  await page.getByRole("button", { name: "Add connection" }).click();
  await page.waitForSelector("dialog.dialog", { state: "detached" });
};

export type MockRequest = {
  path: string;
  method: string;
  contentType: string | null;
  authorization: string | null;
  apiKey: string | null;
  query: string;
};

export const mockLog = async (): Promise<MockRequest[]> => {
  const response = await fetch(`${MOCK_URL}/__log`);
  return response.json();
};

/**
 * The mock's log is shared by every worker, so never assume the last entry is
 * yours: give each spec its own endpoint path and match on that. Polling covers
 * the gap between the browser firing the request and the server recording it.
 */
export const lastRequestTo = async (path: string, timeout = 10_000) => {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const matching = (await mockLog()).filter((entry) => entry.path === path);
    if (matching.length > 0) {
      return matching[matching.length - 1];
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`the mock endpoint never received a request to ${path}`);
};

/** Open the class list in Explore and drill into the first class. */
export const openFirstClass = async (page: Page) => {
  await page.waitForSelector(".explore-panel .explore-row", { timeout: 30_000 });
  await page.locator(".explore-panel .explore-row-main").first().click();
  await page.waitForTimeout(800);
};

export const addRowToCanvas = async (page: Page, text: string) => {
  const row = page.locator(".explore-panel .explore-row", { hasText: text });
  await row.hover();
  await row.getByRole("button", { name: /Add .* to the canvas/ }).click();
  await page.waitForTimeout(700);
};

export const canvasStatus = async (page: Page) =>
  (await page.locator(".canvas-panel .panel-status").innerText()).replace(/\s+/g, " ").trim();

export const edgeLabels = (page: Page) =>
  page.locator(".edge text").evaluateAll((nodes) => nodes.map((node) => node.textContent));

declare global {
  interface Window {
    monaco: typeof import("monaco-editor");
  }
}

/** Answer the app's own confirmation dialog (it no longer uses window.confirm). */
export const confirmDialog = async (page: Page, accept = true) => {
  const dialog = page.locator("dialog.dialog--confirm");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: accept ? /Delete|Clear everything|Confirm/ : /Cancel/ })
    .click();
  await expect(dialog).toHaveCount(0);
};

/** The app's tooltip layer, if one is currently showing. */
export const tooltip = (page: Page) => page.locator("#app-tooltip");
