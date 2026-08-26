import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * What removing an attachment would destroy — counted, and said out loud.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────
 *
 * Deleting a `quote_leaves` row cascades every dependent economic row with it:
 * packaging lines, per-cell overrides and client targets, freight membership,
 * staged lifts, service items. The confirmation said none of that. On a group
 * member it said something worse —
 *
 *     Remove from item group          library leaf stays
 *
 * — which is true about the LIBRARY and silent about the QUOTE. The one
 * caption in the interaction was the one that made a destructive act read as
 * safe. Measured 2026-08-26: 113 draft attachments across 19 quotes carried
 * cost a Remove would have cascaded away without a word.
 *
 * This is not a guard. The removal is legitimate and stays available; the
 * operator is simply told what it costs before they confirm it.
 *
 * ── WHY IT IS NOT `dependentEconomicRows` ───────────────────────────────
 *
 * `structural-move.ts` enumerates the four DUAL-KEYED tables a MOVE must
 * repoint. That is a deliberately narrower set than what a DELETE destroys,
 * and reusing it here would undercount by five tables — including
 * `quote_leaf_lifts` and `quote_other_service_items`. An undercount would be
 * the same defect in a quieter form: a number that reassures.
 *
 * The two lists answer different questions and are kept apart on purpose.
 *
 * ── STAYING TRUE ────────────────────────────────────────────────────────
 *
 * `tests/unit/attachment-dependents-coverage.test.ts` reads `schema.ts` and
 * fails if any table gains an `ON DELETE CASCADE` reference to
 * `quote_leaves.id` without appearing here. A count that silently stops being
 * complete is worse than no count, because it is believed.
 */

import {
  type AttachmentDependents,
  type DependentCount,
} from "./attachment-dependents-rules";

export {
  CASCADING_DEPENDENT_TABLES,
  NOT_COUNTED,
  describeDependents,
  type AttachmentDependents,
  type DependentCount,
} from "./attachment-dependents-rules";

export async function loadAttachmentDependents(
  quoteLeafId: string,
): Promise<AttachmentDependents> {
  // ONE round trip, scalar subqueries, no driving FROM. A FROM over any one
  // dependent table would yield zero rows for an attachment that has none of
  // THAT kind — and then report "no dependents" for an attachment carrying
  // plenty of the others. That is the undercount this module exists to
  // prevent, reintroduced by the query shape.
  const rows = await db.execute(sql`
    SELECT
      (SELECT count(DISTINCT line_group_id) FROM assembly_leaf_inputs
        WHERE quote_leaf_id = ${quoteLeafId})                          AS packaging_lines,
      (SELECT count(*) FROM assembly_production_inputs
        WHERE quote_leaf_id = ${quoteLeafId})                          AS production_rows,
      (SELECT count(*) FROM assembly_leaf_overrides
        WHERE quote_leaf_id = ${quoteLeafId})                          AS overrides,
      (SELECT count(*) FROM assembly_leaf_targets
        WHERE quote_leaf_id = ${quoteLeafId})                          AS leaf_targets,
      (SELECT count(*) FROM quote_client_targets
        WHERE quote_leaf_id = ${quoteLeafId})                          AS client_targets,
      (SELECT count(*) FROM quote_leaf_lifts
        WHERE quote_leaf_id = ${quoteLeafId})                          AS lifts,
      (SELECT count(*) FROM freight_subcategory_items
        WHERE quote_leaf_id = ${quoteLeafId})                          AS freight_memberships,
      (SELECT count(*) FROM freight_leg_component_tier_costs
        WHERE quote_leaf_id = ${quoteLeafId})                          AS freight_component_costs,
      (SELECT count(*) FROM quote_other_service_items
        WHERE quote_leaf_id = ${quoteLeafId})                          AS service_items
  `);

  const r = ((rows as unknown as Record<string, unknown>[])[0] ?? {});
  const n = (v: unknown) => Number(v ?? 0);

  const candidates: DependentCount[] = [
    { singular: "packaging line", plural: "packaging lines", count: n(r.packaging_lines) },
    { singular: "production input", plural: "production inputs", count: n(r.production_rows) },
    { singular: "price override", plural: "price overrides", count: n(r.overrides) },
    {
      singular: "client target",
      plural: "client targets",
      count: n(r.leaf_targets) + n(r.client_targets),
    },
    { singular: "staged lift", plural: "staged lifts", count: n(r.lifts) },
    {
      singular: "freight membership",
      plural: "freight memberships",
      count: n(r.freight_memberships) + n(r.freight_component_costs),
    },
    { singular: "service item", plural: "service items", count: n(r.service_items) },
  ];

  const entries = candidates.filter((c) => c.count > 0);
  return { entries, total: entries.reduce((a, c) => a + c.count, 0) };
}

