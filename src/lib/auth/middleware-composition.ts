import type { NextMiddleware } from "next/server";
import { assertRuntimeSafety } from "@/lib/config/runtime-config";

async function composeMiddleware(): Promise<NextMiddleware> {
  const runtime = assertRuntimeSafety();
  if (runtime.providers.auth === "isolated") {
    const { validationMiddleware } = await import(
      "../../../tests/harness/providers/validation-middleware"
    );
    return validationMiddleware;
  }
  const { productionMiddleware } = await import(
    "@/lib/auth/production-middleware"
  );
  return productionMiddleware as NextMiddleware;
}

export const composedMiddleware = composeMiddleware();
