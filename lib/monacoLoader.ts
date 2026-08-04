import { loader } from "@monaco-editor/react";

/**
 * Where `scripts/copy-monaco.mjs` puts the editor. Absolute because the site is
 * served from the root of its own domain; a `basePath` in `next.config.mjs`
 * would have to be prefixed here too.
 */
export const MONACO_PATH = "/monaco/vs";

/**
 * Serve Monaco from our own origin instead of the CDN the loader defaults to.
 *
 * Importing this module is the whole point of it — `_app.tsx` does so once, on
 * startup, which is early enough because the configuration only has to be in
 * place before the first `<Editor>` mounts. It is safe during the static
 * export: `config` merges into a plain object and touches no DOM.
 */
loader.config({ paths: { vs: MONACO_PATH } });
