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

// ── JSX ───────────────────────────────────────────────────────────────────
//
// `--experimental-strip-types` erases TYPES; it does not transform JSX, so a
// `.tsx` file reaches Node as an unknown extension. Mounted component tests
// need one, so `.tsx` -- and ONLY `.tsx` -- is transpiled here.
//
// Deliberately narrow. Every other module keeps going through Node's own type
// stripping, so adding this changes nothing about how the existing suite is
// executed: no `.ts` file takes a different path than it did before.
//
// TypeScript rather than a bundler because `typescript` is a first-class
// dependency of this repo; reaching for a transitive one would make the test
// runner depend on something nobody declared.
import { readFile } from "node:fs/promises";
import ts from "typescript";

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:") || !url.endsWith(".tsx")) {
    return nextLoad(url, context);
  }
  const source = await readFile(fileURLToPath(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
