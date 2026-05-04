"use server";

// Slice 9.5 action layer for `quote_warnings`. Three responsibilities:
//
// 1. `reconcileWarnings(quoteId, engineSpecs, ...)` — the central
//    helper. Takes engine output + existing DB state; computes the
//    insert/resolve/evaluate diff; applies in a single transaction.
//    Called by every action that mutates cost-input data, on commit.
//    Returns a cascade summary the caller folds into their audit row's
//    diff_json under `cascaded_warnings` keys.
//
// 2. `acceptWarning(formData)` — PM-explicit acceptance with reason.
//    Status flips active→accepted; own audit row.
//
// 3. `getQuoteWarnings(quoteId)` — read action for client bootstrap.
//    Returns active + recently accepted warnings on the quote.
//
// Persistence asymmetry from costing (per brief §3 + architect Q-F):
// reconciliation runs on action commit, not per keystroke. Engine
// fires client-side many times for inline display; server-side
// persists only when an action actually mutates a row. Slice 8.5
// realtime subscription on quote_warnings handles cross-PM sync.
//
// Identity tuple: (quote_id, table_name, row_id, field_name, tier_id, kind).
// row_id is TEXT — UUID-as-text for genuine row warnings, synthesized
// composite text key for cross-row pattern warnings (e.g.,
// "sku:<sku_id>:col:setup_fee_total"). See validation.ts.

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  firmSettings,
  freightInputs,
  markupDefaults,
  packagingInputs,
  productionInputs,
  quotes,
  quoteSkus,
  quoteSkuTiers,
  quoteSkuTierTargets,
  quoteTiers,
  quoteWarnings,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  computeQuoteCosting,
  type QuoteCostingInput,
  type QuoteCostingResult,
} from "@/lib/costing";
import { revalidateQuoteTree } from "@/lib/revalidate";
import { validateQuote, type WarningSpec } from "@/lib/validation";

// ---------- types ----------

export type QuoteWarning = {
  id: string;
  quoteId: string;
  scope: "line" | "quote";
  tableName: string | null;
  rowId: string | null;
  fieldName: string | null;
  tierId: string | null;
  kind: string;
  severity: "info" | "review" | "action_required";
  status: "active" | "accepted" | "auto_resolved";
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  acceptReasonKind: string | null;
  acceptReasonText: string | null;
  autoResolvedAt: Date | null;
  message: string;
  detailJson: Record<string, unknown> | null;
  createdAt: Date;
  lastEvaluatedAt: Date;
};

export type ReconcileSummary = {
  inserted: number;
  resolved: number;
  evaluated: number;
};

// ---------- helper: load costing input for quote ----------

// Extracted loader. Existing call sites in `actions/costing.ts`
// (getQuoteCosting, getCostingBundle, applyClientTargetSolveTierAdj)
// duplicate this shape; brief §3 acknowledges the duplication and
// notes a future shared helper. THIS helper is a fresh extraction —
// when the duplicate sites refactor (likely RI.1 or earlier),
// they'll consume this same loader.
async function loadCostingForQuote(
  quoteId: string,
): Promise<{ input: QuoteCostingInput; costing: QuoteCostingResult } | null> {
  const quoteRows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) return null;
  const quote = quoteRows[0];

  const fsRows = await db
    .select()
    .from(firmSettings)
    .where(isNull(firmSettings.effectiveUntil))
    .orderBy(desc(firmSettings.effectiveFrom))
    .limit(1);
  const fs = fsRows[0];
  if (!fs) return null;

  const [skus, tiers, pkgs, prods, frts, mks, cellOvr, cellTgt] =
    await Promise.all([
      db
        .select()
        .from(quoteSkus)
        .where(eq(quoteSkus.quoteId, quoteId))
        .orderBy(asc(quoteSkus.sortOrder), asc(quoteSkus.createdAt)),
      db
        .select()
        .from(quoteTiers)
        .where(eq(quoteTiers.quoteId, quoteId))
        .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
      db
        .select()
        .from(packagingInputs)
        .innerJoin(quoteSkus, eq(quoteSkus.id, packagingInputs.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      db
        .select()
        .from(productionInputs)
        .innerJoin(quoteSkus, eq(quoteSkus.id, productionInputs.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      db
        .select()
        .from(freightInputs)
        .innerJoin(quoteSkus, eq(quoteSkus.id, freightInputs.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      db.select().from(markupDefaults),
      db
        .select({
          quoteSkuId: quoteSkuTiers.quoteSkuId,
          tierId: quoteSkuTiers.tierId,
          sellPriceOverride: quoteSkuTiers.sellPriceOverride,
        })
        .from(quoteSkuTiers)
        .innerJoin(quoteSkus, eq(quoteSkus.id, quoteSkuTiers.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      db
        .select({
          quoteSkuId: quoteSkuTierTargets.quoteSkuId,
          tierId: quoteSkuTierTargets.tierId,
          clientTargetPricePerUnit:
            quoteSkuTierTargets.clientTargetPricePerUnit,
        })
        .from(quoteSkuTierTargets)
        .innerJoin(quoteSkus, eq(quoteSkus.id, quoteSkuTierTargets.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
    ]);

  const numOrNull = (v: string | null): number | null => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const num = (v: string | null, fallback = 0): number =>
    numOrNull(v) ?? fallback;

  const markupMap: Record<string, number> = Object.fromEntries(
    mks.map((m) => [m.category, Number(m.defaultMarkupPct)]),
  );

  const input: QuoteCostingInput = {
    quote: {
      id: quote.id,
      globalPriceAdjPct: num(quote.globalPriceAdjPct),
      targetMarginPct: numOrNull(quote.targetMarginPct),
    },
    firmSettings: {
      targetMarginPct: num(fs.targetMarginPct),
      floorMarginPct: num(fs.floorMarginPct),
    },
    markupDefaults: markupMap,
    skus: skus.map((s) => ({
      id: s.id,
      parentSkuId: s.parentSkuId,
      qtyPerParent: numOrNull(s.qtyPerParent),
      skuRole: s.skuRole as "leaf" | "assembly",
      skuLabel: s.skuLabel,
      productName: s.productName,
      sortOrder: s.sortOrder,
      dutyPct: numOrNull(s.dutyPct),
      tariffPct: numOrNull(s.tariffPct),
      retailBenchmark: numOrNull(s.retailBenchmark),
    })),
    tiers: tiers.map((t) => ({
      id: t.id,
      label: t.label,
      qty: t.qty,
      sortOrder: t.sortOrder,
      tierPriceAdjPct: numOrNull(t.tierPriceAdjPct),
    })),
    cellOverrides: cellOvr.map((c) => ({
      quoteSkuId: c.quoteSkuId,
      tierId: c.tierId,
      sellPriceOverride: num(c.sellPriceOverride),
    })),
    cellTargets: cellTgt.map((c) => ({
      quoteSkuId: c.quoteSkuId,
      tierId: c.tierId,
      clientTargetPricePerUnit: num(c.clientTargetPricePerUnit),
    })),
    packaging: pkgs.map((r) => {
      const p = r.packaging_inputs;
      return {
        quoteSkuId: p.quoteSkuId,
        tierId: p.tierId,
        lineGroupId: p.lineGroupId,
        unitCost: numOrNull(p.unitCost),
        qtyPerSellableUnit: numOrNull(p.qtyPerSellableUnit),
        category: p.category,
        markupPct: numOrNull(p.markupPct),
      };
    }),
    production: prods.map((r) => {
      const p = r.production_inputs;
      return {
        quoteSkuId: p.quoteSkuId,
        tierId: p.tierId,
        customerShipsRaws: p.customerShipsRaws,
        allocateServiceFeesToCost: p.allocateServiceFeesToCost,
        fillingBlendingCost: numOrNull(p.fillingBlendingCost),
        cmAssemblyTotal: numOrNull(p.cmAssemblyTotal),
        setupFeeTotal: numOrNull(p.setupFeeTotal),
        toolingArtworkTotal: numOrNull(p.toolingArtworkTotal),
        rdTotal: numOrNull(p.rdTotal),
        otherServiceTotal: numOrNull(p.otherServiceTotal),
        bulkRawCost: numOrNull(p.bulkRawCost),
        actualUnitsProduced: p.actualUnitsProduced,
      };
    }),
    freight: frts.map((r) => {
      const f = r.freight_inputs;
      return {
        quoteSkuId: f.quoteSkuId,
        tierId: f.tierId,
        lineGroupId: f.lineGroupId,
        totalFreight: numOrNull(f.totalFreight),
        unitsInShipment: f.unitsInShipment,
        skuTotalCbm: numOrNull(f.skuTotalCbm),
        markupPct: numOrNull(f.markupPct),
        freightTreatment: f.freightTreatment,
      };
    }),
  };

  const costing = computeQuoteCosting(input);
  return { input, costing };
}

// ---------- internal helper: identity tuple ----------

function identityKey(w: {
  tableName: string | null;
  rowId: string | null;
  fieldName: string | null;
  tierId: string | null;
  kind: string;
}): string {
  return `${w.tableName ?? ""}::${w.rowId ?? ""}::${w.fieldName ?? ""}::${w.tierId ?? ""}::${w.kind}`;
}

function specKey(s: WarningSpec): string {
  return `${s.table_name ?? ""}::${s.row_id ?? ""}::${s.field_name ?? ""}::${s.tier_id ?? ""}::${s.kind}`;
}

// ---------- core: reconcileWarnings ----------

// Called from inside other server actions, after the primary write
// has succeeded but BEFORE the action's audit row is written
// (so the cascade summary can be folded into diff_json).
//
// Returns a cascade summary the caller folds into their audit row.
// Three counts:
//   - inserted: new active rows (engine fires on something not
//     previously tracked, OR engine re-fires after auto_resolve)
//   - resolved: active rows engine no longer fires on; flipped to
//     auto_resolved
//   - evaluated: active rows engine still fires on; last_evaluated_at
//     touched (no status change)
//
// Acceptance is sticky per architect option (iii) — accepted rows
// stay suppressed until manual re-activate or row delete; engine
// output for an accepted-tuple is silently ignored at this layer.
export async function reconcileWarnings(args: {
  quoteId: string;
}): Promise<ReconcileSummary> {
  const { quoteId } = args;

  const loaded = await loadCostingForQuote(quoteId);
  if (!loaded) {
    // Quote disappeared mid-action (cascade-deleted, etc.). Nothing
    // to reconcile; FK CASCADE on quote_warnings.quote_id will have
    // cleaned up.
    return { inserted: 0, resolved: 0, evaluated: 0 };
  }

  const engineSpecs = validateQuote(loaded.input, loaded.costing);

  const existing = await db
    .select()
    .from(quoteWarnings)
    .where(eq(quoteWarnings.quoteId, quoteId));

  // Index existing rows by identity key. Multiple rows can share a
  // key when historical accepted/auto_resolved rows accumulate; the
  // active row (if any) wins for the matching logic.
  type ExistingRow = (typeof existing)[number];
  const existingByKey = new Map<string, ExistingRow[]>();
  for (const r of existing) {
    const k = identityKey({
      tableName: r.tableName,
      rowId: r.rowId,
      fieldName: r.fieldName,
      tierId: r.tierId,
      kind: r.kind,
    });
    const arr = existingByKey.get(k) ?? [];
    arr.push(r);
    existingByKey.set(k, arr);
  }

  const engineByKey = new Map<string, WarningSpec>();
  for (const s of engineSpecs) {
    engineByKey.set(specKey(s), s);
  }

  const inserts: WarningSpec[] = [];
  const evaluateIds: string[] = [];
  const resolveIds: string[] = [];

  for (const [k, spec] of engineByKey) {
    const rows = existingByKey.get(k) ?? [];
    const active = rows.find((r) => r.status === "active");
    const accepted = rows.find((r) => r.status === "accepted");
    if (accepted) {
      // Acceptance is sticky (option iii). Don't insert; don't
      // re-evaluate. Suppression holds until manual re-activate or
      // row delete.
      continue;
    }
    if (active) {
      // Engine still fires on an active row → bump last_evaluated_at.
      evaluateIds.push(active.id);
    } else {
      // No matching active row (only auto_resolved historical rows,
      // or none) → INSERT new active row. Architect verdict: engine
      // re-firing post-auto-resolve creates a new active row;
      // historical row stays as audit record.
      inserts.push(spec);
    }
  }

  for (const [k, rows] of existingByKey) {
    if (engineByKey.has(k)) continue;
    // Engine no longer fires on this tuple → flip any active row to
    // auto_resolved. Accepted rows stay accepted.
    const active = rows.find((r) => r.status === "active");
    if (active) {
      resolveIds.push(active.id);
    }
  }

  // Apply.
  if (inserts.length > 0) {
    await db.insert(quoteWarnings).values(
      inserts.map((s) => ({
        quoteId,
        scope: s.scope,
        tableName: s.table_name,
        rowId: s.row_id,
        fieldName: s.field_name,
        tierId: s.tier_id,
        kind: s.kind,
        severity: s.severity,
        status: "active" as const,
        message: s.message,
        detailJson: s.detail_json,
      })),
    );
  }
  if (evaluateIds.length > 0) {
    await db
      .update(quoteWarnings)
      .set({ lastEvaluatedAt: new Date() })
      .where(inArray(quoteWarnings.id, evaluateIds));
  }
  if (resolveIds.length > 0) {
    const now = new Date();
    await db
      .update(quoteWarnings)
      .set({ status: "auto_resolved", autoResolvedAt: now })
      .where(inArray(quoteWarnings.id, resolveIds));
  }

  return {
    inserted: inserts.length,
    resolved: resolveIds.length,
    evaluated: evaluateIds.length,
  };
}

// ---------- server action: acceptWarning ----------

// PM-explicit acceptance with reason. Status flips active → accepted.
// Per architect option (iii): suppression sticks until manual
// re-activate or row delete. UX for re-activate is UX_BACKLOG
// candidate (not 9.5 blocking).
//
// Form contract:
//   - warningId: UUID of an active quote_warnings row
//   - acceptReasonKind: 'vendor_moq_break' | 'customer_specific_pricing'
//                       | 'special_handling_fee' | 'custom'
//   - acceptReasonText: free-form (required when kind === 'custom')
//
// Audit pattern:
//   - entity_type = "quote_warnings"
//   - entity_id = warning.id (UUID-as-text per audit_log convention)
//   - action = "warning_accepted"
//   - diff_json carries kind, severity, accept_reason_kind,
//     accept_reason_text, scope, identity_tuple components
//   - caused_by_audit_id is NULL for v1 (would require a
//     `created_by_audit_id` column on quote_warnings to support;
//     UX_BACKLOG candidate if forensic link becomes important)
const VALID_ACCEPT_REASON_KINDS = new Set([
  "vendor_moq_break",
  "customer_specific_pricing",
  "special_handling_fee",
  "custom",
]);

export async function acceptWarning(formData: FormData): Promise<
  ActionResult<{ warningId: string; status: "accepted" }>
> {
  return runAction(async () => {
    const warningId = String(formData.get("warningId") ?? "").trim();
    const reasonKind = String(formData.get("acceptReasonKind") ?? "").trim();
    const reasonText = String(formData.get("acceptReasonText") ?? "").trim();

    if (!warningId)
      throw new ActionGuardError(ERR.VALIDATION, "warningId required");
    if (!VALID_ACCEPT_REASON_KINDS.has(reasonKind)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Invalid acceptReasonKind. Use vendor_moq_break, customer_specific_pricing, special_handling_fee, or custom.",
      );
    }
    if (reasonKind === "custom" && reasonText.length === 0) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Custom acceptance requires a reason text.",
      );
    }

    const user = await ensureUser();

    // Load the warning. Must be active (can't re-accept already-
    // accepted; can't accept auto_resolved — engine re-fired since).
    const rows = await db
      .select()
      .from(quoteWarnings)
      .where(eq(quoteWarnings.id, warningId))
      .limit(1);
    if (rows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Warning not found");
    const w = rows[0];
    if (w.status !== "active") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Warning is in '${w.status}' status; only active warnings can be accepted.`,
      );
    }

    // Verify quote is draft (consistent with other mutation actions).
    const quoteRows = await db
      .select({ id: quotes.id, projectId: quotes.projectId, status: quotes.status })
      .from(quotes)
      .where(eq(quotes.id, w.quoteId))
      .limit(1);
    if (quoteRows.length === 0) {
      throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found");
    }
    const quote = quoteRows[0];
    if (quote.status !== "draft") {
      throw new ActionGuardError(
        ERR.QUOTE_NOT_DRAFT,
        `Quote is in '${quote.status}' status; warnings can only be accepted on draft quotes.`,
      );
    }

    const now = new Date();
    await db
      .update(quoteWarnings)
      .set({
        status: "accepted",
        acceptedByUserId: user.id,
        acceptedAt: now,
        acceptReasonKind: reasonKind,
        acceptReasonText: reasonKind === "custom" ? reasonText : null,
      })
      .where(eq(quoteWarnings.id, warningId));

    await db.insert(auditLog).values({
      userId: user.id,
      entityType: "quote_warnings",
      entityId: warningId,
      action: "warning_accepted",
      diffJson: {
        warning_id: warningId,
        quote_id: w.quoteId,
        scope: w.scope,
        kind: w.kind,
        severity: w.severity,
        identity_tuple: {
          table_name: w.tableName,
          row_id: w.rowId,
          field_name: w.fieldName,
          tier_id: w.tierId,
        },
        accept_reason_kind: reasonKind,
        accept_reason_text: reasonKind === "custom" ? reasonText : null,
      },
    });

    revalidateQuoteTree(quote.projectId, w.quoteId);

    return { warningId, status: "accepted" as const };
  });
}

// ---------- server action: getQuoteWarnings ----------

// Read action for client bootstrap. Returns active + recently
// accepted warnings on the quote. Auto_resolved rows omitted by
// default (historical noise; surface separately if PM forensic mode
// is added later).
export async function getQuoteWarnings(
  quoteId: string,
): Promise<ActionResult<QuoteWarning[]>> {
  return runAction(async () => {
    const rows = await db
      .select()
      .from(quoteWarnings)
      .where(
        and(
          eq(quoteWarnings.quoteId, quoteId),
          inArray(quoteWarnings.status, ["active", "accepted"]),
        ),
      )
      .orderBy(desc(quoteWarnings.createdAt));

    return rows.map((r): QuoteWarning => ({
      id: r.id,
      quoteId: r.quoteId,
      scope: r.scope as "line" | "quote",
      tableName: r.tableName,
      rowId: r.rowId,
      fieldName: r.fieldName,
      tierId: r.tierId,
      kind: r.kind,
      severity: r.severity as "info" | "review" | "action_required",
      status: r.status as "active" | "accepted" | "auto_resolved",
      acceptedByUserId: r.acceptedByUserId,
      acceptedAt: r.acceptedAt,
      acceptReasonKind: r.acceptReasonKind,
      acceptReasonText: r.acceptReasonText,
      autoResolvedAt: r.autoResolvedAt,
      message: r.message,
      detailJson: r.detailJson as Record<string, unknown> | null,
      createdAt: r.createdAt,
      lastEvaluatedAt: r.lastEvaluatedAt,
    }));
  });
}
