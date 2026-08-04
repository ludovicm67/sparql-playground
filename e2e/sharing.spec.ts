import { type Page } from "@playwright/test";
import {
  expect,
  test,
  openRecipient,
  addMockConnection,
  addRowToCanvas,
  canvasStatus,
  editorValue,
  MOCK_URL,
  openFirstClass,
  setEditorValue,
  switchMode,
  waitForApp,
  waitForEditor,
} from "./support";

const shareLink = async (page: Page) => {
  const link = await page.locator(".dialog input[readonly]").inputValue();
  await page.getByRole("button", { name: "Done" }).click();
  return link;
};

const decode = (link: string) =>
  Buffer.from(link.split("#s=")[1], "base64url").toString("utf8");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForEditor(page);
});

test("shares a query and opens it in a clean browser", async ({ page, browser }) => {
  await setEditorValue(page, "SELECT ?shared WHERE { ?shared a <http://schema.org/Person> }");
  await page.getByRole("button", { name: "Share this query" }).click();
  await expect(page.locator(".dialog-header h2")).toHaveText("Share this query");

  const link = await shareLink(page);
  expect(link).toContain("#s=");

  const other = await openRecipient(browser);
  await other.goto(link);
  await waitForEditor(other);
  expect(await editorValue(other)).toContain("?shared");
  await other.close();
});

test("leaves credentials out unless asked", async ({ page }) => {
  await page.getByRole("button", { name: "Add a connection" }).click();
  await page.waitForSelector("dialog.dialog");
  await page.locator(".field", { hasText: "Name" }).locator("input").first().fill("Secure");
  await page
    .locator(".field", { hasText: "Endpoint URL" })
    .locator("input")
    .first()
    .fill(`${MOCK_URL}/secure`);
  await page.getByRole("button", { name: "Basic auth" }).click();
  await page.locator('input[placeholder="Username"]').fill("neo");
  await page.locator('input[placeholder="Password"]').fill("trinity");
  await page.getByRole("button", { name: "Add connection" }).click();
  await page.waitForSelector("dialog.dialog", { state: "detached" });

  await page.getByRole("button", { name: "Share this query" }).click();
  await expect(page.locator(".checkbox input")).not.toBeChecked();

  const stripped = await page.locator(".dialog input[readonly]").inputValue();
  expect(decode(stripped)).not.toContain("trinity");
  expect(decode(stripped)).toContain('"omitted":true');

  await page.locator(".checkbox input").check();
  await expect(page.locator(".field-warning")).toContainText("Anyone holding this link");
  const full = await shareLink(page);
  expect(decode(full)).toContain("trinity");
});

test("a recipient without credentials is told to add them", async ({ page, browser }) => {
  await page.getByRole("button", { name: "Add a connection" }).click();
  await page.waitForSelector("dialog.dialog");
  await page.locator(".field", { hasText: "Name" }).locator("input").first().fill("Secure");
  await page
    .locator(".field", { hasText: "Endpoint URL" })
    .locator("input")
    .first()
    .fill(`${MOCK_URL}/secure`);
  await page.getByRole("button", { name: "Basic auth" }).click();
  await page.locator('input[placeholder="Username"]').fill("neo");
  await page.locator('input[placeholder="Password"]').fill("trinity");
  await page.getByRole("button", { name: "Add connection" }).click();
  await page.waitForSelector("dialog.dialog", { state: "detached" });

  await page.getByRole("button", { name: "Share this query" }).click();
  const link = await shareLink(page);

  const other = await openRecipient(browser);
  await other.goto(link);
  await waitForEditor(other);

  await expect(other.locator(".notice.is-warning")).toBeVisible();
  await expect(other.locator(".notice-text")).toContainText("left the credentials out");
  await expect(other.locator(".connection-name")).toHaveCount(2);

  // The connection exists but cannot answer yet.
  await other.getByRole("button", { name: /Run query/ }).click();
  await expect(other.locator(".error-message")).toContainText("401");
  await other.close();
});

test("reuses the recipient's own connection for a known endpoint", async ({
  page,
  browser,
}) => {
  await addMockConnection(page, { name: "Sender's name" });
  await page.getByRole("button", { name: "Share this query" }).click();
  const link = await shareLink(page);

  const other = await openRecipient(browser);
  await other.goto("/");
  await waitForEditor(other);
  // Same endpoint, written with a trailing slash.
  await addMockConnection(other, { name: "Mine", path: "/sparql/" });

  await other.goto(link);
  await waitForEditor(other);
  await expect(other.locator(".connection-name")).toHaveCount(2);
  await expect(other.locator(".connection.is-active .connection-name")).toHaveText("Mine");
  await other.close();
});

test("shares a canvas as a new tab on the other side", async ({ page, browser }) => {
  await switchMode(page, "Explore");
  await page.waitForSelector(".explore-panel .explore-row", { timeout: 30_000 });
  await openFirstClass(page);
  await addRowToCanvas(page, "sheldon-cooper");
  await addRowToCanvas(page, "mary-cooper");

  await page.locator(".canvas-tab.is-active .canvas-tab-name").click();
  await page.locator(".canvas-tab-input").fill("Coopers");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Share this canvas" }).click();
  await expect(page.locator(".dialog-header h2")).toContainText("Coopers");
  const link = await shareLink(page);

  const other = await openRecipient(browser);
  await other.goto(link);
  await waitForApp(other);
  await expect(other.locator(".notice-text")).toContainText("Coopers");

  await switchMode(other, "Explore");
  await expect(other.locator(".canvas-tab")).toHaveCount(2);
  await expect.poll(() => canvasStatus(other)).toContain("2 nodes");
  await expect(other.locator(".node-label")).toHaveCount(2);
  await other.close();
});

test("shares a resource straight into its page", async ({ page, browser }) => {
  await page.goto("/?mode=resource&uri=urn:tbbt:penny");
  await waitForApp(page);
  await expect(page.locator(".resource-title")).toBeVisible();

  await page.getByRole("button", { name: "Share this resource" }).click();
  await expect(page.locator(".dialog-header h2")).toHaveText("Share this resource");
  const link = await shareLink(page);

  const other = await openRecipient(browser);
  await other.goto(link);
  await waitForApp(other);

  await expect(other.locator(".workspace--resource")).toBeVisible();
  await expect(other.locator(".resource-title")).toHaveText("penny");
  await expect(other.locator(".notice-text")).toContainText("resource");
  await other.close();
});

test("ignores a malformed link instead of breaking", async ({ page }) => {
  await page.goto("/#s=not-valid-base64!!!");
  await waitForEditor(page);
  await expect(page.locator(".notice")).toHaveCount(0);
  await expect(page.locator(".connection-name")).toHaveCount(1);

  const wrongVersion = Buffer.from(JSON.stringify({ v: 9, query: "x" })).toString("base64url");
  await page.goto(`/#s=${wrongVersion}`);
  await waitForEditor(page);
  await expect(page.locator(".notice")).toHaveCount(0);
});

test("consumes the fragment so a refresh does not reapply it", async ({ page }) => {
  await setEditorValue(page, "SELECT ?once WHERE { ?once ?p ?o }");
  await page.getByRole("button", { name: "Share this query" }).click();
  const link = await shareLink(page);

  await page.goto(link);
  await waitForEditor(page);
  await expect(page).not.toHaveURL(/#s=/);
  await expect(page.locator(".connection-name")).toHaveCount(1);

  await page.reload();
  await waitForEditor(page);
  await expect(page.locator(".connection-name")).toHaveCount(1);
});
