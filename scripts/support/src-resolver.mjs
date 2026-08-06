import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Lets a plain node script import the REAL modules under src/.
 *
 * Verification scripts have to exercise the actual writer, not a
 * re-implementation of it — a proof that runs against a copy proves something
 * about the copy. Three resolution behaviours stand between `node` and src/,
 * all of which Next's bundler supplies in production:
 *
 *   "server-only"          — throws by design outside a server bundle; stubbed
 *                            to an empty module, exactly as the framework's
 *                            react-server condition does
 *   "@/..." path aliases   — tsconfig paths, mapped here to src/ on disk
 *   extensionless imports  — "./schema" for schema.ts
 *
 * Deliberately narrow: it adds resolution only, no transformation. Sibling of
 * tests/support/server-contract-loader.mjs, which does the same job for the
 * unit suite; this one additionally understands the "@/" alias. Kept separate
 * so changes here cannot alter how the governed test command behaves.
 */

const SRC = pathToFileURL(`${process.cwd()}/src/`).href;
const EXTENSIONS = [".ts", ".tsx", "/index.ts", ".js"];

function probe(baseHref) {
  for (const extension of EXTENSIONS) {
    const candidate = `${baseHref}${extension}`;
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return existsSync(fileURLToPath(baseHref)) ? baseHref : null;
}

/**
 * `next/cache` only exists inside the framework's module graph. Verification
 * scripts read; they never revalidate. Stubbing the invalidation API to no-ops
 * therefore cannot change any value a script measures — but note the asymmetry:
 * this makes WRITE paths silently non-revalidating under a script, so a script
 * that mutates through an action must not rely on revalidation having happened.
 */
const NEXT_CACHE_STUB =
  "data:text/javascript," +
  encodeURIComponent(
    "export const revalidatePath = () => {};" +
      "export const revalidateTag = () => {};" +
      "export const unstable_cache = (fn) => fn;" +
      "export const unstable_noStore = () => {};",
  );

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export {};", shortCircuit: true };
  }
  if (specifier === "next/cache") {
    return { url: NEXT_CACHE_STUB, shortCircuit: true };
  }
  /**
   * Server-action modules import auth and navigation at module scope for their
   * WRITE actions, so importing one read function drags the whole framework in.
   *
   * Stubbing these is only safe when the function under test does not call
   * them, and that must be VERIFIED per script rather than assumed — a stubbed
   * guard is a guard that passes. Checked for the S-7 baseline:
   * `getCostingBundle` calls neither `ensureUser` nor `requireAdmin*`; the
   * imports serve sibling write actions in the same file.
   *
   * Any script that exercises a write path must not rely on these stubs.
   */
  if (specifier === "next/navigation") {
    return {
      url:
        "data:text/javascript," +
        encodeURIComponent(
          "export const redirect = () => { throw new Error('redirect() called under a verification script'); };" +
            "export const notFound = () => { throw new Error('notFound() called under a verification script'); };",
        ),
      shortCircuit: true,
    };
  }

  if (specifier.startsWith("@/")) {
    const found = probe(SRC + specifier.slice(2));
    if (found) return { url: found, shortCircuit: true };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code !== "ERR_MODULE_NOT_FOUND" ||
      !context.parentURL ||
      !(specifier.startsWith("./") || specifier.startsWith("../"))
    ) {
      throw error;
    }
    const found = probe(new URL(specifier, context.parentURL).href);
    if (found) return { url: found, shortCircuit: true };
    throw error;
  }
}
