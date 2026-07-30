import { execSync } from "node:child_process";

const REPOSITORY = "https://github.com/ludovicm67/sparql-playground";

const git = (command) => {
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // No git, or not a repository: a tarball build has neither.
    return "";
  }
};

/**
 * The commit this build came from. GitHub Actions sets `GITHUB_SHA`; locally we
 * ask git. Neither is guaranteed, so the UI treats an empty string as
 * "unknown" rather than breaking.
 */
const commitSha = () => process.env.GITHUB_SHA || git("git rev-parse HEAD");

/** Whether the working tree had uncommitted changes, so the UI can say so. */
const isDirty = () =>
  process.env.GITHUB_SHA ? false : git("git status --porcelain").length > 0;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  // Replaces the deprecated `next-transpile-modules` package.
  transpilePackages: ["oxigraph", "qlue-ls"],
  env: {
    NEXT_PUBLIC_COMMIT_SHA: commitSha(),
    NEXT_PUBLIC_COMMIT_DIRTY: isDirty() ? "1" : "",
    NEXT_PUBLIC_REPOSITORY: REPOSITORY,
  },
};

export default nextConfig;
