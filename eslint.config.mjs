import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/*
 * Two dependencies are held back on purpose, both by this file's plugins.
 * Re-checked against eslint-config-next 16.3.0 — neither is ready yet:
 *
 *   eslint      pinned to 9.x. eslint-plugin-react, eslint-plugin-jsx-a11y and
 *               eslint-plugin-import all still cap their peer range at ^9. On
 *               10.x every lint run dies in eslint-plugin-react with
 *               "contextOrFilename.getFilename is not a function".
 *
 *   typescript  pinned to 6.x. `tsc` and `next build` are both happy on 7.x,
 *               but the typescript-eslint bundled inside eslint-config-next
 *               throws "typescript-eslint does not support TS 7.0" on load,
 *               which takes linting with it.
 *
 * Both unblock when eslint-config-next ships newer plugins; nothing here needs
 * changing when they do.
 */

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  {
    // `public/monaco` is the editor copied out of node_modules by
    // `scripts/copy-monaco.mjs` — third-party minified code, not ours to lint.
    ignores: [
      ".next/**",
      "out/**",
      "node_modules/**",
      "public/monaco/**",
      // Playwright's own output: reports, traces and failure screenshots.
      "playwright-report/**",
      "blob-report/**",
      "test-results/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    // Playwright fixtures take a `use` callback and are keyed by fixture name,
    // which the React hook rules mistake for a hook called in a component.
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];

export default eslintConfig;
