import "server-only";
import type { AuthenticationDependencies } from "@/lib/auth/identity-provider";
import type { ArtifactStorage } from "@/lib/artifacts/artifact-storage";
import { assertRuntimeSafety } from "@/lib/config/runtime-config";

export type ApplicationDependencies = {
  authentication: AuthenticationDependencies;
  artifacts: ArtifactStorage;
};

let dependenciesPromise: Promise<ApplicationDependencies> | undefined;

async function composeDependencies(): Promise<ApplicationDependencies> {
  const runtime = assertRuntimeSafety();
  if (runtime.providers.auth === "isolated") {
    const [{ validationAuthentication }, { localArtifactStorage }] =
      await Promise.all([
        import(
          "../../../tests/harness/providers/validation-authentication-provider"
        ),
        import("../../../tests/harness/providers/local-artifact-storage"),
      ]);
    return {
      authentication: validationAuthentication,
      artifacts: localArtifactStorage,
    };
  }

  const [{ clerkAuthentication }, { supabaseArtifactStorage }] =
    await Promise.all([
      import("@/lib/auth/clerk-authentication-provider"),
      import("@/lib/artifacts/supabase-artifact-storage"),
    ]);
  return {
    authentication: clerkAuthentication,
    artifacts: supabaseArtifactStorage,
  };
}

/**
 * Process-lifetime dependency graph. Selection occurs once and consumers see
 * interfaces only; they never inspect validation mode or provider settings.
 */
export function getApplicationDependencies(): Promise<ApplicationDependencies> {
  dependenciesPromise ??= composeDependencies();
  return dependenciesPromise;
}
