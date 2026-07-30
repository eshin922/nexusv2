import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Unit-test-only resolver for server modules.
 *
 * Production is compiled with Next's bundler, which resolves extensionless
 * TypeScript imports and the `server-only` marker. Node's strip-types runner
 * does neither. This loader supplies only those two resolution behaviors so
 * contract tests can import the real server-side payload builder without
 * copying its mapping logic.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      url: "data:text/javascript,export {};",
      shortCircuit: true,
    };
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
