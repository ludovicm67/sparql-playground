import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

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
