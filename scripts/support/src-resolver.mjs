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

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export {};", shortCircuit: true };
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
