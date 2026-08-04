import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  {
    // `public/monaco` is the editor copied out of node_modules by
    // `scripts/copy-monaco.mjs` — third-party minified code, not ours to lint.
    ignores: [".next/**", "out/**", "node_modules/**", "public/monaco/**"],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default eslintConfig;
