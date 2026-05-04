// Slice 9.5 — validation engine. Pure functions; runs client-side
// (optimistic store, immediate inline display) AND server-side (action
// layer, persistence to `quote_warnings`). Engine never writes; the
// action layer wraps engine output and reconciles against existing
// rows.
//
// Why pure functions: same reason `costing.ts` is pure — client + server
// run the same code. Optimistic store fires validation on every input
// change for inline icon surfacing (free, in-memory). Action layer
// re-runs on server commit to persist authoritative warning state.
//
// Persistence asymmetry from costing (per brief §3 + architect verdict):
// costing computation is keystroke-debounced and persists per-debounce.
// Validation runs many times client-side but persists only on action
// commit (insert/update/delete completion), not per keystroke. Warnings
// are persistent state with audit trail; keystroke-aligned persistence
// would create write storms and orphan audit rows.
//
// Engine shape:
//   validateQuote(input, costing) → WarningSpec[]
// The action layer takes that array, compares against currently-active
// `quote_warnings` rows (matched by identity tuple `(quote_id,
// table_name, row_id, field_name, tier_id, kind)`), and reconciles:
//   - new specs → INSERT active
//   - missing-from-engine + active rows → UPDATE auto_resolved
//   - still-firing + active rows → UPDATE last_evaluated_at
//   - accepted rows → never auto-resolve (per architect option iii;
//     manual re-activate or row delete clears acceptance)
//
// Identity tuple addressing (architect option 2b-A):
//   row_id is TEXT (mirrors audit_log.entity_id). For genuine row-level
//   warnings, store the row's UUID-as-text. For cross-row pattern
//   warnings (e.g., service-fee variance across that SKU's tier rows),
//   synthesize a composite text key like
//   `"sku:<sku_id>:col:setup_fee_total"`. Single column carries both
//   shapes; engine and UI both use the identity tuple unambiguously.

import type {
  CostingFreightInput,
  CostingPackagingInput,
  CostingProductionInput,
  QuoteCostingInput,
  QuoteCostingResult,
  SkuRollup,
} from "./costing";

// ---------- types ----------

export type WarningSeverity = "info" | "review" | "action_required";

export type WarningScope = "line" | "quote";

// Warning kinds enumerated. Open enum: new rules can add kinds
// without breaking existing code; UI consumers handle unknown kinds
// gracefully (default treatment).
export type WarningKind =
  // Completeness — quote-level
  | "no_skus_with_cost_data"
  | "no_production_yet"
  | "no_tiers_defined"
  // Completeness — line-level
  | "tier_coverage_mismatch"
  | "production_without_packaging"
  | "pass_through_freight_missing_customs"
  | "retail_benchmark_no_cost"
  // Anomalies — per-field
  | "service_fee_tier_variance"
  | "cbm_cross_tier_variance"
  | "markup_above_5x_default"
  | "negative_cost"
  | "zero_cost_populated_row"
  // Outliers — statistical
  | "category_outlier_5x";

export type WarningSpec = {
  scope: WarningScope;
  // null when scope === 'quote' (quote-level warnings have no row target)
  table_name: string | null;
  // UUID-as-text for genuine row warnings; synthesized composite text
  // key for cross-row pattern warnings (e.g., "sku:<id>:col:<column>").
  // Both shapes use the same column. Identity tuple is unambiguous.
  row_id: string | null;
  field_name: string | null;
  // null when warning is tier-agnostic (e.g., quote-level) or
  // cross-tier (e.g., service-fee variance — variance IS the issue, no
  // single tier owns the warning).
  tier_id: string | null;
  kind: WarningKind;
  severity: WarningSeverity;
  message: string;
  detail_json: Record<string, unknown>;
};

// ---------- entry ----------

export function validateQuote(
  input: QuoteCostingInput,
  costing: QuoteCostingResult,
): WarningSpec[] {
  return [
    ...checkQuoteLevelCompleteness(input),
    ...checkLineLevelCompleteness(input),
    ...checkAnomalies(input),
    ...checkOutliers(input, costing),
  ];
}

// ---------- helpers ----------

const SERVICE_FEE_COLUMNS = [
  "setupFeeTotal",
  "toolingArtworkTotal",
  "rdTotal",
  "otherServiceTotal",
  "cmAssemblyTotal",
] as const;
type ServiceFeeColumn = (typeof SERVICE_FEE_COLUMNS)[number];

// Column-name → human label for warning copy. Keys match
// CostingProductionInput column names exactly (camelCase, matching
// Drizzle schema's JS-side property names).
const SERVICE_FEE_LABELS: Record<ServiceFeeColumn, string> = {
  setupFeeTotal: "Setup fee",
  toolingArtworkTotal: "Tooling/artwork",
  rdTotal: "R&D charge",
  otherServiceTotal: "Other service fee",
  cmAssemblyTotal: "CM assembly fee",
};

// Synthesize composite text key for cross-row warnings (architect
// option 2b-A). Pattern: `<entity>:<id>[:<key>:<value>...]`. Engine
// and UI both parse via this convention.
function skuColKey(skuId: string, column: string): string {
  return `sku:${skuId}:col:${column}`;
}

function freightLineSkuKey(lineGroupId: string, skuId: string): string {
  return `freight:${lineGroupId}:sku:${skuId}`;
}

// Find a tier label by id; falls back to id if missing (defensive —
// shouldn't happen since input.tiers contains all referenced tiers).
function tierLabel(input: QuoteCostingInput, tierId: string): string {
  return input.tiers.find((t) => t.id === tierId)?.label ?? tierId;
}

function leafSkus(input: QuoteCostingInput) {
  return input.skus.filter((s) => s.skuRole === "leaf");
}

// ---------- completeness: quote-level ----------

function checkQuoteLevelCompleteness(
  input: QuoteCostingInput,
): WarningSpec[] {
  const warnings: WarningSpec[] = [];

  // Rule: no tiers defined. Action_required because Mark-Accepted
  // can't gate on something that doesn't exist; downstream surfaces
  // would render in undefined states.
  if (input.tiers.length === 0) {
    warnings.push({
      scope: "quote",
      table_name: null,
      row_id: null,
      field_name: null,
      tier_id: null,
      kind: "no_tiers_defined",
      severity: "action_required",
      message: "Quote has no tiers · add tiers in Setup.",
      detail_json: {},
    });
    // Don't fire downstream rules — most assume tiers exist.
    return warnings;
  }

  // Rule: no SKUs with any cost data. Info-level — typical
  // just-created state; PM is on their way to fill in data. The
  // ambient warning sets expectation rather than blocking.
  const hasAnyCost =
    input.packaging.length > 0 ||
    input.production.some((p) =>
      [
        p.fillingBlendingCost,
        p.cmAssemblyTotal,
        p.setupFeeTotal,
        p.toolingArtworkTotal,
        p.rdTotal,
        p.otherServiceTotal,
        p.bulkRawCost,
      ].some((v) => v !== null),
    ) ||
    input.freight.length > 0;
  if (!hasAnyCost && leafSkus(input).length > 0) {
    warnings.push({
      scope: "quote",
      table_name: null,
      row_id: null,
      field_name: null,
      tier_id: null,
      kind: "no_skus_with_cost_data",
      severity: "info",
      message: "No cost data yet · open Cost build to begin.",
      detail_json: {},
    });
  }

  // Rule: all SKUs have packaging but no production. Suggests
  // workflow stuck at first input. Info-level. Only fires when
  // packaging IS populated (otherwise no_skus_with_cost_data fires).
  const hasPackaging = input.packaging.length > 0;
  const hasProduction = input.production.some((p) =>
    [
      p.fillingBlendingCost,
      p.cmAssemblyTotal,
      p.setupFeeTotal,
      p.toolingArtworkTotal,
      p.rdTotal,
      p.otherServiceTotal,
    ].some((v) => v !== null),
  );
  if (hasPackaging && !hasProduction) {
    warnings.push({
      scope: "quote",
      table_name: null,
      row_id: null,
      field_name: null,
      tier_id: null,
      kind: "no_production_yet",
      severity: "info",
      message: "Production cost not yet entered for any SKU.",
      detail_json: {},
    });
  }

  return warnings;
}

// ---------- completeness: line-level ----------

function checkLineLevelCompleteness(
  input: QuoteCostingInput,
): WarningSpec[] {
  const warnings: WarningSpec[] = [];

  for (const sku of leafSkus(input)) {
    // Rule: tier coverage mismatch on packaging. If packaging exists
    // for some tiers but not all on this SKU, flag each missing tier.
    // Severity: review. Suggested fix: copy from an existing tier.
    const skuPkg = input.packaging.filter((p) => p.quoteSkuId === sku.id);
    const presentPkgTiers = new Set(skuPkg.map((p) => p.tierId));
    if (skuPkg.length > 0 && presentPkgTiers.size < input.tiers.length) {
      const sourceTier = input.tiers.find((t) => presentPkgTiers.has(t.id))!;
      for (const t of input.tiers.filter((tt) => !presentPkgTiers.has(tt.id))) {
        warnings.push({
          scope: "line",
          table_name: "packaging_inputs",
          // SKU-level synthesized key — packaging lines for the
          // missing tier don't exist as rows yet, so we anchor on
          // the SKU + missing-tier coordinate.
          row_id: skuColKey(sku.id, "packaging_tier_coverage"),
          field_name: null,
          tier_id: t.id,
          kind: "tier_coverage_mismatch",
          severity: "review",
          message: `Packaging cost is set for ${sourceTier.label} but not ${t.label} on ${sku.skuLabel}.`,
          detail_json: {
            sku_id: sku.id,
            present_tier_ids: [...presentPkgTiers],
            missing_tier_id: t.id,
            suggested_fix: {
              kind: "copy_from_tier",
              from_tier_id: sourceTier.id,
              to_tier_id: t.id,
            },
          },
        });
      }
    }

    // Rule: production without packaging. Severity: review. The
    // PDF would render an incomplete cost stack; PM probably hasn't
    // finished the SKU yet.
    const skuProd = input.production.filter((p) => p.quoteSkuId === sku.id);
    const skuHasProduction = skuProd.some((p) =>
      [
        p.fillingBlendingCost,
        p.cmAssemblyTotal,
        p.setupFeeTotal,
        p.toolingArtworkTotal,
        p.rdTotal,
        p.otherServiceTotal,
      ].some((v) => v !== null),
    );
    if (skuHasProduction && skuPkg.length === 0) {
      warnings.push({
        scope: "line",
        table_name: "packaging_inputs",
        row_id: skuColKey(sku.id, "packaging_missing"),
        field_name: null,
        tier_id: null,
        kind: "production_without_packaging",
        severity: "review",
        message: `${sku.skuLabel}: production cost set without packaging · partial cost may render as $0.`,
        detail_json: { sku_id: sku.id },
      });
    }

    // Rule: SKU has retail benchmark but no contribution cost.
    // Probably an in-progress quote (PM imported retail target before
    // cost data). Info-level — ambient nudge.
    if (sku.retailBenchmark && skuPkg.length === 0 && !skuHasProduction) {
      warnings.push({
        scope: "line",
        table_name: "quote_skus",
        row_id: sku.id, // genuine row UUID-as-text
        field_name: "retail_benchmark",
        tier_id: null,
        kind: "retail_benchmark_no_cost",
        severity: "info",
        message: `Retail benchmark is set on ${sku.skuLabel} but cost is empty.`,
        detail_json: { sku_id: sku.id },
      });
    }
  }

  // Rule: pass-through freight missing customs (action_required).
  // Per CR-7 architect verdict + brief §4.1 + Slice 6.5 customs
  // schema (duty_pct + tariff_pct on quote_skus; sku_total_cbm on
  // freight_inputs). Each pass-through freight row needs all three
  // populated — otherwise landed-cost math produces zero or wrong
  // values in the customer PDF.
  for (const f of input.freight.filter(
    (f) => f.freightTreatment === "pass_through",
  )) {
    const sku = input.skus.find((s) => s.id === f.quoteSkuId);
    if (!sku) continue;
    const missing: string[] = [];
    if (sku.dutyPct === null) missing.push("duty_pct");
    if (sku.tariffPct === null) missing.push("tariff_pct");
    if (f.skuTotalCbm === null) missing.push("sku_total_cbm");
    if (missing.length === 0) continue;
    warnings.push({
      scope: "line",
      table_name: "freight_inputs",
      // Composite key: line_group + sku, NOT a specific row id —
      // missing customs is a (line, SKU) issue, not a tier-specific
      // row issue. UI uses lineGroupId + skuId to scroll to the
      // relevant freight line.
      row_id: freightLineSkuKey(f.lineGroupId, f.quoteSkuId),
      field_name: null,
      tier_id: f.tierId,
      kind: "pass_through_freight_missing_customs",
      severity: "action_required",
      message: `Pass-through freight needs CBM, duty %, and tariff % to compute landed cost · ${sku.skuLabel} is missing values.`,
      detail_json: {
        line_group_id: f.lineGroupId,
        sku_id: f.quoteSkuId,
        missing_fields: missing,
      },
    });
  }

  return warnings;
}

// ---------- anomalies ----------

function checkAnomalies(input: QuoteCostingInput): WarningSpec[] {
  const warnings: WarningSpec[] = [];

  // Rule: service-fee tier variance across the 5 one-time-charge
  // columns on production_inputs (architect-confirmed: no legitimate
  // reason for these to vary across tiers for the same SKU).
  // fillingBlendingCost and bulkRawCost EXCLUDED — they scale with
  // volume and legitimately vary by tier.
  for (const sku of leafSkus(input)) {
    const skuProd = input.production.filter((p) => p.quoteSkuId === sku.id);
    if (skuProd.length < 2) continue; // need 2+ tiers to detect variance

    for (const col of SERVICE_FEE_COLUMNS) {
      const values: { tierId: string; value: number }[] = [];
      for (const p of skuProd) {
        const v = p[col];
        if (v !== null && v !== undefined) {
          values.push({ tierId: p.tierId, value: Number(v) });
        }
      }
      if (values.length < 2) continue;
      const distinct = new Set(values.map((v) => v.value));
      if (distinct.size <= 1) continue;

      warnings.push({
        scope: "line",
        table_name: "production_inputs",
        // Cross-row key: SKU + column. Variance is across that SKU's
        // production_input rows; no single row "owns" the warning.
        row_id: skuColKey(sku.id, col),
        field_name: col,
        tier_id: null, // cross-tier issue
        kind: "service_fee_tier_variance",
        severity: "review",
        message: `${SERVICE_FEE_LABELS[col]} differs by tier on ${sku.skuLabel} · service fees are usually flat across tiers.`,
        detail_json: {
          sku_id: sku.id,
          column: col,
          per_tier_values: values,
          suggested_fix: {
            kind: "apply_value_to_all_tiers",
            source_tier_id: values[0].tierId,
          },
        },
      });
    }
  }

  // Rule: CBM cross-tier variance (per-(SKU, line)). With the
  // units_in_shipment match suppression caveat (architect added):
  // only flag when units_in_shipment is identical (or both NULL)
  // across the rows being compared. Yield-mismatch shipments
  // legitimately vary CBM by tier.
  // Group freight rows by (lineGroupId, quoteSkuId).
  const freightByLineSku = new Map<string, CostingFreightInput[]>();
  for (const f of input.freight) {
    const k = `${f.lineGroupId}::${f.quoteSkuId}`;
    const arr = freightByLineSku.get(k) ?? [];
    arr.push(f);
    freightByLineSku.set(k, arr);
  }
  for (const [, rows] of freightByLineSku) {
    if (rows.length < 2) continue;
    const cbms = rows
      .map((r) => ({
        tierId: r.tierId,
        cbm: r.skuTotalCbm,
        unitsInShipment: r.unitsInShipment,
      }))
      .filter((r) => r.cbm !== null);
    if (cbms.length < 2) continue;
    // units_in_shipment match suppression: only flag if
    // units_in_shipment is identical across the rows being compared.
    // If even one row has a different (or non-null where others are
    // null) units_in_shipment, yield-mismatch explains the variance.
    const distinctUnits = new Set(
      cbms.map((r) => r.unitsInShipment ?? "null"),
    );
    if (distinctUnits.size > 1) continue;
    const distinctCbm = new Set(cbms.map((r) => Number(r.cbm)));
    if (distinctCbm.size <= 1) continue;
    const sku = input.skus.find((s) => s.id === rows[0].quoteSkuId);
    if (!sku) continue;
    warnings.push({
      scope: "line",
      table_name: "freight_inputs",
      row_id: freightLineSkuKey(rows[0].lineGroupId, rows[0].quoteSkuId),
      field_name: "sku_total_cbm",
      tier_id: null,
      kind: "cbm_cross_tier_variance",
      severity: "review",
      message: `CBM differs across tiers for ${sku.skuLabel} on this freight line · CBM is normally constant per (SKU, shipment).`,
      detail_json: {
        line_group_id: rows[0].lineGroupId,
        sku_id: rows[0].quoteSkuId,
        per_tier_cbms: cbms,
        suggested_fix: {
          kind: "apply_value_to_all_tiers",
          source_tier_id: cbms[0].tierId,
        },
      },
    });
  }

  // Rule: markup above 5× firm default. Severity: review. The firm
  // default for each category lives in input.markupDefaults; the
  // override lives on the line. Compare line.markup_pct to default.
  for (const p of input.packaging) {
    if (p.markupPct === null || p.category === null) continue;
    const fallback = input.markupDefaults[p.category];
    if (fallback === undefined || fallback <= 0) continue;
    if (p.markupPct > fallback * 5) {
      const sku = input.skus.find((s) => s.id === p.quoteSkuId);
      warnings.push({
        scope: "line",
        table_name: "packaging_inputs",
        // Composite key: SKU + lineGroup + tier — packaging row
        // identity. (Note: PR 2 may refactor to use packaging_inputs
        // row uuid directly once threaded through CostingPackagingInput.)
        row_id: `pkg:${p.quoteSkuId}:line:${p.lineGroupId}:tier:${p.tierId}`,
        field_name: "markup_pct",
        tier_id: p.tierId,
        kind: "markup_above_5x_default",
        severity: "review",
        message: `Markup of ${(p.markupPct * 100).toFixed(0)}% on ${sku?.skuLabel ?? "line"} is unusually high (firm default ${(fallback * 100).toFixed(0)}%).`,
        detail_json: {
          sku_id: p.quoteSkuId,
          line_group_id: p.lineGroupId,
          tier_id: p.tierId,
          line_markup: p.markupPct,
          firm_default: fallback,
          ratio: p.markupPct / fallback,
        },
      });
    }
  }

  // Rule: negative cost. Severity: action_required. Client validation
  // typically catches; engine catches edge cases.
  type CostCheck = {
    table: string;
    rowKey: string;
    field: string;
    tierId: string | null;
    value: number;
    skuId: string;
  };
  const costChecks: CostCheck[] = [];
  for (const p of input.packaging) {
    if (p.unitCost !== null && p.unitCost < 0) {
      costChecks.push({
        table: "packaging_inputs",
        rowKey: `pkg:${p.quoteSkuId}:line:${p.lineGroupId}:tier:${p.tierId}`,
        field: "unit_cost",
        tierId: p.tierId,
        value: p.unitCost,
        skuId: p.quoteSkuId,
      });
    }
  }
  for (const pr of input.production) {
    for (const col of [
      "fillingBlendingCost",
      "cmAssemblyTotal",
      "setupFeeTotal",
      "toolingArtworkTotal",
      "rdTotal",
      "otherServiceTotal",
      "bulkRawCost",
    ] as const) {
      const v = pr[col];
      if (v !== null && v !== undefined && Number(v) < 0) {
        costChecks.push({
          table: "production_inputs",
          rowKey: `prod:${pr.quoteSkuId}:tier:${pr.tierId}`,
          field: col,
          tierId: pr.tierId,
          value: Number(v),
          skuId: pr.quoteSkuId,
        });
      }
    }
  }
  for (const f of input.freight) {
    if (f.totalFreight !== null && f.totalFreight < 0) {
      costChecks.push({
        table: "freight_inputs",
        rowKey: freightLineSkuKey(f.lineGroupId, f.quoteSkuId),
        field: "total_freight",
        tierId: f.tierId,
        value: f.totalFreight,
        skuId: f.quoteSkuId,
      });
    }
  }
  for (const c of costChecks) {
    const sku = input.skus.find((s) => s.id === c.skuId);
    warnings.push({
      scope: "line",
      table_name: c.table,
      row_id: c.rowKey,
      field_name: c.field,
      tier_id: c.tierId,
      kind: "negative_cost",
      severity: "action_required",
      message: `Cost cannot be negative on ${sku?.skuLabel ?? "line"} · ${c.field} = ${c.value}.`,
      detail_json: {
        sku_id: c.skuId,
        column: c.field,
        value: c.value,
      },
    });
  }

  // Rule: zero cost on populated row. Severity: review. Suggests
  // either intentional (special handling fee, included-with-other)
  // or a typo. Suggested-accept-reason "special handling fee"
  // pre-populated in detail_json so the popover one-clicks.
  for (const p of input.packaging) {
    if (p.unitCost === 0 && p.qtyPerSellableUnit !== null) {
      const sku = input.skus.find((s) => s.id === p.quoteSkuId);
      warnings.push({
        scope: "line",
        table_name: "packaging_inputs",
        row_id: `pkg:${p.quoteSkuId}:line:${p.lineGroupId}:tier:${p.tierId}`,
        field_name: "unit_cost",
        tier_id: p.tierId,
        kind: "zero_cost_populated_row",
        severity: "review",
        message: `Cost is $0 on populated row (${sku?.skuLabel ?? "SKU"} · ${tierLabel(input, p.tierId)}) · is this intentional?`,
        detail_json: {
          sku_id: p.quoteSkuId,
          line_group_id: p.lineGroupId,
          tier_id: p.tierId,
          suggested_accept_reason: "special_handling_fee",
        },
      });
    }
  }

  return warnings;
}

// ---------- outliers (statistical) ----------

// Per-category 5× outlier rule. Only fires when N ≥ 4 SKUs in the
// relevant category (per Edward Q4 — statistical baseline too noisy
// below that). Computes median per-unit cost across all SKUs in the
// category for the active tier set; flags any single SKU's per-unit
// cost > 5× the median.
//
// Uses computed contributions from `costing` argument rather than
// summing inputs directly — costing already amortizes setup fees,
// applies markups, etc. The outlier we want to catch is "this SKU's
// final-rendered packaging contribution is 8× higher than its
// peers," not "this SKU has one expensive line item."
const OUTLIER_MIN_SKUS = 4;
const OUTLIER_MULTIPLIER = 5;

function checkOutliers(
  input: QuoteCostingInput,
  costing: QuoteCostingResult,
): WarningSpec[] {
  const warnings: WarningSpec[] = [];

  // Build per-SKU per-tier per-category contribution map.
  // Use the "primary" tier (largest tier by qty, fallback first) for
  // the outlier check — picking one tier avoids multi-tier noise
  // and matches PM mental model of "compare apples to apples at the
  // anchor volume."
  if (input.tiers.length === 0) return warnings;
  const primaryTier =
    [...input.tiers].sort((a, b) => (b.qty ?? 0) - (a.qty ?? 0))[0] ??
    input.tiers[0];

  type CategoryContrib = {
    skuId: string;
    skuLabel: string;
    packaging: number;
    production: number;
    freight: number;
  };
  const contribs: CategoryContrib[] = [];
  for (const sku of leafSkus(input)) {
    const rollup: SkuRollup | undefined = costing.skuRollups.find(
      (r) => r.skuId === sku.id,
    );
    if (!rollup) continue;
    const perTier = rollup.perTier.find((pt) => pt.tierId === primaryTier.id);
    if (!perTier) continue;
    contribs.push({
      skuId: sku.id,
      skuLabel: sku.skuLabel,
      packaging: perTier.packagingCostPerUnit,
      production: perTier.productionCostPerUnit,
      // Total landed freight before markup is the right comparison
      // basis — markup-amplified values double-count anomalies.
      freight: perTier.totalLandedFreightBeforeMarkup,
    });
  }
  if (contribs.length < OUTLIER_MIN_SKUS) return warnings;

  for (const category of ["packaging", "production", "freight"] as const) {
    const values = contribs
      .map((c) => ({ skuId: c.skuId, skuLabel: c.skuLabel, value: c[category] }))
      .filter((v) => v.value > 0);
    if (values.length < OUTLIER_MIN_SKUS) continue;
    const sorted = [...values].sort((a, b) => a.value - b.value);
    const median =
      sorted.length % 2 === 1
        ? sorted[Math.floor(sorted.length / 2)].value
        : (sorted[sorted.length / 2 - 1].value + sorted[sorted.length / 2].value) /
          2;
    if (median <= 0) continue;
    for (const v of values) {
      if (v.value > median * OUTLIER_MULTIPLIER) {
        warnings.push({
          scope: "line",
          table_name: `${category}_inputs`,
          row_id: skuColKey(v.skuId, `${category}_outlier`),
          field_name: null,
          tier_id: primaryTier.id,
          kind: "category_outlier_5x",
          severity: "review",
          message: `${v.skuLabel}'s ${category} cost ($${v.value.toFixed(2)}/u) is ${(v.value / median).toFixed(1)}× higher than the median ($${median.toFixed(2)}/u) on this quote · is this intentional?`,
          detail_json: {
            sku_id: v.skuId,
            category,
            sku_value: v.value,
            quote_median: median,
            ratio: v.value / median,
            tier_id_evaluated: primaryTier.id,
            sku_count_in_category: values.length,
          },
        });
      }
    }
  }

  return warnings;
}
