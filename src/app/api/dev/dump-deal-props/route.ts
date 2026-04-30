import { NextResponse } from "next/server";
import { dumpDealProperties } from "@/lib/hubspot-cache";

// Dev-only diagnostic endpoint for identifying the HubSpot deal property
// that holds PM. Auth-gated by clerkMiddleware (@thedps.co domain).
// Returns candidate properties matching pm/manager/lead/coordinator/
// director in name or label. Once HUBSPOT_PM_PROPERTY is identified and
// committed, remove this route or gate to admin-only.
export async function GET() {
  const result = await dumpDealProperties();
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
