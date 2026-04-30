import { NextResponse } from "next/server";
import { getCacheStatus } from "@/lib/hubspot-cache";

// Lightweight read endpoint used by the import-deals page's RefreshHeader
// to poll for fresh last_synced_at after a background sync.
export async function GET() {
  const status = await getCacheStatus();
  return NextResponse.json({
    count: status.count,
    lastSyncedAt: status.lastSyncedAt?.toISOString() ?? null,
  });
}
