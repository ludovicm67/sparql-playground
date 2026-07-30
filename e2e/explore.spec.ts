import { expect, test } from "@playwright/test";
import {
  addMockConnection,
  addRowToCanvas,
  canvasStatus,
  edgeLabels,
  editorValue,
  openFirstClass,
  switchMode,
  waitForApp,
  waitForEditor,
} from "./support";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForEditor(page);
  await switchMode(page, "Explore");
  await page.waitForSelector(".explore-panel", { timeout: 30_000 });
});

test("lists classes and drills into instances", async ({ page }) => {
  await expect(page.locator(".explore-panel .explore-row-primary")).toHaveText(["Person"]);
  await expect(page.locator(".explore-panel .explore-count")).toHaveText(["9"]);

  await openFirstClass(page);
  await expect(page.locator(".explore-panel .explore-row")).toHaveCount(9);
  await expect(page.locator(".explore-context")).toContainText("Person");
});

test("connects nodes it discovers, in both directions", async ({ page }) => {
  await openFirstClass(page);
  await addRowToCanvas(page, "sheldon-cooper");
  await addRowToCanvas(page, "mary-cooper");

  await expect.poll(() => canvasStatus(page)).toContain("2 nodes");
  await expect.poll(() => edgeLabels(page)).toEqual(
    expect.arrayContaining(["parent", "children"])
  );
});

test("follows a predicate and adds its values, already wired up", async ({ page }) => {
  await openFirstClass(page);
  await addRowToCanvas(page, "sheldon-cooper");

  await page.locator(".node", { hasText: "sheldon-cooper" }).click();
  await expect(page.locator(".inspector")).toBeVisible();
  await expect(page.locator(".inspector .explore-row-primary").first()).toBeVisible();

  await page.locator(".inspector .explore-row-main", { hasText: "jobTitle" }).click();
  await page.locator(".explore-select-all input").check();
  await page.getByRole("button", { name: /Add \d+ to canvas/ }).click();

  await expect.poll(() => canvasStatus(page)).toContain("2 nodes");
  await expect.poll(() => edgeLabels(page)).toContain("jobTitle");
  await expect(page.locator(".node.is-literal")).toHaveCount(1);
});

test("drops a dragged class exactly where it lands", async ({ page }) => {
  await page.dragAndDrop(".explore-panel .explore-row >> nth=0", ".canvas", {
    targetPosition: { x: 260, y: 180 },
  });

  await expect(page.locator(".node.is-class")).toHaveCount(1);

  const node = await page.locator(".node").first().boundingBox();
  const canvas = await page.locator(".canvas").boundingBox();
  expect(Math.round(node!.x + node!.width / 2 - canvas!.x)).toBe(260);
  expect(Math.round(node!.y + node!.height / 2 - canvas!.y)).toBe(180);
});

test("moves and removes nodes", async ({ page }) => {
  await openFirstClass(page);
  await addRowToCanvas(page, "penny");

  // Adding selects the node, and the inspector overlays part of the canvas.
  await page.locator(".inspector .icon-btn[aria-label='Close the inspector']").click();
  await page.waitForTimeout(300);

  const before = (await page.locator(".node").first().boundingBox())!;
  await page.mouse.move(before.x + 60, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 220, before.y + 130, { steps: 10 });
  await page.mouse.up();

  const after = (await page.locator(".node").first().boundingBox())!;
  expect(Math.round(after.x - before.x)).toBe(160);
  expect(Math.round(after.y - before.y)).toBe(110);

  await page.locator(".node").first().hover();
  await page.locator(".node-remove").first().click();
  await expect.poll(() => canvasStatus(page)).toContain("0 nodes");
});

test("tidies a layout and fits it in view", async ({ page }) => {
  await openFirstClass(page);
  for (const name of ["sheldon-cooper", "mary-cooper", "penny", "leonard-hofstadter"]) {
    await addRowToCanvas(page, name);
  }

  const before = await page
    .locator(".node")
    .evaluateAll((nodes) =>
      (nodes as HTMLElement[]).map((node) => [node.offsetLeft, node.offsetTop])
    );

  await page.getByRole("button", { name: "Tidy up the layout" }).click();
  await page.waitForTimeout(700);

  const after = await page
    .locator(".node")
    .evaluateAll((nodes) =>
      (nodes as HTMLElement[]).map((node) => [node.offsetLeft, node.offsetTop])
    );
  expect(after).not.toEqual(before);

  // The fit must stay inside the zoom limits, not bottom out at 25%.
  const zoom = Number((await page.locator(".reset-view").innerText()).replace("%", ""));
  expect(zoom).toBeGreaterThan(30);
  expect(zoom).toBeLessThanOrEqual(250);
});

test("keeps a canvas per tab and per connection", async ({ page }) => {
  await openFirstClass(page);
  await addRowToCanvas(page, "sheldon-cooper");
  await expect(page.locator(".canvas-tab")).toHaveCount(1);

  await page.getByRole("button", { name: "New canvas" }).click();
  await expect.poll(() => canvasStatus(page)).toContain("0 nodes");
  await addRowToCanvas(page, "penny");

  await page.locator(".canvas-tab-name", { hasText: "Canvas 1" }).click();
  await expect(page.locator(".node-label")).toHaveText(["sheldon-cooper"]);
  await page.locator(".canvas-tab-name", { hasText: "Canvas 2" }).click();
  await expect(page.locator(".node-label")).toHaveText(["penny"]);

  // Renaming happens in place on the active tab.
  await page.locator(".canvas-tab.is-active .canvas-tab-name").click();
  await page.locator(".canvas-tab-input").fill("Renamed");
  await page.keyboard.press("Enter");
  await expect(page.locator(".canvas-tab-name").last()).toContainText("Renamed");
});

test("restores the canvas after a reload and after leaving Explore", async ({ page }) => {
  await openFirstClass(page);
  await addRowToCanvas(page, "sheldon-cooper");
  await addRowToCanvas(page, "mary-cooper");
  await page.waitForTimeout(700);

  await switchMode(page, "Query");
  await switchMode(page, "Explore");
  await expect.poll(() => canvasStatus(page)).toContain("2 nodes");

  await page.reload();
  await waitForApp(page);
  await expect.poll(() => canvasStatus(page), { timeout: 30_000 }).toContain("2 nodes");
  await expect.poll(() => edgeLabels(page)).toEqual(
    expect.arrayContaining(["parent", "children"])
  );
});

test("hands a class over to Query mode", async ({ page }) => {
  const row = page.locator(".explore-panel .explore-row").first();
  await row.hover();
  await row.getByRole("button", { name: /Open a query for/ }).click();

  await expect
    .poll(() => editorValue(page))
    .toContain("?instance a <http://schema.org/Person>");
  await page.getByRole("button", { name: /Run query/ }).click();
  await expect(page.locator(".results-table tbody tr")).toHaveCount(9);
});

test("pages instances and objects as you scroll", async ({ page }) => {
  await switchMode(page, "Query");
  await addMockConnection(page, { name: "Big", path: "/big" });
  await switchMode(page, "Explore");
  await page.waitForSelector(".explore-panel .explore-row", { timeout: 30_000 });

  await openFirstClass(page);
  await expect(page.locator(".explore-panel .explore-rows li")).toHaveCount(50);

  await page.locator(".explore-panel .explore-list").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator(".explore-panel .explore-rows li")).toHaveCount(100);

  await page.locator(".explore-panel .explore-list").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator(".explore-panel .explore-rows li")).toHaveCount(137);
  await expect(page.locator(".explore-panel .explore-more")).toHaveCount(0);
});

test("adds a whole page of objects at once without a self-edge", async ({ page }) => {
  await switchMode(page, "Query");
  await addMockConnection(page, { name: "Big", path: "/big" });
  await switchMode(page, "Explore");
  await page.waitForSelector(".explore-panel .explore-row", { timeout: 30_000 });

  await page.locator(".explore-panel .explore-row").first().hover();
  await page
    .locator(".explore-panel .explore-row")
    .first()
    .getByRole("button", { name: /Add .* to the canvas/ })
    .click();
  await page.waitForTimeout(700);

  await page.locator(".node").first().click();
  await expect(page.locator(".inspector")).toBeVisible();
  await page.locator(".inspector .explore-row-main").first().click();
  await expect(page.locator(".inspector .explore-object").first()).toBeVisible();

  await page.locator(".explore-select-all input").check();
  await page.getByRole("button", { name: /Add \d+ to canvas/ }).click();

  // The class node plus one page of 50 distinct objects, each wired to it.
  await expect.poll(() => canvasStatus(page), { timeout: 30_000 }).toContain("51 nodes");
  await expect.poll(() => canvasStatus(page)).toContain("50 edges");
});
