import "server-only";
import { suiteQL, type NetsuiteConfig } from "./client";

// Slice 12 Step 9 CD parity fix (2026-07-29) — NetSuite label→id
// resolver for the `custbody_dps_project_source` SO custom field.
//
// Why this exists (parallel to business-segment-resolver but reversed):
//   - HubSpot's `project_source` deal property returns the LABEL
//     ("Domestic" / "International" / "Multiple") on read. Nexus's
//     `hubspot_deals_cache.sourcing_location` column stores that
//     label verbatim per hubspot-cache.ts:162.
//   - NetSuite's `custbody_dps_project_source` SO field is backed by
//     the `customlist_dps_project_source` custom list (id 1/2/3 →
//     Domestic/International/Multiple). REST rejects text payloads
//     with USER_ERROR: "Invalid Field Value <label> for the following
//     field: custbody_dps_project_source" — verified via Class B
//     parity probe (2026-07-29).
//   - business_segment uses ids on both sides (HubSpot returns the
//     enum id, NS accepts it as class/cseg). project_source diverges
//     because of HubSpot's property config; someone at DPS configured
//     business_segment as id-return + project_source as label-return.
//
// Contract per CA (2026-07-29): if the fetch fails OR the label has
// no matching NS list id, BLOCK the push. Same discipline as
// business-segment-resolver — don't send unresolvable values and
// hope NetSuite matches them.
//
// The NS custom list is small (3 entries at DPS as of 2026-07-29),
// stable (admin-changed occasionally at most), and fetched via
// SuiteQL once per process lifetime. Sync-triggered invalidation
// unnecessary at this scale.

interface CustomListRow {
  id: string;
  name: string;
}

let cachedIdByLabel: Map<string, string> | null = null;

async function fetchLabelToIdMap(
  opts?: { config?: NetsuiteConfig },
): Promise<Map<string, string>> {
  if (cachedIdByLabel) return cachedIdByLabel;
  const rows = await suiteQL<CustomListRow>(
    "SELECT id, name FROM customlist_dps_project_source",
    { config: opts?.config },
  );
  const map = new Map<string, string>();
  for (const r of rows.items) {
    map.set(r.name.trim().toLowerCase(), r.id);
  }
  cachedIdByLabel = map;
  return map;
}

/** Reset cache — testing hook. */
export function _resetProjectSourceCache(): void {
  cachedIdByLabel = null;
}

/**
 * Resolve a project_source label ("Domestic") to its NS list id.
 * Throws if the fetch fails OR the label has no matching entry —
 * per CA, block push rather than sending a raw label NetSuite
 * cannot resolve (Class B parity finding, 2026-07-29).
 */
export async function resolveProjectSourceIdByLabel(
  label: string,
  opts?: { config?: NetsuiteConfig },
): Promise<string> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error("[project-source-resolver] label is required");
  }
  const map = await fetchLabelToIdMap(opts);
  const id = map.get(trimmed.toLowerCase());
  if (!id) {
    const known = [...map.keys()].join(", ") || "(list is empty — check NS custom list `customlist_dps_project_source` exists + is populated)";
    throw new Error(
      `[project-source-resolver] project_source label '${trimmed}' has no matching NetSuite list id. Known labels: ${known}.`,
    );
  }
  return id;
}
