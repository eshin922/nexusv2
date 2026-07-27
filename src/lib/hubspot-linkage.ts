// Slice 11 Step 8 Gate-0 hotfix (2026-07-15) — HubSpot linkage
// classifier.
//
// Real HubSpot deal IDs are numeric strings (HubSpot's public
// object-id scheme). Anything else stored in `projects.hubspot_deal_id`
// — Nexus-only placeholders like `PSR-SMOKE-FIXTURE`, empty strings,
// non-numeric identifiers — means the project has no actual HubSpot
// deal record backing it, even though the schema column is NOT NULL.
//
// The distinction matters at send time: sendQuote's DEC-8
// prepared-by resolver depends on HubSpot deal/owner reads, and
// several downstream capabilities (deal-stage push on Mark
// Accepted; NetSuite SO write on Tier Selection) also require a
// real HubSpot backing. Send must block on non-linked deals with
// an actionable message, not fail with "assign a sales rep in
// HubSpot" for a deal that HubSpot doesn't know about.
//
// **Client-safe**: no `server-only` import, no db/HubSpot API
// dependencies. Pure predicate. Safe to call from either RSC or
// client components after the RSC has read `project.hubspot_deal_id`.
//
// **Not a HubSpot-existence check.** This is a shape-based signal:
// numeric string → probably real; non-numeric → definitely not real.
// A numeric string that HubSpot has since deleted would still pass
// this check and hit a downstream lookup miss. That's acceptable —
// the block exists to catch obvious never-linked deals, not to
// verify HubSpot state on every render.

export function isHubspotLinkedDealId(
  hubspotDealId: string | null | undefined,
): boolean {
  if (!hubspotDealId) return false;
  return /^\d+$/.test(hubspotDealId);
}
