/**
 * Node strips TypeScript natively, but its ESM resolver still wants a file
 * extension. The app's source uses extensionless relative imports (which the
 * bundler resolves), so map `./foo` to `./foo.ts` when that is what exists.
 */
export async function resolve(specifier, context, next) {
  const isRelative = specifier.startsWith(".") || specifier.startsWith("/");
  const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier);

  if (isRelative && !hasExtension) {
    for (const extension of [".ts", ".tsx"]) {
      try {
        return await next(`${specifier}${extension}`, context);
      } catch {
        // Try the next candidate, then fall back to the default resolution.
      }
    }
  }

  return next(specifier, context);
}
