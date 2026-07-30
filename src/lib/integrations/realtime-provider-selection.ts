import type { ProviderKind } from "@/lib/config/runtime-config";

/**
 * Composition policy only. Realtime consumers do not inspect runtime mode;
 * the process-start composition root decides whether production Realtime is
 * mounted at all.
 */
export function mountsProductionRealtime(provider: ProviderKind): boolean {
  return provider === "production";
}
