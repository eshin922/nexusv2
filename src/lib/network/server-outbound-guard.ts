import { isLoopbackNetworkUrl, type RuntimeSafety } from "@/lib/config/runtime-config";

type GuardGlobal = typeof globalThis & {
  __nexusOriginalFetch?: typeof fetch;
  __nexusOutboundGuardInstalled?: boolean;
  __nexusBlockedRequests?: Array<{ url: string; at: string }>;
};

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.toString();
  if (typeof input === "string") return input;
  return input.url;
}

/**
 * Installs the application-level isolated-network guard.
 *
 * Browser interception and container policy are separate layers. This layer
 * protects server-side fetch users (HubSpot SDK, NetSuite fetch adapters,
 * Supabase clients) if a concrete external provider is accidentally reached.
 */
export function installServerOutboundGuard(safety: RuntimeSafety): void {
  if (safety.mode !== "isolated") return;

  const guardedGlobal = globalThis as GuardGlobal;
  if (guardedGlobal.__nexusOutboundGuardInstalled) return;

  const original = guardedGlobal.__nexusOriginalFetch ?? globalThis.fetch;
  if (typeof original !== "function") {
    throw new Error("[network-guard] global fetch is unavailable");
  }
  guardedGlobal.__nexusOriginalFetch = original;
  guardedGlobal.__nexusBlockedRequests = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!isLoopbackNetworkUrl(url, safety.allowedNetworkHosts)) {
      guardedGlobal.__nexusBlockedRequests!.push({
        url,
        at: new Date().toISOString(),
      });
      throw new Error(`[network-guard] blocked non-loopback request: ${url}`);
    }
    return original(input, init);
  }) as typeof fetch;

  guardedGlobal.__nexusOutboundGuardInstalled = true;
}

export function blockedServerRequests(): ReadonlyArray<{
  url: string;
  at: string;
}> {
  return [
    ...(((globalThis as GuardGlobal).__nexusBlockedRequests ?? []) as Array<{
      url: string;
      at: string;
    }>),
  ];
}
