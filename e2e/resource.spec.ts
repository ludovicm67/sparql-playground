import {
  expect,
  test,
  addRowToCanvas,
  canvasStatus,
  editorValue,
  openFirstClass,
  runQuery,
  switchMode,
  waitForApp,
  waitForEditor,
} from "./support";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForEditor(page);
});

test("dereferences an IRI into a page", async ({ page }) => {
  await switchMode(page, "Resource");
  await expect(page.getByText("No resource yet")).toBeVisible();

  await page.locator(".resource-input").fill("urn:tbbt:sheldon-cooper");
  await page.getByRole("button", { name: "Dereference" }).click();

  await expect(page.locator(".resource-title")).toHaveText("sheldon-cooper");
  await expect(page.locator(".resource-iri")).toHaveText("urn:tbbt:sheldon-cooper");
  await expect(page.locator(".resource-types .chip")).toHaveText(["Person"]);
  await expect(page.locator(".resource-meta")).toContainText("8 statements");

  // rdf:type is lifted into the badges rather than listed as a property.
  const properties = await page.locator(".resource-section").first().locator("dt").allInnerTexts();
  expect(properties.join(" ")).not.toContain("type");
  expect(properties.join(" ")).toContain("jobTitle");

  await expect(page.locator(".resource-section").last().locator("dt")).toHaveText([
    "children",
  ]);
});

test("walks the graph through its links", async ({ page }) => {
  await page.goto("/?mode=resource&uri=urn:tbbt:sheldon-cooper");
  await waitForApp(page);
  await expect(page.locator(".resource-title")).toHaveText("sheldon-cooper");

  await page.locator(".resource-link", { hasText: "mary-cooper" }).first().click();
  await expect(page.locator(".resource-title")).toHaveText("mary-cooper");
  await expect(page).toHaveURL(/uri=urn%3Atbbt%3Amary-cooper/);
});

test("refuses an IRI it cannot query with", async ({ page }) => {
  await switchMode(page, "Resource");
  await page.locator(".resource-input").fill("not an iri");

  await expect(page.getByRole("button", { name: "Dereference" })).toBeDisabled();
  await expect(page.locator(".explore-error")).toContainText("not a usable IRI");
});

test("keeps a resource history, scoped and persisted", async ({ page }) => {
  await switchMode(page, "Resource");

  for (const iri of ["urn:tbbt:penny", "urn:tbbt:sheldon-cooper"]) {
    await page.locator(".resource-input").fill(iri);
    await page.getByRole("button", { name: "Dereference" }).click();
    await expect(page.locator(".resource-title")).toBeVisible();
  }

  await expect(page.locator(".history-query")).toHaveText([
    "sheldon-cooper",
    "penny",
  ]);
  await expect(page.locator(".history-meta").first()).toContainText("statements");

  await page.reload();
  await waitForApp(page);
  await expect(page.locator(".history-query")).toHaveCount(2);

  await page.locator(".history-main").last().click();
  await expect(page.locator(".resource-title")).toHaveText("penny");
});

test("opens the query behind the page", async ({ page }) => {
  await page.goto("/?mode=resource&uri=urn:tbbt:penny");
  await waitForApp(page);
  await expect(page.locator(".resource-title")).toBeVisible();

  await page.getByRole("button", { name: "Open as a query" }).click();
  await expect.poll(() => editorValue(page)).toContain("<urn:tbbt:penny> ?predicate ?value");

  await runQuery(page);
  await expect(page.locator(".results-table tbody tr").first()).toBeVisible();
});

test("is reachable from a query result", async ({ page }) => {
  // "People" projects only literals; this one puts IRIs in the table.
  await page.locator(".chip", { hasText: /^All triples$/ }).click();
  await runQuery(page);
  await expect(page.locator(".results-table tbody tr").first()).toBeVisible();

  await page.locator(".results-table .term-link").first().click();
  await expect(page.locator(".resource-title")).toBeVisible();
  await expect(page).toHaveURL(/mode=resource/);
});

test("is reachable from the explore panel, and can send an IRI to the canvas", async ({
  page,
}) => {
  await switchMode(page, "Explore");
  await page.waitForSelector(".explore-panel .explore-row", { timeout: 30_000 });
  await openFirstClass(page);

  const row = page.locator(".explore-panel .explore-row", { hasText: "penny" });
  await row.hover();
  await row.getByRole("button", { name: /Open .* as a resource/ }).click();
  await expect(page.locator(".resource-title")).toHaveText("penny");

  await page.getByRole("button", { name: "Add to the canvas" }).click();
  await expect.poll(() => canvasStatus(page), { timeout: 30_000 }).toContain("1 node");
  await expect(page.locator(".node-label")).toHaveText(["penny"]);
});

test("is reachable from a canvas node", async ({ page }) => {
  await switchMode(page, "Explore");
  await page.waitForSelector(".explore-panel .explore-row", { timeout: 30_000 });
  await openFirstClass(page);
  await addRowToCanvas(page, "sheldon-cooper");

  await page.locator(".node").first().click();
  await expect(page.locator(".inspector")).toBeVisible();
  await page.getByRole("button", { name: "Open as a resource" }).click();

  await expect(page.locator(".resource-title")).toHaveText("sheldon-cooper");
});

test("expands a blank node inline instead of showing an opaque label", async ({
  page,
}) => {
  // Sheldon's address is a blank node in the bundled dataset.
  await page.goto("/?mode=resource&uri=urn:tbbt:sheldon-cooper");
  await waitForApp(page);
  await expect(page.locator(".resource-title")).toBeVisible();

  const address = page
    .locator(".resource-property", { hasText: "address" })
    .first();

  await expect(address.locator(".resource-nested")).toBeVisible();
  await expect(address).not.toContainText("_:");

  const nested = await address
    .locator(".resource-properties--nested dt")
    .allInnerTexts();
  expect(nested).toEqual(
    expect.arrayContaining(["streetAddress", "addressLocality", "postalCode"])
  );
  await expect(address).toContainText("Pasadena");
});

test("puts outgoing statements before incoming ones", async ({ page }) => {
  await page.goto("/?mode=resource&uri=urn:tbbt:sheldon-cooper");
  await waitForApp(page);

  const titles = await page.locator(".resource-section-title").allInnerTexts();
  expect(titles[0]).toContain("PROPERTIES");
  expect(titles[1]).toContain("REFERENCED BY");

  // The query must rank them too, so truncation cuts the incoming tail.
  await page.getByRole("button", { name: "Open as a query" }).click();
  const query = await editorValue(page);
  expect(query.indexOf("BIND(0 AS ?rank)")).toBeLessThan(
    query.indexOf("BIND(1 AS ?rank)")
  );
  expect(query).toContain("ORDER BY ?rank ?predicate");
});

test("fills the height it is given on a narrow screen", async ({ page }) => {
  // Resource mode has a single panel, but the narrow-screen layout is a
  // two-row grid: without an override the panel took the top row and the
  // content was cut off against empty space.
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/?mode=resource&uri=urn:tbbt:sheldon-cooper");
  await waitForApp(page);
  await expect(page.locator(".resource-title")).toBeVisible();

  const workspace = await page.locator(".workspace:not([hidden])").boundingBox();
  const panel = await page.locator(".resource-panel").boundingBox();

  // Only the workspace padding should separate the two.
  expect(panel!.height).toBeGreaterThan(workspace!.height - 40);
});

test("lines the IRI input up with the content below it", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto("/?mode=resource&uri=urn:tbbt:sheldon-cooper");
  await waitForApp(page);
  await expect(page.locator(".resource-title")).toBeVisible();

  const input = await page.locator(".resource-input").boundingBox();
  const title = await page.locator(".resource-title").boundingBox();

  // Left edges share the reading column rather than the input hugging the
  // far left of a very wide panel.
  expect(Math.abs(input!.x - title!.x)).toBeLessThan(2);
});
