import "server-only";
import type { AuthenticationDependencies } from "@/lib/auth/identity-provider";
import { assertRuntimeSafety } from "@/lib/config/runtime-config";

export type ApplicationDependencies = {
  authentication: AuthenticationDependencies;
};

let dependenciesPromise: Promise<ApplicationDependencies> | undefined;

async function composeDependencies(): Promise<ApplicationDependencies> {
  const runtime = assertRuntimeSafety();
  if (runtime.providers.auth === "isolated") {
    const { validationAuthentication } = await import(
      "../../../tests/harness/providers/validation-authentication-provider"
    );
    return { authentication: validationAuthentication };
  }

  const { clerkAuthentication } = await import(
    "@/lib/auth/clerk-authentication-provider"
  );
  return { authentication: clerkAuthentication };
}

/**
 * Process-lifetime dependency graph. Selection occurs once and consumers see
 * interfaces only; they never inspect validation mode or provider settings.
 */
export function getApplicationDependencies(): Promise<ApplicationDependencies> {
  dependenciesPromise ??= composeDependencies();
  return dependenciesPromise;
}
