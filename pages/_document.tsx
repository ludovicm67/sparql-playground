import { Head, Html, Main, NextScript } from "next/document";
import { STORAGE_KEYS } from "../lib/storage";

/**
 * Runs before the first paint, ahead of React, so a saved light theme never
 * shows a frame of dark first. Anything it cannot read is left alone: with no
 * `data-theme` the stylesheet follows the system, which is the default anyway.
 *
 * Inlined as a string because it has to execute synchronously in <head>, which
 * is earlier than any module the bundler would emit.
 */
const noFlashScript = `
(function () {
  try {
    var stored = JSON.parse(localStorage.getItem(${JSON.stringify(
      STORAGE_KEYS.theme
    )}));
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {}
})();
`;

const Document = () => (
  <Html lang="en">
    <Head>
      <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
    </Head>
    <body>
      <Main />
      <NextScript />
    </body>
  </Html>
);

export default Document;
