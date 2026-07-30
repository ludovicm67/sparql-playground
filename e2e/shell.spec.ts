import { expect, test } from "@playwright/test";
import { editorValue, setEditorValue, switchMode, waitForApp, waitForEditor } from "./support";

test("serves a favicon in both formats", async ({ page, request }) => {
  await page.goto("/");
  await waitForApp(page);

  const icons = await page.evaluate(() =>
    [...document.querySelectorAll("link[rel*='icon']")].map((link) => ({
      rel: link.getAttribute("rel"),
      href: new URL((link as HTMLLinkElement).href).pathname,
    }))
  );

  expect(icons).toEqual(
    expect.arrayContaining([
      { rel: "icon", href: "/icon.svg" },
      { rel: "alternate icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ])
  );

  for (const { href } of icons) {
    const response = await request.get(href);
    expect(response.status(), href).toBe(200);
    expect((await response.body()).length, href).toBeGreaterThan(100);
  }
});

test("has a 404 page that leads back", async ({ page }) => {
  const response = await page.goto("/nope/nowhere");
  expect(response?.status()).toBe(404);

  await expect(page.locator(".notfound-title")).toBeVisible();
  await expect(page).toHaveTitle(/Not found/);

  await page.getByRole("link", { name: "Go to the playground" }).click();
  await waitForEditor(page);
  await expect(page).toHaveURL(/\/$/);
});

test("credits the author and links the commit", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);

  const credit = page.locator(".sidebar-credit");
  await expect(credit).toContainText("Made with");
  await expect(credit).toContainText("Ludovic Muller");

  const author = credit.locator("a");
  await expect(author).toHaveAttribute("href", "https://ludovic-muller.fr/");
  await expect(author).toHaveAttribute("target", "_blank");
  await expect(author).toHaveAttribute("rel", /noreferrer/);

  const build = page.locator(".sidebar-build");
  await expect(build).toContainText("Version");
  await expect(build.locator("a")).toHaveAttribute(
    "href",
    /github\.com\/ludovicm67\/sparql-playground\/commit\/[0-9a-f]{7,40}/
  );
});

test("tracks the mode in the URL and restores it on refresh", async ({ page }) => {
  await page.goto("/");
  await waitForEditor(page);
  await expect(page).toHaveURL(/\/$/);

  await switchMode(page, "Explore");
  await expect(page).toHaveURL(/\?mode=explore/);

  await switchMode(page, "Resource");
  await expect(page).toHaveURL(/\?mode=resource/);
  await page.locator(".resource-input").fill("urn:tbbt:penny");
  await page.getByRole("button", { name: "Dereference" }).click();
  await expect(page).toHaveURL(/uri=urn%3Atbbt%3Apenny/);

  await page.reload();
  await waitForApp(page);
  await expect(page.locator(".workspace--resource")).toBeVisible();
  await expect(page.locator(".resource-title")).toHaveText("penny");
});

test("restores the query draft on refresh", async ({ page }) => {
  await page.goto("/");
  await waitForEditor(page);
  await setEditorValue(page, "SELECT ?draft WHERE { ?draft ?p ?o } LIMIT 7");
  await page.waitForTimeout(800);

  await page.reload();
  await waitForEditor(page);
  expect(await editorValue(page)).toContain("?draft");
});

test("ignores nonsense in the query string", async ({ page }) => {
  await page.goto("/?mode=nonsense&uri=not%20an%20iri");
  await waitForEditor(page);

  // The resource view is always mounted (hidden), so target the query one.
  await expect(
    page.locator(".workspace:not(.workspace--resource):not(.workspace--explore)")
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("collapses to one column and an overlay sidebar on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 880 });
  await page.goto("/");
  await waitForEditor(page);

  // The sidebar starts closed so it does not bury the editor.
  await expect(page.locator(".sidebar")).toHaveCount(0);

  await page.getByRole("button", { name: /Show the sidebar/ }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  expect(
    await page.locator(".sidebar").evaluate((el) => getComputedStyle(el).position)
  ).toBe("absolute");

  await page.locator(".sidebar-backdrop").click({ position: { x: 500, y: 400 } });
  await expect(page.locator(".sidebar")).toHaveCount(0);
});

test("cancelling a run returns the panel to rest", async ({ page }) => {
  await page.goto("/");
  await waitForEditor(page);

  await page.route("**/sparql", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  });

  await page.getByRole("button", { name: "Add a connection" }).click();
  await page.waitForSelector("dialog.dialog");
  await page
    .locator(".field", { hasText: "Endpoint URL" })
    .locator("input")
    .first()
    .fill("http://127.0.0.1:4567/sparql");
  await page.getByRole("button", { name: "Add connection" }).click();
  await page.waitForSelector("dialog.dialog", { state: "detached" });

  await page.getByRole("button", { name: /Run query/ }).click();
  await expect(page.getByText("Running…")).toBeVisible();

  await page.getByRole("button", { name: /Cancel/ }).click();
  await expect(page.getByText("Nothing to show yet")).toBeVisible();
  await expect(page.getByRole("button", { name: /Run query/ })).toBeVisible();
});
