#!/usr/bin/env node
/**
 * Copies the Monaco editor out of `node_modules` and into `public/`, so it is
 * served from our own origin.
 *
 * `@monaco-editor/react` ships only a loader: left to its defaults it fetches
 * the editor itself from a CDN at runtime. That pins the running version
 * outside our lockfile (the CDN served 0.55.1 while `package-lock.json` said
 * 0.56.0), breaks the app without a network, and hands a third party the code
 * we execute. `lib/monacoLoader.ts` points the loader at what this script
 * writes instead.
 *
 * Runs from the `predev` and `prebuild` npm scripts, so a fresh clone needs no
 * extra step. The copy is gitignored: it is a build artefact, not a vendored
 * dependency.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// The package's `exports` map hides `min/`, but the CommonJS entry point sits
// inside it, so its directory is the distribution we want.
const source = path.dirname(require.resolve("monaco-editor"));
const packageRoot = path.resolve(source, "../..");
const destination = path.resolve(import.meta.dirname, "../public/monaco/vs");
const stamp = path.join(destination, "..", ".version");

/**
 * Whole directories we never request. `language/` holds the TypeScript, JSON,
 * CSS and HTML language services; the editor here only ever opens SPARQL
 * documents, whose grammar lives in `basic-languages/`.
 */
const SKIP_DIRECTORIES = new Set(["language"]);

/**
 * The worker payloads backing those same four language services — `ts.worker`
 * alone is 6.7 MB. Only the copies under `assets/` are skippable: those are
 * fetched lazily, and only once a model of that language exists, which cannot
 * happen here. The same-named stubs at the root are pulled in eagerly by
 * `editor.main.js`, so dropping those breaks the editor outright.
 *
 * Matched on prefix because the distribution content-hashes its filenames, so
 * pinning exact names would silently stop matching on the next upgrade. Note
 * that `editor.worker`, which we do need, shares none of these prefixes.
 */
const SKIP_ASSET_PREFIXES = ["ts.worker", "css.worker", "html.worker", "json.worker"];

const version = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8")
).version;

const current = await readFile(stamp, "utf8").catch(() => "");
if (current.trim() === version) {
  console.log(`monaco ${version} already in public/monaco`);
  process.exit(0);
}

const filter = (candidate) => {
  const relative = path.relative(source, candidate);
  if (!relative) {
    return true;
  }
  const segments = relative.split(path.sep);
  if (SKIP_DIRECTORIES.has(segments[0])) {
    return false;
  }
  if (segments[0] !== "assets") {
    return true;
  }
  const name = path.basename(candidate);
  return !SKIP_ASSET_PREFIXES.some((prefix) => name.startsWith(prefix));
};

// Removed rather than merged: a stale chunk from a previous version would
// otherwise linger and be served under its old content-hashed name.
await rm(path.dirname(destination), { recursive: true, force: true });
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true, filter });
await writeFile(stamp, `${version}\n`);

console.log(`copied monaco ${version} to public/monaco`);
