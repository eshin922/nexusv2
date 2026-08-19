import {
  PRODUCTION_MARKUP_CATEGORY,
  resolveMarkupStrict,
} from "@/lib/costing";
import type { QuoteCostingResult } from "@/lib/costing";
import type { HydrateSnapshot } from "@/lib/costing-store";
import type { DirectServiceIdentity } from "@/lib/product-structure/direct-service";

/**
 * THE commercial projection — one governed boundary, two consumers.
 *
 * The customer PDF and the frozen snapshot are the same commercial statement
 * rendered twice. Building each independently and asserting afterwards that
 * they agree is the shape that produced the F2 divergence in the first place:
 * the PDF folded allocation-OFF fees into its total, the Sales Order amount
 * did not, and both were internally consistent.
 *
 * So this module computes the statement ONCE. `customer-view-resolver` maps it
 * to `CustomerView`; the snapshot writer persists it. Neither derives a
 * commercial figure of its own, which is what makes "PDF equals the frozen
 * matrix" a property of the architecture rather than a test that has to keep
 * passing.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * Not a second costing engine. Unit economics come from `skuRollups`, computed
 * by `computeQuoteCosting` and untouched here. This assembles them into the
 * customer-facing LINE SET, and adds the one thing the rollups do not carry:
 * separately billed OTC.
 */

export type CommercialLineKind =
  | "item_group_member"
  | "direct_product"
  | "direct_service"
  | "otc";

/**
 * A cell is priced or it is not, and the distinction is explicit.
 *
 * A nullable rate alone would repeat the OD-027 ambiguity — "no price" and
 * "we failed to compute one" would be the same value. The discriminant means
 * an unpriced cell is a STATEMENT rather than an absence, which is what the
 * PDF's "quote on request" and the frozen matrix both need.
 */
export type CommercialCell =
  | { state: "priced"; unitRate: number; lineAmount: number }
  | { state: "quote_on_request" };

export type CommercialLine = {
  /** Stable within a projection; used to correlate rows, never persisted as identity. */
  key: string;
  kind: CommercialLineKind;
  /** The Item Group this line belongs to. NULL for top-level lines. */
  owningAssemblyId: string | null;
  quoteLeafId: string | null;
  displayName: string;
  displaySku: string | null;
  /** Customer-facing descriptive copy. Present on OTC lines; null on unit lines. */
  displaySub: string | null;
  /** Customer-facing quantity copy, e.g. "1 (setup)". Null on unit lines. */
  displayQtyLabel: string | null;
  serviceIdentity: DirectServiceIdentity | null;
  /** Aligned to `tiers`, index for index. */
  cells: CommercialCell[];
  /**
   * Per tier, and per tier ONLY.
   *
   * The previous resolver folded allocation across an assembly's tier rows
   * with OR, so one allocated tier suppressed the fee lines for every tier.
   * Allocation is stored per (assembly, tier) and is now read that way.
   */
  allocationByTier: ("allocated" | "separately_billed" | null)[];
};

export type CommercialTierTotal = {
  tierId: string;
  tierLabel: string;
  quantity: number | null;
  /** Σ priced line amounts for every non-OTC line. */
  unitSubtotal: number;
  /** Σ priced line amounts for OTC lines — separately billed, marked up. */
  otcSubtotal: number;
  /** unitSubtotal + otcSubtotal. What was OFFERED at this tier. */
  tierCommercialTotal: number;
  /**
   * The PDF's "from" semantics: at least one line at this tier is unpriced,
   * so the total is a floor rather than a price.
   */
  isProvisional: boolean;
};

export type CommercialProjection = {
  tiers: CommercialTierTotal[];
  lines: CommercialLine[];
  /** The rate OTC was marked up at, or null when no governed default exists. */
  productionMarkupPct: number | null;
};

/** The four fee columns that can be separately billed, with their copy. */
const OTC_FEES = [
  { field: "setupFeeTotal", label: "Setup", sub: "One-time setup — filling-line, dye-cuts, plates.", qtyLabel: "1 (setup)" },
  { field: "toolingArtworkTotal", label: "Tooling & artwork", sub: "One-time tooling + artwork.", qtyLabel: "1 (tooling)" },
  { field: "rdTotal", label: "R&D", sub: "One-time R&D work.", qtyLabel: "1 (R&D)" },
  { field: "otherServiceTotal", label: "Other services", sub: "One-time other services.", qtyLabel: "1 (services)" },
] as const;

export const OTC_FEE_FIELDS = OTC_FEES.map((f) => f.field);

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function projectCommercial(bundle: HydrateSnapshot): CommercialProjection {
  // Read straight off the snapshot. NOT a hand-written structural cast.
  //
  // It was a cast, and the cast named the tier key `id`. The engine emits
  // `tierId`, so every per-tier lookup missed: every cell came back unpriced
  // and every OTC line vanished — while the compiler stayed silent, because a
  // cast is an assertion rather than a check. The unit fixture then encoded
  // the same misreading and agreed with it, so eleven tests passed against a
  // projection that priced nothing. Only running it against a real quote
  // disagreed.
  //
  // `costing` was never optional; the cast invented the optionality along with
  // the wrong field name.
  const costing: QuoteCostingResult = bundle.costing;
  const tiers = costing.tiers;

  // The SAME authority the engine priced production at — read, not restated,
  // so BV-013 moves both halves of the statement together.
  const productionMarkupPct = resolveMarkupStrict({
    defaults: bundle.markupDefaults,
    category: PRODUCTION_MARKUP_CATEGORY,
  }).value;

  const skuById = new Map(bundle.skus.map((s) => [s.id, s] as const));
  const lines: CommercialLine[] = [];

  // ── unit lines ─────────────────────────────────────────────────────────
  for (const rollup of costing.skuRollups) {
    if (rollup.skuRole !== "leaf") continue;

    const sku = skuById.get(rollup.skuId);
    const owningAssemblyId = sku?.parentSkuId ?? null;
    // Threaded through the bundle from the library leaf. Read off the sku
    // row rather than inferred from anything — never from position, never
    // from the presence of production rows, never from a legacy category.
    const serviceIdentity = (sku?.serviceIdentity ?? null) as
      | DirectServiceIdentity
      | null;

    const kind: CommercialLineKind = serviceIdentity
      ? "direct_service"
      : owningAssemblyId
        ? "item_group_member"
        : "direct_product";

    const cells: CommercialCell[] = tiers.map((t) => {
      const pt = rollup.perTier.find((p) => p.tierId === t.tierId);
      const rate = pt?.requiredSellPerUnit ?? null;
      const cost = pt?.contributionCostPerUnit ?? 0;
      // The Slice 11 rule, preserved verbatim: zero revenue AND zero cost is
      // UNPRICED, not "computed to $0.00". Anything else would synthesize a
      // price for a line nobody costed.
      if (rate === null || (rate === 0 && cost === 0)) {
        return { state: "quote_on_request" };
      }
      const qty = (t.qty ?? 0) * Number(rollup.qtyPerParent ?? 1);
      return { state: "priced", unitRate: rate, lineAmount: rate * qty };
    });

    lines.push({
      key: `unit:${rollup.skuId}`,
      kind,
      owningAssemblyId,
      quoteLeafId: rollup.canonicalQuoteLeafId ?? null,
      displayName: rollup.productName,
      displaySku: rollup.skuLabel || null,
      displaySub: null,
      displayQtyLabel: null,
      serviceIdentity,
      cells,
      allocationByTier: tiers.map(() => null),
    });
  }

  // ── separately billed OTC ──────────────────────────────────────────────
  //
  // Per (assembly, fee column). Each tier reads ITS OWN row: the fee amount
  // and the allocation flag both come from the production row for that tier,
  // never from a fold across tiers.
  //
  // The previous resolver took MAX across tiers for the amount and OR across
  // tiers for allocation. Both were invisible while fees were tier-invariant
  // and both become wrong the moment a frozen line reconciles to an accepted
  // total, because the figure would be attributed to a tier that did not
  // produce it.
  const prodByAssemblyTier = new Map<string, Map<string, (typeof bundle.production)[number]>>();
  for (const p of bundle.production) {
    const leaf = skuById.get(p.quoteSkuId);
    const assemblyId = leaf?.parentSkuId ?? null;
    if (!assemblyId) continue; // a Direct Service's production is its own unit line
    const byTier = prodByAssemblyTier.get(assemblyId) ?? new Map();
    byTier.set(p.tierId, p);
    prodByAssemblyTier.set(assemblyId, byTier);
  }

  for (const [assemblyId, byTier] of prodByAssemblyTier) {
    const assembly = skuById.get(assemblyId);
    if (!assembly) continue;

    for (const fee of OTC_FEES) {
      const cells: CommercialCell[] = [];
      const allocationByTier: CommercialLine["allocationByTier"] = [];
      let anyBilled = false;

      for (const t of tiers) {
        const row = byTier.get(t.tierId);
        const allocated = row?.allocateServiceFeesToCost ?? true;
        allocationByTier.push(row ? (allocated ? "allocated" : "separately_billed") : null);

        const raw = row ? num((row as Record<string, unknown>)[fee.field]) : null;
        if (allocated || raw === null || raw <= 0) {
          // Allocated fees are already inside the unit lines. Emitting them
          // here as well would bill the same economics twice.
          cells.push({ state: "quote_on_request" });
          continue;
        }
        if (productionMarkupPct === null) {
          // Fail-visible, per BV-013: no governed rate means no price, not a
          // price computed at cost.
          cells.push({ state: "quote_on_request" });
          continue;
        }
        anyBilled = true;
        const amount = raw * (1 + productionMarkupPct);
        // A one-time charge: the amount IS the line, quantity 1.
        cells.push({ state: "priced", unitRate: amount, lineAmount: amount });
      }

      if (!anyBilled) continue;

      lines.push({
        key: `otc:${assemblyId}:${fee.field}`,
        kind: "otc",
        owningAssemblyId: assemblyId,
        quoteLeafId: null,
        displayName: fee.label,
        displaySku: assembly.skuLabel || null,
        displaySub: fee.sub,
        displayQtyLabel: fee.qtyLabel,
        serviceIdentity: null,
        cells,
        allocationByTier,
      });
    }
  }

  // ── per-tier totals ────────────────────────────────────────────────────
  const tierTotals: CommercialTierTotal[] = tiers.map((t, i) => {
    let unitSubtotal = 0;
    let otcSubtotal = 0;
    let provisional = false;
    for (const line of lines) {
      const cell = line.cells[i];
      if (cell.state === "quote_on_request") {
        // An OTC line unpriced because it is ALLOCATED is not a gap — the
        // economics are inside the unit lines. Only a genuinely unpriced UNIT
        // line makes the total a floor.
        if (line.kind !== "otc") provisional = true;
        continue;
      }
      if (line.kind === "otc") otcSubtotal += cell.lineAmount;
      else unitSubtotal += cell.lineAmount;
    }
    return {
      tierId: t.tierId,
      tierLabel: t.label,
      quantity: t.qty,
      unitSubtotal,
      otcSubtotal,
      tierCommercialTotal: unitSubtotal + otcSubtotal,
      isProvisional: provisional,
    };
  });

  return { tiers: tierTotals, lines, productionMarkupPct };
}

/**
 * The identity the frozen matrix must satisfy, checkable rather than assumed.
 *
 * Returns the tiers that fail. Empty means the projection is internally
 * consistent — every tier's stated total equals the sum of its own parts.
 */
export function verifyProjectionTotals(
  projection: CommercialProjection,
): Array<{ tierId: string; stated: number; summed: number }> {
  const bad: Array<{ tierId: string; stated: number; summed: number }> = [];
  projection.tiers.forEach((t, i) => {
    let summed = 0;
    for (const line of projection.lines) {
      const cell = line.cells[i];
      if (cell.state === "priced") summed += cell.lineAmount;
    }
    // Cent tolerance: the parts are IEEE 754 sums of per-unit rates times
    // quantities, so exact bit equality would fail on representation alone.
    if (Math.abs(summed - t.tierCommercialTotal) > 0.005) {
      bad.push({ tierId: t.tierId, stated: t.tierCommercialTotal, summed });
    }
  });
  return bad;
}
