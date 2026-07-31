import { expect, test } from "@playwright/test";
import {
  addMockConnection,
  confirmDialog,
  lastRequestTo,
  MOCK_URL,
  runQuery,
  setEditorValue,
  waitForEditor,
} from "./support";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForEditor(page);
});

test("starts with only the built-in store, which cannot be removed", async ({ page }) => {
  await expect(page.locator(".connection-name")).toHaveText([
    "TBBT (Oxigraph in browser)",
  ]);

  const row = page.locator(".connection", { hasText: "TBBT" });
  await expect(row.getByRole("button", { name: /Delete/ })).toBeDisabled();
  await expect(row.getByRole("button", { name: /Edit/ })).toBeDisabled();
});

test("probes an endpoint before saving it", async ({ page }) => {
  await page.getByRole("button", { name: "Add a connection" }).click();
  await page.waitForSelector("dialog.dialog");
  await page.locator(".field", { hasText: "Name" }).locator("input").first().fill("Mock");
  await page
    .locator(".field", { hasText: "Endpoint URL" })
    .locator("input")
    .first()
    .fill(`${MOCK_URL}/probe-check`);

  await page.getByRole("button", { name: "Try connection" }).click();
  await expect(page.locator(".probe.is-ok")).toBeVisible();

  // The probe must be the cheap one.
  expect((await lastRequestTo("/probe-check")).query.trim()).toBe("ASK {}");

  await page.getByRole("button", { name: "Add connection" }).click();
  await expect(page.locator(".connection.is-active .connection-name")).toHaveText("Mock");
});

test("reports a failing endpoint rather than pretending", async ({ page }) => {
  await page.getByRole("button", { name: "Add a connection" }).click();
  await page.waitForSelector("dialog.dialog");
  await page
    .locator(".field", { hasText: "Endpoint URL" })
    .locator("input")
    .first()
    .fill(`${MOCK_URL}/broken`);
  await page.getByRole("button", { name: "Try connection" }).click();

  await expect(page.locator(".probe.is-error")).toBeVisible();
  await expect(page.locator(".probe-message")).toContainText("500");
});

test("sends basic auth and custom headers", async ({ page }) => {
  await page.getByRole("button", { name: "Add a connection" }).click();
  await page.waitForSelector("dialog.dialog");
  await page.locator(".field", { hasText: "Name" }).locator("input").first().fill("Secure");
  await page
    .locator(".field", { hasText: "Endpoint URL" })
    .locator("input")
    .first()
    .fill(`${MOCK_URL}/secure`);

  await page.getByRole("button", { name: "Try connection" }).click();
  await expect(page.locator(".probe.is-error")).toBeVisible();
  await expect(page.locator(".probe-message")).toContainText("401");

  await page.getByRole("button", { name: "Basic auth" }).click();
  await expect(page.locator(".field-warning")).toContainText("plain text");
  await page.locator('input[placeholder="Username"]').fill("neo");
  await page.locator('input[placeholder="Password"]').fill("trinity");

  await page.getByRole("button", { name: "Add header" }).click();
  await page.locator('input[placeholder="Header"]').fill("X-Api-Key");
  await page.locator('input[placeholder="Value"]').fill("s3cr3t");

  await page.getByRole("button", { name: "Try connection" }).click();
  await expect(page.locator(".probe.is-ok")).toBeVisible();

  const request = await lastRequestTo("/secure");
  expect(request.authorization).toBe(
    `Basic ${Buffer.from("neo:trinity").toString("base64")}`
  );
  expect(request.apiKey).toBe("s3cr3t");
});

for (const [label, path, method, contentType] of [
  ["POST form-encoded", "/method-form", "POST", "application/x-www-form-urlencoded"],
  ["POST query body", "/method-direct", "POST", "application/sparql-query"],
  ["GET", "/method-get", "GET", null],
] as const) {
  test(`sends the query with ${label}`, async ({ page }) => {
    await page.getByRole("button", { name: "Add a connection" }).click();
    await page.waitForSelector("dialog.dialog");
    await page
      .locator(".field", { hasText: "Endpoint URL" })
      .locator("input")
      .first()
      .fill(`${MOCK_URL}${path}`);
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("button", { name: "Add connection" }).click();
    await page.waitForSelector("dialog.dialog", { state: "detached" });

    await runQuery(page);
    await expect(page.locator(".results-table tbody tr").first()).toBeVisible();

    const request = await lastRequestTo(path);
    expect(request.method).toBe(method);
    expect(request.contentType).toBe(contentType);
    expect(request.query).toContain("SELECT");
  });
}

test("renders remote terms with their language tags", async ({ page }) => {
  await addMockConnection(page);
  await runQuery(page);

  await expect(page.locator(".results-table tbody tr")).toHaveCount(3);
  await expect(page.locator(".term-literal").last()).toContainText("@fr");
  // Variable names are case-sensitive, so headers must not be uppercased.
  await expect(page.locator(".results-table th").nth(1)).toHaveText("s");
});

test("explains a server error and a lying content type", async ({ page }) => {
  await addMockConnection(page, { name: "Broken", path: "/broken" });
  await runQuery(page);
  await expect(page.locator(".error-message")).toContainText("500");

  await addMockConnection(page, { name: "Liar", path: "/notjson" });
  await runQuery(page);
  await expect(page.locator(".error-message")).toContainText("announced JSON");
});

test("scopes history to its connection", async ({ page }) => {
  await addMockConnection(page);
  await runQuery(page);
  await page.waitForTimeout(600);
  await expect(page.locator(".history-query")).toHaveCount(1);

  await page.locator(".connection-main", { hasText: "TBBT" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator(".sidebar-empty")).toBeVisible();

  await setEditorValue(page, "SELECT * WHERE { ?s ?p ?o } LIMIT 1");
  await runQuery(page);
  await page.waitForTimeout(600);
  await expect(page.locator(".history-query")).toHaveCount(1);

  await page.locator(".connection-main", { hasText: "Mock" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator(".history-query")).toHaveCount(1);
});

test("persists connections and clears them on demand", async ({ page }) => {
  await addMockConnection(page);
  await page.reload();
  await waitForEditor(page);
  await expect(page.locator(".connection-name")).toHaveCount(2);

  await page.getByRole("button", { name: "Clear all stored data" }).click();
  await confirmDialog(page);
  await page.waitForTimeout(800);

  await expect(page.locator(".connection-name")).toHaveText([
    "TBBT (Oxigraph in browser)",
  ]);
});

test("reorders and deletes connections", async ({ page }) => {
  await addMockConnection(page);
  await expect(page.locator(".connection-name")).toHaveText([
    "TBBT (Oxigraph in browser)",
    "Mock",
  ]);

  const row = page.locator(".connection", { hasText: "Mock" });
  await row.hover();
  await row.getByRole("button", { name: /Move .* up/ }).click();
  await expect(page.locator(".connection-name")).toHaveText([
    "Mock",
    "TBBT (Oxigraph in browser)",
  ]);

  await row.hover();
  await row.getByRole("button", { name: /Delete/ }).click();
  await confirmDialog(page);
  await expect(page.locator(".connection-name")).toHaveText([
    "TBBT (Oxigraph in browser)",
  ]);
});
