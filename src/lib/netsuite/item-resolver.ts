import "server-only";
import { suiteQL, type NetsuiteConfig } from "./client";
import type { ResolveResult } from "./item-resolver-types";

export type { ResolveResult } from "./item-resolver-types";

// Slice 12 Step 8c-1 — Leaf → NetSuite item resolver (SKU-match).
//
// Per CA Q1 disposition (2026-07-28): SKU-match is the MVP approach.
// NetSuite items have NO custitem_dps_hubspot_product_id linkage field
// (D1 finding — verified via customfield grep, 0 matches on
// %hubspot%). SKU-match is what Aisha does today; we're surfacing an
// existing dependency, not introducing fragility.
//
// Contract:
//   - resolveNetsuiteItem(sku) → { status: "found", ... } | { status: "not_found" } |
//                                 { status: "ambiguous", ... }
//   - Zero matches AND multiple matches both BLOCK the push. No
//     auto-create (Melinda §8 confirmed — GL accounts, costing, UoM,
//     tax config all require human setup).
//   - Resolution must happen BEFORE any NetSuite write. Never create
//     an Item Group with an unresolvable member.
//
// Extensibility (option D roadmap, per CA):
//   The resolver's signature accepts an optional cache map lookup
//   pre-check. Post-MVP, a persisted `netsuite_item_map (leaf_id →
//   netsuite_item_id, last_verified_at)` table lands upstream of this
//   file; cache-hit is a cheap DB read, cache-miss falls through to
//   SuiteQL. Design here anticipates that layer without requiring
//   rework — the caller does the DB lookup + passes the resolved id;
//   this resolver validates the id still exists (verify) OR resolves
//   fresh from SKU (cache miss).

interface NsItemRow {
  id: string;
  itemid: string;
  itemtype: string;
}

/**
 * Resolve a single leaf SKU to a NetSuite item. Returns a discriminated
 * result — callers translate to a blocking-tab error for the "not_found"
 * and "ambiguous" cases.
 */
export async function resolveNetsuiteItem(
  sku: string,
  opts?: { config?: NetsuiteConfig },
): Promise<ResolveResult> {
  const trimmed = sku.trim();
  if (!trimmed) {
    throw new Error("[item-resolver] sku is required (empty after trim)");
  }

  // SuiteQL: match on itemid exactly. NetSuite normally treats itemid
  // as case-insensitive but we don't want to depend on collation
  // behavior — LOWER on both sides keeps it explicit.
  //
  // Filter out Item Groups (itemtype='Group'). Groups share the itemid
  // namespace with real items — CA-caught 2026-07-28 via the smoke run:
  // TCS-BAR-01 came back "ambiguous" because there's both an InvtPart
  // (id=41350) and a Group (id=57232) with itemid TCS-BAR-01. Groups
  // aren't valid Item Group MEMBERS (NetSuite doesn't support nested
  // groups semantically), so exclude them from the resolver's answer
  // set. Once 8c-3 starts creating groups routinely, this collision
  // would be the common case for any base SKU we've grouped.
  const escaped = trimmed.replace(/'/g, "''");
  const q = `SELECT id, itemid, itemtype FROM item WHERE LOWER(itemid) = LOWER('${escaped}') AND isinactive='F' AND itemtype != 'Group'`;
  const result = await suiteQL<NsItemRow>(q, { config: opts?.config });

  if (result.items.length === 0) {
    return { status: "not_found", sku: trimmed };
  }
  if (result.items.length === 1) {
    const item = result.items[0];
    return {
      status: "found",
      sku: trimmed,
      netsuiteItemId: item.id,
      itemid: item.itemid,
      itemtype: item.itemtype,
    };
  }
  return {
    status: "ambiguous",
    sku: trimmed,
    matches: result.items.map((r) => ({
      netsuiteItemId: r.id,
      itemid: r.itemid,
      itemtype: r.itemtype,
    })),
  };
}

/**
 * Resolve a batch of SKUs. Runs each lookup sequentially (SuiteQL
 * throttles concurrent requests hard, and typical assembly has <10
 * members — serial is fine). Returns per-SKU results in the same
 * order as input.
 *
 * Reports hit rate for CA's tracking ask — first sandbox smoke logs
 * this; if real coverage is low, unmatched becomes the common path
 * and 8c-4's UX prominence changes.
 */
export async function resolveNetsuiteItems(
  skus: string[],
  opts?: { config?: NetsuiteConfig },
): Promise<{
  results: ResolveResult[];
  stats: {
    total: number;
    found: number;
    notFound: number;
    ambiguous: number;
    hitRate: number;
  };
}> {
  const results: ResolveResult[] = [];
  for (const sku of skus) {
    results.push(await resolveNetsuiteItem(sku, opts));
  }
  const found = results.filter((r) => r.status === "found").length;
  const notFound = results.filter((r) => r.status === "not_found").length;
  const ambiguous = results.filter((r) => r.status === "ambiguous").length;
  return {
    results,
    stats: {
      total: results.length,
      found,
      notFound,
      ambiguous,
      hitRate: results.length === 0 ? 0 : found / results.length,
    },
  };
}

// formatResolutionErrors lives in `./item-resolver-format.ts` (pure —
// no client / DB imports) so it can be unit-tested via node
// --experimental-strip-types without the whole client + drizzle graph.
// Re-exported here for callers that already import from item-resolver.
export { formatResolutionErrors } from "./item-resolver-format";
