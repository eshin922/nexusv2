import { commercialLineKind } from "@/db/schema";

/**
 * How a frozen line finds its NetSuite item — and therefore which readiness
 * questions apply to it.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * Two kinds of line reach the Sales Order projection and they resolve by
 * different means:
 *
 *   BY SKU          a product. Its identity is its SKU, not an accounting
 *                   category: `frozen-sales-order` resolves members and direct
 *                   products through `item-resolver`, and BV-011 says so in
 *                   the field's own words — "product lines have no destination
 *                   — they resolve by SKU" — so `bv011_destination` is
 *                   correctly NULL on all of them, forever.
 *
 *                   The Item Group HEADER is the same class of thing and is
 *                   likewise never destination-resolved. It is additionally
 *                   not emitted as a line of its own today: `mark-complete`
 *                   posts members flat, with SO grouping deliberately deferred
 *                   ("intentionally not built", pending the Assembly
 *                   migration). Either way the destination question does not
 *                   apply to it — which is the whole point of this map.
 *
 *   BY DESTINATION  a charge or a service. It has no SKU of its own, so an
 *                   accounting destination is what decides where it posts, and
 *                   a NULL there is a real gap.
 *
 * The readiness check used to spell the product set out as a literal —
 * `item_group_member || direct_product` — written when those were the only two.
 * OD-028 then added `item_group`, and the literal did not grow with it. So the
 * Item Group header, whose NULL destination is CORRECT, was reported as
 * "frozen before accounting destinations were recorded" with the remediation
 * "revise and re-send so the line records its destination".
 *
 * That instruction cannot be followed. A re-send freezes NULL again, because
 * NULL is the right value — the operator is sent round a loop with no exit.
 * DPS-1072 hit it on a fully repaired, freshly re-sent v2 snapshot.
 *
 * ── WHY A TOTAL MAP AND NOT A LONGER LITERAL ────────────────────────────
 *
 * A third product kind would repeat the defect exactly. `satisfies` makes the
 * map total over the enum, so a new line kind is a COMPILE ERROR here until
 * somebody says which way it resolves — the decision is forced at the point of
 * definition rather than discovered at a customer's Sales Order.
 *
 * Keyed off the DATABASE enum rather than the projection's TypeScript union on
 * purpose: readiness reads `quote_snapshot_lines.line_kind`, so this is the
 * vocabulary it actually sees. It is also the only one available — the NetSuite
 * tree may not import `commercial-projection`, and `netsuite-presentation-
 * isolation` enforces that.
 */
export type CommercialLineKindValue = (typeof commercialLineKind.enumValues)[number];

export type LineResolution = "by_sku" | "by_destination";

export const LINE_KIND_RESOLUTION = {
  // A product line. The Item Group header posts as the NetSuite Group of the
  // same code; its members post as their own items. Neither carries, or should
  // carry, an accounting destination.
  // ── CORRECTED 2026-08-31, AND NOT A REVERSAL ──────────────────────────
  //
  // This read `by_sku` for one commit, because at that moment it was true in
  // the only sense available: the header's `bv011_destination` is NULL and
  // there was no destination it could have meant. The governing facts then
  // changed — `item_group_production` became an approved destination with a
  // governed item — and the honest classification changed with them.
  //
  // The Item Group's COMMERCIAL line does not resolve by SKU: `TRN-SERUM-30`
  // is never posted as a priced line. It resolves by destination, to IGP-0001,
  // through `LINE_KIND_DESTINATION`.
  //
  // The Item Group's STRUCTURAL identity still resolves by its SKU — but not
  // here and not as a line: it goes through the composition hash to a NetSuite
  // Group that opens a span. This map governs PRICED LINES only.
  item_group: "by_destination",
  item_group_member: "by_sku",
  direct_product: "by_sku",
  // Not products. A service's destination comes from its governed identity, a
  // one-time charge's from BV-011 — and a NULL on either is a genuine blocker.
  direct_service: "by_destination",
  otc: "by_destination",
} as const satisfies Record<CommercialLineKindValue, LineResolution>;

/**
 * Is this line's NetSuite item decided by its SKU?
 *
 * The single predicate the destination checks exempt on. Callers must not
 * re-spell the set — a second list is how the first one fell behind.
 */
export function resolvesBySku(kind: CommercialLineKindValue): boolean {
  return LINE_KIND_RESOLUTION[kind] === "by_sku";
}
