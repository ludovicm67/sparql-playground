import { expect, test, waitForApp, waitForEditor } from "./support";

const background = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const themeButton = (page: import("@playwright/test").Page) =>
  page.locator('.header-link[aria-label*="theme"]');

test.describe("theme", () => {
  test("follows a dark system by default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await waitForApp(page);

    // No attribute at all: the stylesheet is left to follow the system.
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    expect(await background(page)).toBe("rgb(10, 12, 17)");
  });

  test("follows a light system by default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await waitForApp(page);

    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    expect(await background(page)).toBe("rgb(244, 246, 251)");
  });

  test("reacts to the system changing while open", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await waitForEditor(page);
    const dark = await background(page);

    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(400);

    expect(await background(page)).not.toBe(dark);
    // The editor is themed in JavaScript, so it has to be told.
    const editor = await page
      .locator(".monaco-editor")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(editor).toBe("rgb(255, 255, 255)");
  });

  test("cycles system, light, dark and back", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await waitForApp(page);

    const button = themeButton(page);
    await expect(button).toHaveAttribute("aria-label", /System theme/);

    await button.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await background(page)).toBe("rgb(244, 246, 251)");

    await button.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await button.click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  });

  test("keeps the choice across a reload, overriding the system", async ({ page }) => {
    // A light choice against a dark system is the case a reload could betray.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await waitForApp(page);
    await themeButton(page).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.reload();
    await waitForApp(page);

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await background(page)).toBe("rgb(244, 246, 251)");
  });

  test("applies the stored theme before the first paint", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await waitForApp(page);
    await themeButton(page).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Read the attribute at the earliest moment a script can run: if it were
    // set by React instead, this would still be null and the page would show a
    // frame of dark first.
    const atDocumentStart: string[] = [];
    await page.exposeFunction("recordTheme", (value: string) =>
      atDocumentStart.push(value)
    );
    await page.addInitScript(() => {
      document.addEventListener("readystatechange", () => {
        if (document.readyState === "interactive") {
          const value = document.documentElement.getAttribute("data-theme");
          (window as unknown as { recordTheme: (v: string) => void }).recordTheme(
            String(value)
          );
        }
      });
    });

    await page.reload();
    await waitForApp(page);

    expect(atDocumentStart).toEqual(["light"]);
  });

  test("keeps the theme when the stored data is cleared", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await waitForApp(page);
    await themeButton(page).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: "Clear all stored data" }).click();
    const dialog = page.locator("dialog.dialog--confirm");
    await dialog.getByRole("button", { name: "Clear everything" }).click();
    await expect(dialog).toHaveCount(0);

    // Connections went; the way the interface looks did not.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});
