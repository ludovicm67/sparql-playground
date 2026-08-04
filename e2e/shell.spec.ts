import { expect, test } from "@playwright/test";
import {
  addMockConnection,
  editorValue,
  setEditorValue,
  switchMode,
  tooltip,
  waitForApp,
  waitForEditor,
} from "./support";

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

test("shows its own tooltip instead of the browser's", async ({ page }) => {
  await page.goto("/");
  await waitForEditor(page);

  // Nothing of ours should carry a native `title` — that is what produces the
  // OS tooltip. Monaco's own DOM is not ours to change.
  const natives = await page.evaluate(() =>
    [...document.querySelectorAll("[title]")]
      .filter((element) => !element.closest(".monaco-editor"))
      .map((element) => element.tagName)
  );
  expect(natives).toEqual([]);

  const trigger = page.getByRole("button", { name: "Format this query" });
  await expect(trigger).toHaveAttribute("data-tooltip", /Format the query/);

  await expect(tooltip(page)).toHaveCount(0);
  await trigger.hover();
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).toContainText("Format the query");

  // It sits above the trigger and inside the viewport.
  const tip = (await tooltip(page).boundingBox())!;
  const anchor = (await trigger.boundingBox())!;
  expect(tip.y + tip.height).toBeLessThanOrEqual(anchor.y + 1);
  expect(tip.x).toBeGreaterThanOrEqual(0);

  await page.locator(".app-header").hover({ position: { x: 5, y: 5 } });
  await expect(tooltip(page)).toHaveCount(0);
});

test("dismisses the tooltip on Escape and keeps it out of the way of clicks", async ({
  page,
}) => {
  await page.goto("/");
  await waitForEditor(page);

  await page.getByRole("button", { name: "Share this query" }).hover();
  await expect(tooltip(page)).toBeVisible();

  // It must never intercept a click aimed at what it is describing.
  expect(
    await tooltip(page).evaluate((el) => getComputedStyle(el).pointerEvents)
  ).toBe("none");

  await page.keyboard.press("Escape");
  await expect(tooltip(page)).toHaveCount(0);
});

test("shows a tooltip on top of a modal dialog", async ({ page }) => {
  await page.goto("/");
  await waitForEditor(page);

  await page.getByRole("button", { name: "Add a connection" }).click();
  await page.waitForSelector("dialog.dialog");

  // A plain positioned element would be painted under the dialog's top layer.
  // Being an open popover *is* the guarantee of sitting above it; hit-testing
  // cannot show this because the tooltip deliberately ignores the pointer.
  await page.getByRole("button", { name: "GET", exact: true }).hover();
  await expect(tooltip(page)).toBeVisible();

  const layer = await tooltip(page).evaluate((element) => ({
    supported: typeof (element as HTMLElement).showPopover === "function",
    inTopLayer: element.matches(":popover-open"),
  }));

  expect(layer.supported).toBe(true);
  expect(layer.inTopLayer).toBe(true);

  // And it is placed over the dialog, not pushed off somewhere harmless.
  const tip = (await tooltip(page).boundingBox())!;
  const modal = (await page.locator("dialog.dialog").boundingBox())!;
  expect(tip.x).toBeGreaterThan(modal.x - tip.width);
  expect(tip.y).toBeGreaterThan(modal.y - tip.height);
});

test("asks before destroying things, in its own dialog", async ({ page }) => {
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => {
    nativeDialogs += 1;
    void dialog.dismiss();
  });

  await page.goto("/");
  await waitForEditor(page);
  await addMockConnection(page);
  await expect(page.locator(".connection-name")).toHaveCount(2);

  const row = page.locator(".connection", { hasText: "Mock" });
  await row.hover();
  await row.getByRole("button", { name: /Delete/ }).click();

  const dialog = page.locator("dialog.dialog--confirm");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Delete this connection?");
  await expect(dialog).toContainText("Mock");

  // Cancelling keeps the connection.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".connection-name")).toHaveCount(2);

  // Escape also means no.
  await row.hover();
  await row.getByRole("button", { name: /Delete/ }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".connection-name")).toHaveCount(2);

  // Confirming goes through.
  await row.hover();
  await row.getByRole("button", { name: /Delete/ }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".connection-name")).toHaveCount(1);

  expect(nativeDialogs, "the browser's own dialog was used").toBe(0);
});

test("keeps the whole header on screen on a small phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForApp(page);

  const header = page.locator(".app-header");
  await expect(header).toBeVisible();

  // Nothing may spill past the right edge: the repository link used to sit
  // off-screen entirely, with the connection pill cut in half.
  const overflow = await header.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const width = (await header.boundingBox())!.width;
  const link = await page.locator(".header-link").boundingBox();
  expect(link!.x + link!.width).toBeLessThanOrEqual(width);

  // The labels go, but the buttons keep their names.
  await expect(page.locator(".segment-label").first()).toBeHidden();
  await expect(page.getByRole("button", { name: "Explore", exact: true })).toBeVisible();
});

test("leaves room for the history when there are many connections", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);

  // A long connection list on a short screen used to take the whole sidebar,
  // leaving the history heading above nothing and no way to scroll to it.
  await page.evaluate(() => {
    const connections = [
      { id: "local-tbbt", kind: "local", name: "TBBT (Oxigraph in browser)" },
    ];
    for (let i = 0; i < 7; i++) {
      connections.push({
        id: "c" + i,
        kind: "remote",
        name: "Endpoint " + (i + 1),
        endpoint: "https://example.org/sparql",
        headers: [],
        auth: { kind: "none" },
      } as never);
    }
    localStorage.setItem("sparql-playground:connections", JSON.stringify(connections));
    localStorage.setItem(
      "sparql-playground:active-connection",
      JSON.stringify("local-tbbt")
    );
    localStorage.setItem(
      "sparql-playground:history",
      JSON.stringify({
        "local-tbbt": Array.from({ length: 8 }, (_, i) => ({
          id: "h" + i,
          query: "SELECT ?s WHERE { ?s ?p ?o } LIMIT " + (i + 1),
          at: Date.now() - i * 60_000,
          status: "ok",
          rows: i + 1,
          duration: 12,
        })),
      })
    );
  });

  await page.setViewportSize({ width: 390, height: 640 });
  await page.reload();
  await waitForApp(page);
  await page.getByRole("button", { name: /Show the sidebar/ }).click();

  const list = page.locator(".history-list");
  await expect(list).toBeVisible();

  // At least one entry readable, and the rest reachable by scrolling.
  const box = (await list.boundingBox())!;
  expect(box.height).toBeGreaterThan(60);

  const first = (await page.locator(".history-list li").first().boundingBox())!;
  expect(first.y + first.height).toBeLessThanOrEqual(box.y + box.height + 1);

  // The connections list keeps its own scroll rather than pushing history out.
  const connectionsScroll = await page
    .locator(".connection-list")
    .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(connectionsScroll).toBe(true);
});
