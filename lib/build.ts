/**
 * Build provenance, injected by `next.config.js` at build time. Everything here
 * may be empty: a build from a tarball has no git metadata and no CI variables.
 */
export const COMMIT_SHA = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "";

export const COMMIT_DIRTY = process.env.NEXT_PUBLIC_COMMIT_DIRTY === "1";

export const REPOSITORY =
  process.env.NEXT_PUBLIC_REPOSITORY ??
  "https://github.com/ludovicm67/sparql-playground";

export const SHORT_SHA = COMMIT_SHA.slice(0, 7);

export const COMMIT_URL = COMMIT_SHA
  ? `${REPOSITORY}/commit/${COMMIT_SHA}`
  : undefined;

/** The author's site, linked from the sidebar footer. */
export const AUTHOR_URL = "https://ludovic-muller.fr/";
