// The bare `test`, deliberately: every other spec uses the fixture in
// ./support that arrives as a returning visitor, which is exactly what these
// tests need to not be.
import { expect, test } from "@playwright/test";
import { TOUR_STEPS } from "../lib/tour";

const TOUR_KEY = "sparql-playground:tour";

const invite = (page: import("@playwright/test").Page) =>
  page.locator("dialog.dialog--invite");

const storedChoice = (page: import("@playwright/test").Page) =>
  page.evaluate((key: string) => localStorage.getItem(key), TOUR_KEY);

test("offers the tour on a first visit", async ({ page }) => {
  await page.goto("/");
  await expect(invite(page)).toBeVisible();
  await expect(invite(page)).toContainText("First time here?");
});

test("remembers a decline and never asks again", async ({ page }) => {
  await page.goto("/");
  await invite(page).getByRole("button", { name: /poke around myself/ }).click();

  await expect(invite(page)).toHaveCount(0);
  expect(await storedChoice(page)).toBe('"declined"');

  await page.reload();
  await page.waitForSelector(".app-header");
  await page.waitForTimeout(600);
  await expect(invite(page)).toHaveCount(0);
});

test("closing the invitation counts as an answer", async ({ page }) => {
  await page.goto("/");
  await invite(page).getByRole("button", { name: "No thanks" }).click();

  expect(await storedChoice(page)).toBe('"declined"');
});

test("walks the whole story and leaves a question in the editor", async ({ page }) => {
  await page.goto("/");
  await invite(page).getByRole("button", { name: /Show me around/ }).click();

  const tour = page.locator(".tour");
  await expect(tour).toBeVisible();
  await expect(page.locator(".tour-title")).toHaveText(TOUR_STEPS[0].title);

  const next = page.getByRole("button", { name: /^Next$/ });
  const stepTitled = (id: string) =>
    TOUR_STEPS[TOUR_STEPS.findIndex((step) => step.id === id)].title;

  // Advances until the named step is showing, so the test survives the story
  // being re-cut without turning into a pile of magic click counts.
  const advanceTo = async (id: string) => {
    for (let guard = 0; guard < TOUR_STEPS.length; guard++) {
      if ((await page.locator(".tour-title").innerText()) === stepTitled(id)) {
        return;
      }
      await next.click();
      await page.waitForTimeout(150);
    }
    throw new Error(`the tour never reached "${id}"`);
  };

  // The query runs, unlimited, and shows the whole cast the story talks about.
  await advanceTo("results");
  await expect(page.locator(".results-table tbody tr")).toHaveCount(9);
  await expect(page.locator(".results-table")).toContainText("mary-cooper");
  await expect(page.locator(".results-table")).toContainText("Apartment 4B");

  // Each handover is pointed at, not merely described.
  await advanceTo("term-link");
  await expect(page.locator(".results-table .term-link").first()).toBeVisible();

  await advanceTo("resource");
  await expect(page.locator(".resource-title")).toHaveText("sheldon-cooper");

  await advanceTo("mary");
  await expect(page.locator(".resource-title")).toHaveText("mary-cooper");

  await advanceTo("back-to-query");
  await expect(page.locator('[data-tour="resource-query"]')).toBeVisible();
  await advanceTo("to-canvas");
  await expect(page.locator('[data-tour="resource-canvas"]')).toBeVisible();

  // Both ends of the link on the canvas, and the link between them drawn.
  await advanceTo("canvas");
  await expect(page.locator(".node")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator(".edge").first()).toBeVisible();

  await advanceTo("done");
  await page.getByRole("button", { name: "Start exploring" }).click();

  await expect(tour).toHaveCount(0);
  expect(await storedChoice(page)).toBe('"taken"');

  // It ends by handing over a question rather than just stopping.
  await expect(page.locator('[data-tour="editor"]')).toBeVisible();
  await expect(page.locator('[data-tour="editor"]')).toContainText("penny");
});

test("can be taken again from the sidebar", async ({ page }) => {
  await page.goto("/");
  await invite(page).getByRole("button", { name: /poke around myself/ }).click();
  await expect(invite(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Tour", exact: true }).click();

  await expect(page.locator(".tour")).toBeVisible();
  await expect(page.locator(".tour-title")).toHaveText(TOUR_STEPS[0].title);
});

test("can be left at any point, and is not offered again", async ({ page }) => {
  await page.goto("/");
  await invite(page).getByRole("button", { name: /Show me around/ }).click();
  await page.getByRole("button", { name: /^Next$/ }).click();

  await page.keyboard.press("Escape");
  await expect(page.locator(".tour")).toHaveCount(0);
  expect(await storedChoice(page)).toBe('"taken"');

  await page.reload();
  await page.waitForSelector(".app-header");
  await page.waitForTimeout(600);
  await expect(invite(page)).toHaveCount(0);
});

test("is offered again after the stored data is cleared", async ({ page }) => {
  await page.goto("/");
  await invite(page).getByRole("button", { name: /poke around myself/ }).click();
  await expect(invite(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Clear all stored data" }).click();
  const confirm = page.locator("dialog.dialog--confirm");
  await confirm.getByRole("button", { name: "Clear everything" }).click();
  await expect(confirm).toHaveCount(0);

  // Someone wiping the app is starting over, so the offer comes back.
  expect(await storedChoice(page)).toBe(null);
  await page.reload();
  await expect(invite(page)).toBeVisible();
});

test("takes over the connection and the editor, whatever was there", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("sparql-playground:tour", JSON.stringify("declined"));
    localStorage.setItem(
      "sparql-playground:connections",
      JSON.stringify([
        { id: "local-tbbt", kind: "local", name: "TBBT (Oxigraph in browser)" },
        {
          id: "elsewhere",
          kind: "remote",
          name: "Somewhere else",
          endpoint: "https://example.org/sparql",
          headers: [],
          auth: { kind: "none" },
        },
      ])
    );
    localStorage.setItem(
      "sparql-playground:active-connection",
      JSON.stringify("elsewhere")
    );
  });
  await page.reload();
  await page.waitForSelector(".app-header");

  await expect(page.locator(".connection.is-active")).toContainText("Somewhere else");

  await page.getByRole("button", { name: "Tour", exact: true }).click();

  // The story describes the built-in data, so it must be running against it.
  await expect(page.locator(".connection.is-active")).toContainText("TBBT");
  await expect(page.locator('[data-tour="editor"]')).toContainText("schema:Person");
});

test("asks before overwriting a query that is not its own", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("sparql-playground:tour", JSON.stringify("declined"));
    localStorage.setItem(
      "sparql-playground:draft",
      JSON.stringify("SELECT * WHERE { ?mine ?work ?here }")
    );
  });
  await page.reload();
  await page.waitForSelector(".monaco-editor");

  await page.getByRole("button", { name: "Tour", exact: true }).click();

  const confirmDialog = page.locator("dialog.dialog--confirm");
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Cancel" }).click();

  // Declining leaves the work alone and does not start the tour.
  await expect(page.locator(".tour")).toHaveCount(0);
  await expect(page.locator('[data-tour="editor"]')).toContainText("?mine");
});

test("keeps the app out of reach while it is running", async ({ page }) => {
  await page.goto("/");
  await invite(page).getByRole("button", { name: /Show me around/ }).click();
  await expect(page.locator(".tour")).toBeVisible();

  const title = await page.locator(".tour-title").innerText();

  // Clicking through would leave the story describing a screen that has moved
  // on without it, which is what the overlay exists to prevent.
  await page
    .locator(".mode-switch button", { hasText: "Explore" })
    .click({ force: true, timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(500);

  await expect(page.locator(".tour-title")).toHaveText(title);
  await expect(page.locator('[data-tour="editor"]')).toBeVisible();

  // And the same for the keyboard.
  await expect(page.locator(".app-body")).toHaveAttribute("inert", /.*/);
});

test("goes back through every step without stranding the overlay", async ({
  page,
}) => {
  await page.goto("/");
  await invite(page).getByRole("button", { name: /Show me around/ }).click();

  const next = page.getByRole("button", { name: /^Next$/ });
  for (let step = 1; step < TOUR_STEPS.length; step++) {
    await next.click();
    await page.waitForTimeout(120);
  }
  await expect(page.locator(".tour-progress")).toContainText(
    `${TOUR_STEPS.length} of ${TOUR_STEPS.length}`
  );

  // Back re-enters each step after the app has moved on. The card must stay on
  // screen the whole way — it is the only way out — and each step has to put
  // its own screen back rather than describing the one it landed in.
  const card = page.locator(".tour-card");
  const back = page.getByRole("button", { name: "Back" });

  // The first Back lands on the second-to-last step.
  for (let step = TOUR_STEPS.length - 2; step >= 0; step--) {
    await back.click();
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS("opacity", "1");
    await expect(page.locator(".tour-title")).toHaveText(TOUR_STEPS[step].title);
  }

  await expect(page.locator(".tour-title")).toHaveText(TOUR_STEPS[0].title);
});

test("puts the right screen back when stepping backwards", async ({ page }) => {
  await page.goto("/");
  await invite(page).getByRole("button", { name: /Show me around/ }).click();

  const next = page.getByRole("button", { name: /^Next$/ });
  const back = page.getByRole("button", { name: "Back" });
  const titleOf = (id: string) =>
    TOUR_STEPS[TOUR_STEPS.findIndex((step) => step.id === id)].title;

  const advanceTo = async (id: string) => {
    for (let guard = 0; guard < TOUR_STEPS.length; guard++) {
      if ((await page.locator(".tour-title").innerText()) === titleOf(id)) {
        return;
      }
      await next.click();
      await page.waitForTimeout(150);
    }
    throw new Error(`the tour never reached "${id}"`);
  };

  await advanceTo("canvas");
  await expect(page.locator(".node")).toHaveCount(2, { timeout: 20_000 });

  // Back out of the canvas: these steps describe buttons on Mary's page, so
  // that is what has to be showing.
  await back.click();
  await expect(page.locator(".tour-title")).toHaveText(titleOf("to-canvas"));
  await expect(page.locator(".resource-title")).toHaveText("mary-cooper");
  await expect(page.locator('[data-tour="resource-canvas"]')).toBeVisible();

  await back.click();
  await back.click();
  // And back past Mary, Sheldon's page returns rather than hers lingering.
  await back.click();
  await expect(page.locator(".tour-title")).toHaveText(titleOf("incoming"));
  await expect(page.locator(".resource-title")).toHaveText("sheldon-cooper");
});
