import { existsSync, statSync } from "node:fs";
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
    // Must be a FILE. `@/x` where `src/x/` is a directory used to resolve to
    // the directory itself, which the loader then tried to read as a module
    // (EISDIR) instead of falling through to the index resolution below.
    const path = fileURLToPath(candidate);
    if (existsSync(path) && statSync(path).isFile()) return candidate;
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

  // `next/cache` exists only inside the Next runtime. A client component that
  // imports a server action pulls it in transitively at module load, which is
  // enough to stop the module being importable here at all -- so the cache
  // primitives are stubbed as no-ops. Nothing under test calls them; they are
  // in the graph, not on the path.
  if (specifier === "next/cache") {
    return {
      url:
        "data:text/javascript," +
        encodeURIComponent(
          "export const revalidatePath = () => {};" +
            "export const revalidateTag = () => {};" +
            "export const unstable_cache = (fn) => fn;" +
            "export const unstable_noStore = () => {};",
        ),
      shortCircuit: true,
    };
  }

  // `next/navigation` exists only inside the Next runtime. `admin-guard`
  // imports `redirect` for its PAGE guard; a walk exercising the ACTION guard
  // pulls it in transitively and cannot resolve it.
  //
  // The stub THROWS rather than returning: a redirect in a walk means a page
  // guard ran where an action guard was expected, and silently continuing
  // would let the walk pass having taken a path production never takes.
  if (specifier === "next/navigation") {
    return {
      url:
        "data:text/javascript," +
        encodeURIComponent(
          "export const redirect = (to) => { throw new Error('[walk] redirect(' + to + ') -- a page guard ran inside a walk'); };" +
            "export const notFound = () => { throw new Error('[walk] notFound()'); };" +
            "export const permanentRedirect = (to) => { throw new Error('[walk] permanentRedirect(' + to + ')'); };" +
            "export const useRouter = () => { throw new Error('[walk] useRouter() outside React'); };" +
            "export const usePathname = () => '/';" +
            "export const useSearchParams = () => new URLSearchParams();",
        ),
      shortCircuit: true,
    };
  }

  // `next/link` — Next ships `link.js`, so Node's resolver cannot load the
  // specifier production writes. Mapped to a plain-anchor stub: what a mounted
  // test asks of a link is where it points, and prefetch / route interception
  // are the framework's behaviour rather than the component's.
  if (specifier === "next/link") {
    return {
      url: new URL("./next-link-stub.tsx", import.meta.url).href,
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
