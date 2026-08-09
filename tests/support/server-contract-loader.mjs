import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Unit-test-only resolver for server modules.
 *
 * Production is compiled with Next's bundler, which resolves extensionless
 * TypeScript imports, the `@/` path alias, and the `server-only` marker.
 * Node's strip-types runner does none of the three. This loader supplies only
 * those resolution behaviors so contract tests can import the real server-side
 * modules without copying their mapping logic.
 */

/** `@/x` → `<repo>/src/x`, matching tsconfig `paths`. */
const SRC = new URL("../../src/", import.meta.url);

function resolveAlias(specifier) {
  const rest = specifier.slice(2);
  const base = new URL(rest, SRC);
  for (const candidate of [base.href, `${base.href}.ts`, `${base.href}.tsx`]) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  // Directory import — mirror the bundler's index resolution.
  for (const index of ["index.ts", "index.tsx"]) {
    const candidate = new URL(`${rest}/${index}`, SRC);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      url: "data:text/javascript,export {};",
      shortCircuit: true,
    };
  }

  // The alias is resolved BEFORE delegating: `@/lib/costing` is not a relative
  // specifier, so it would fail as a bare package name and never reach the
  // extension-recovery branch below.
  if (specifier.startsWith("@/")) {
    const url = resolveAlias(specifier);
    if (url) return { url, shortCircuit: true };
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

    for (const extension of [".ts", ".tsx"]) {
      const candidate = new URL(`${specifier}${extension}`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    throw error;
  }
}
