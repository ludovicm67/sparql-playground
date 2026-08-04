import { readFile } from "node:fs/promises";
import { expect, test, waitForEditor } from "./support";

/**
 * The editor used to be pulled from a CDN at runtime, which meant the version
 * our users ran was whatever that URL resolved to rather than the one in the
 * lockfile — and the app needed the network to show a text box at all. It is
 * copied into `public/` now, and these tests fail if that ever regresses.
 */
test.describe("self-hosted assets", () => {
  test("loads the editor without leaving our origin", async ({ page, baseURL }) => {
    const external: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith(baseURL!) && !url.startsWith("data:") && !url.startsWith("blob:")) {
        external.push(url);
      }
    });

    await page.goto("/");
    await waitForEditor(page);

    expect(external).toEqual([]);
  });

  test("serves every asset the editor asks for", async ({ page }) => {
    const failed: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failed.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto("/");
    await waitForEditor(page);
    // The SPARQL grammar and the editor worker arrive after first paint, so a
    // check that stopped at the editor being visible would miss a 404 in them.
    await page.waitForTimeout(1500);

    expect(failed).toEqual([]);
  });

  test("serves the Monaco version the lockfile pins", async ({ request }) => {
    const installed = JSON.parse(
      await readFile("node_modules/monaco-editor/package.json", "utf8")
    ).version;

    const served = await request.get("/monaco/.version");
    expect(served.ok()).toBe(true);
    expect((await served.text()).trim()).toBe(installed);
  });
});
