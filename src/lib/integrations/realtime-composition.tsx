import { assertRuntimeSafety } from "@/lib/config/runtime-config";
import { mountsProductionRealtime } from "@/lib/integrations/realtime-provider-selection";

/**
 * Server composition root for the browser Realtime boundary.
 *
 * The production component (and therefore Supabase browser client) is loaded
 * only when process-start configuration selected the production provider.
 * Isolated mode renders no Realtime runtime and cannot be switched by request.
 */
export async function RealtimeCompositionProvider() {
  const runtime = assertRuntimeSafety();
  if (!mountsProductionRealtime(runtime.providers.realtime)) {
    return null;
  }
  const { GlobalRealtimeProvider } = await import(
    "@/components/global-realtime-provider"
  );
  return <GlobalRealtimeProvider />;
}

export function isProductionRealtimeConfigured(): boolean {
  const runtime = assertRuntimeSafety();
  return mountsProductionRealtime(runtime.providers.realtime);
}
