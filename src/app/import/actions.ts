"use server";

import { revalidatePath } from "next/cache";
import { getCacheStatus, syncDeals } from "@/lib/hubspot-cache";

// Manual "Refresh from HubSpot" trigger. Forces a full active-pipeline
// sync regardless of staleness, then revalidates /import. Returns the
// fresh last_synced_at so the client can update its badge optimistically
// without waiting for the next render.
export async function refreshDealsCache(): Promise<{
  lastSyncedAt: string | null;
  syncedCount: number;
}> {
  const result = await syncDeals();
  revalidatePath("/import");
  const status = await getCacheStatus();
  return {
    lastSyncedAt: status.lastSyncedAt?.toISOString() ?? null,
    syncedCount: result.synced,
  };
}
