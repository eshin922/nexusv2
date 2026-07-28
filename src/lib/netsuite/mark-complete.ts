import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  quotes as quotesTable,
  quoteTiers,
  projects,
  firmSettings,
  hubspotDealsCache,
  netsuiteSoPushes,
  auditLog,
} from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { loadAssemblyTree } from "@/lib/assembly-tree";
import {
  resolveNetsuiteCustomer,
  formatCustomerMissingError,
} from "./customer-map";
import {
  resolveNetsuiteItem,
  formatResolutionErrors,
  type ResolveResult,
} from "./item-resolver";
import { resolveBusinessSegmentLabel } from "./business-segment-resolver";
import { findOrCreateItemGroup } from "./item-groups";
import {
  buildSalesOrderPayload,
  computeIdempotencyKey,
  createSalesOrder,
  type SalesOrderLine,
} from "./sales-orders";
import { NetsuiteError } from "./errors";

// Slice 12 Step 8c-3 — markComplete orchestrator.
//
// Ordering per CA Amendment A (2026-07-28), external-first per v3 §5.1:
//   1. Guards (below-floor on accepted_tier_id, revisable state)
//        — before any external call
//   2. Resolve customer (customer-map lookup; block on miss)
//   3. Resolve items (SKU-match; block on not_found/ambiguous)
//   4. Resolve business_segment label (block if fetch/lookup fails)
//   5. For each assembly on accepted-tier: find-or-create Item Group
//        — dual idempotency layer 1 (cache → SuiteQL → create)
//   6. CHECK netsuite_so_pushes for existing SUCCEEDED row for
//        (quote_id, accepted_tier_id) → if hit, skip SO create and
//        jump to freeze-tx with the stored so_id/tranid
//        — #145 poisoning precedent applied
//   7. Build SO payload → REST POST create (idempotency-key header
//        as belt over CHECK)
//   8. PERSIST netsuite_so_pushes row (status='succeeded')
//   9. DB tx: freeze Pattern 52 columns + status='complete' + audit
//  10. Post-tx: conditional HubSpot amount patch (§7.2 amended)
//        — patch failure LOGGED but MUST NOT block complete
//
// Return shape describes what happened at each step for the caller
// (server action, sub-tab-5 UI later) to render.

export interface MarkCompleteResult {
  completedAt: Date;
  netsuite: {
    salesOrderId: string;      // internal id
    salesOrderTranid: string | null;  // display id ("SO2647"); may be null
    amountPushed: number;
    itemGroups: Array<{
      assemblyId: string;
      compositionHash: string;
      netsuiteExternalId: string;
      netsuiteInternalId: string;
      itemidDisplay: string;
      outcome: "cache_hit" | "external_id_hit" | "created";
    }>;
  };
  amountPatch: {
    status: "skipped" | "would_be_pushed" | "not_wired";
    prior: number | null;
    current: number;
    delta: number | null;
  };
  retryOutcome: "fresh" | "converged_from_prior_success";
}

export interface MarkCompleteInput {
  quoteId: string;
  actorUserId: string;
}

/**
 * Orchestrate the markComplete flow. Called from the server action;
 * returns rich result for audit + UI. Throws Error on any blocking
 * failure (caller translates to ActionResult error).
 *
 * IMPORTANT: this function should be wrapped in runAction() upstream;
 * error messages here are PM-facing on the blocking-tab UI (8c-4).
 */
export async function runMarkComplete(
  input: MarkCompleteInput,
): Promise<MarkCompleteResult> {
  const { quoteId, actorUserId } = input;

  // ============================================================
  // STEP 1 — Load state + guards
  // ============================================================
  const quote = await loadQuoteOrThrow(quoteId);
  if (quote.status !== "accepted") {
    throw new Error(
      `markComplete only fires on 'accepted' quotes; current state: '${quote.status}'.`,
    );
  }
  if (!quote.acceptedTierId) {
    throw new Error(
      "Quote is accepted but has no accepted_tier_id set — cannot proceed.",
    );
  }

  const [tierRow] = await db
    .select({
      id: quoteTiers.id,
      label: quoteTiers.label,
      qty: quoteTiers.qty,
    })
    .from(quoteTiers)
    .where(and(eq(quoteTiers.id, quote.acceptedTierId), eq(quoteTiers.quoteId, quoteId)))
    .limit(1);
  if (!tierRow) {
    throw new Error(
      "Accepted tier not found on this quote — data integrity issue.",
    );
  }

  const bundle = await getCostingBundle(quoteId);
  if (!bundle.ok) {
    throw new Error(`Costing bundle error: ${bundle.error.message}`);
  }

  const tierRollup = bundle.data.costing.quoteRollup.find(
    (r) => r.tierId === quote.acceptedTierId,
  );
  if (!tierRollup) {
    throw new Error(
      "Accepted tier has no revenue rollup — cost data incomplete.",
    );
  }

  // Below-floor guard — evaluated on accepted_tier_id (NOT customer_
  // accepted_tier_id). markComplete's OWN guard per CA (mirrors
  // markAccepted's discipline; not re-using markAccepted's guard
  // because the accepted_tier_id may differ under PM override paths).
  // Blocks UNCONDITIONALLY — admin override deferred v1.1+ per CA Q4.
  if (tierRollup.blendedMarginStatus === "BELOW_FLOOR") {
    throw new Error(
      `Blocked — the accepted tier (${tierRollup.label}) is below the firm's margin floor. Cannot advance to complete.`,
    );
  }

  const currentAmount = tierRollup.totalRevenue;

  // ============================================================
  // STEP 2 — Resolve customer (customer-map lookup)
  // ============================================================
  const [projectRow] = await db
    .select({
      id: projects.id,
      hubspotDealId: projects.hubspotDealId,
    })
    .from(projects)
    .where(eq(projects.id, quote.projectId))
    .limit(1);
  if (!projectRow || !projectRow.hubspotDealId) {
    throw new Error("Project not found or not HubSpot-linked.");
  }

  // Look up the HubSpot company id via the cache row.
  const [dealCache] = await db
    .select({
      associatedCompanyId: hubspotDealsCache.associatedCompanyId,
      dealName: hubspotDealsCache.dealName,
      dealFolderUrl: hubspotDealsCache.dealFolderUrl,
      projectServiceS: hubspotDealsCache.projectServiceS,
      projectCategory: hubspotDealsCache.projectCategory,
      sourcingLocation: hubspotDealsCache.sourcingLocation,
      businessSegmentId: hubspotDealsCache.businessSegmentId,
      businessSegmentLabel: hubspotDealsCache.businessSegmentLabel,
      clientPo: hubspotDealsCache.clientPo,
      invoiceDateEst: hubspotDealsCache.invoiceDateEst,
      productionShipDateEst: hubspotDealsCache.productionShipDateEst,
      priority: hubspotDealsCache.priority,
      dealType: hubspotDealsCache.dealType,
    })
    .from(hubspotDealsCache)
    .where(eq(hubspotDealsCache.dealId, projectRow.hubspotDealId))
    .limit(1);
  if (!dealCache || !dealCache.associatedCompanyId) {
    throw new Error(
      `HubSpot deal ${projectRow.hubspotDealId} has no cached row or no associated company. Refresh HubSpot cache and retry.`,
    );
  }

  const customer = await resolveNetsuiteCustomer(dealCache.associatedCompanyId);
  if (customer.status !== "found") {
    throw new Error(formatCustomerMissingError(customer));
  }

  // ============================================================
  // STEP 3 — Resolve items (SKU-match)
  // ============================================================
  // Load assembly tree via loadAssemblyTree (F1.5 ASY/LEAF path).
  const tree = await loadAssemblyTree(quoteId);
  if (!tree || tree.assemblies.length === 0) {
    throw new Error("Quote has no assemblies to push.");
  }

  // Every UNIQUE leaf SKU across all assemblies must resolve.
  const uniqueSkus = Array.from(
    new Set(
      tree.assemblies
        .flatMap((a) => a.children)
        .map((child) => child.sku)
        .filter((s): s is string => Boolean(s)),
    ),
  );
  const resolutionResults: ResolveResult[] = [];
  for (const sku of uniqueSkus) {
    resolutionResults.push(await resolveNetsuiteItem(sku));
  }
  const resolutionError = formatResolutionErrors(resolutionResults);
  if (resolutionError) throw new Error(resolutionError);
  // Build a sku → resolved id map from the "found" results.
  const nsIdBySku = new Map<string, string>();
  for (const r of resolutionResults) {
    if (r.status === "found") nsIdBySku.set(r.sku, r.netsuiteItemId);
  }

  // ============================================================
  // STEP 4 — Resolve business_segment label (block on fetch fail)
  // ============================================================
  let resolvedBusinessSegmentLabel: string | null = null;
  if (dealCache.businessSegmentId) {
    // Per CA Q6: block push if fetch fails or enum id has no label.
    resolvedBusinessSegmentLabel = await resolveBusinessSegmentLabel(
      dealCache.businessSegmentId,
      { dealIdForBackfill: projectRow.hubspotDealId },
    );
  }

  // ============================================================
  // STEP 5 — For each assembly: find-or-create Item Group
  // ============================================================
  const itemGroupOutcomes: MarkCompleteResult["netsuite"]["itemGroups"] = [];
  const assemblyToGroupInternalId = new Map<string, string>();

  for (const assembly of tree.assemblies) {
    const memberHashInputs = assembly.children.map((child) => {
      if (!child.sku) {
        throw new Error(
          `Assembly ${assembly.sku} has a leaf without a SKU — cannot resolve.`,
        );
      }
      const nsId = nsIdBySku.get(child.sku);
      if (!nsId) {
        throw new Error(
          `Internal: SKU ${child.sku} passed resolution but has no NS id. Bug.`,
        );
      }
      // quantity comes off the junction as a numeric string (Drizzle
      // numeric column). Parse; enforce positive integer.
      const rawQty = Number(child.quantity);
      const quantity = Number.isFinite(rawQty) && rawQty > 0
        ? Math.max(1, Math.round(rawQty))
        : 1;
      return {
        netsuiteItemId: nsId,
        quantity,
        sku: child.sku,
        name: child.name ?? child.sku,
      };
    });

    const group = await findOrCreateItemGroup({
      hashInput: {
        customerNetsuiteId: customer.netsuiteCustomerId,
        baseSku: assembly.sku,
        members: memberHashInputs.map((m) => ({
          netsuiteItemId: m.netsuiteItemId,
          quantity: m.quantity,
        })),
      },
      members: memberHashInputs,
      customerDisplay:
        customer.netsuiteCustomerDisplayName || dealCache.associatedCompanyId,
      dealName: dealCache.dealName,
      hubspotDealId: projectRow.hubspotDealId,
      quoteId,
      userId: actorUserId,
    });

    itemGroupOutcomes.push({
      assemblyId: assembly.id,
      compositionHash: group.compositionHash,
      netsuiteExternalId: group.netsuiteExternalId,
      netsuiteInternalId: group.netsuiteInternalId,
      itemidDisplay: group.itemidDisplay,
      outcome: group.outcome,
    });
    assemblyToGroupInternalId.set(assembly.id, group.netsuiteInternalId);
  }

  // ============================================================
  // STEP 6 — CHECK netsuite_so_pushes for prior success (#145 case)
  // ============================================================
  const [priorSuccess] = await db
    .select()
    .from(netsuiteSoPushes)
    .where(
      and(
        eq(netsuiteSoPushes.quoteId, quoteId),
        eq(netsuiteSoPushes.acceptedTierId, quote.acceptedTierId),
        eq(netsuiteSoPushes.status, "succeeded"),
      ),
    )
    .orderBy(desc(netsuiteSoPushes.createdAt))
    .limit(1);

  const [firm] = await db
    .select()
    .from(firmSettings)
    .where(isNull(firmSettings.effectiveUntil))
    .orderBy(desc(firmSettings.effectiveFrom))
    .limit(1);
  if (!firm) {
    throw new Error(
      "No active firm_settings row; cannot resolve subsidiary/tax defaults.",
    );
  }

  let salesOrderInternalId: string;
  let salesOrderTranid: string | null;
  let amountPushed: number;
  let retryOutcome: MarkCompleteResult["retryOutcome"];

  if (priorSuccess) {
    // Convergence path — retry sees prior success, skips SO create,
    // jumps to freeze-tx with the stored so_id.
    salesOrderInternalId = priorSuccess.netsuiteSoId!;
    salesOrderTranid = priorSuccess.netsuiteSoTranid;
    amountPushed = Number(priorSuccess.amountPushed);
    retryOutcome = "converged_from_prior_success";
  } else {
    // ============================================================
    // STEP 7 — Build SO payload + REST POST create
    // ============================================================
    // Build per-line SO items: one line per assembly, referencing the
    // Item Group internal id + tier qty + tier revenue-per-unit.
    // Assemblies map to top-level skuRollups (NEW model — assemblies
    // ARE the top-level SKUs); per-tier rollup lives on
    // skuRollup.perTier.
    const lines: SalesOrderLine[] = tree.assemblies.map((asm) => {
      const skuRollup = bundle.data.costing.skuRollups.find(
        (r) => r.skuId === asm.id,
      );
      const perTierRollup = skuRollup?.perTier.find(
        (pt) => pt.tierId === quote.acceptedTierId,
      );
      const perUnitRevenue =
        perTierRollup?.requiredSellPerUnit ??
        (asm.unitPrice ? Number(asm.unitPrice) : 0);
      const perUnitCost =
        perTierRollup?.contributionCostPerUnit ??
        (asm.unitCost ? Number(asm.unitCost) : null);
      return {
        netsuiteItemId: assemblyToGroupInternalId.get(asm.id)!,
        sku: asm.sku,
        description: asm.description || asm.name || asm.sku,
        quantity: tierRow.qty ?? 0,
        rate: Number(perUnitRevenue),
        unitCost: perUnitCost !== null ? Number(perUnitCost) : null,
      };
    });

    const payload = buildSalesOrderPayload({
      netsuiteCustomerId: customer.netsuiteCustomerId,
      subsidiaryId: firm.netsuiteSubsidiaryId,
      orderStatusCode: firm.netsuiteSoOrderStatusCode,
      taxCodeId: firm.netsuiteDefaultTaxCodeId,
      paymentTermsText: quote.paymentTermsSnapshot,
      hubspotDealId: projectRow.hubspotDealId,
      hubspotDealName: dealCache.dealName,
      dealFolderUrl: dealCache.dealFolderUrl,
      projectServiceS: dealCache.projectServiceS,
      projectCategory: dealCache.projectCategory,
      sourcingLocation: dealCache.sourcingLocation,
      businessSegmentId: dealCache.businessSegmentId,
      businessSegmentLabel: resolvedBusinessSegmentLabel,
      clientPo: dealCache.clientPo,
      invoiceDateEst: dealCache.invoiceDateEst,
      productionShipDateEst: dealCache.productionShipDateEst,
      priority: dealCache.priority,
      dealType: dealCache.dealType,
      lines,
    });

    const idempotencyKey = computeIdempotencyKey(
      quoteId,
      quote.acceptedTierId,
      payload,
    );

    // ---- Write pending row BEFORE POST so retries see it ----
    // (belt over the idempotency-key header). Failures on this
    // write are non-fatal — we proceed to POST regardless; the
    // header still deduplicates.
    let pendingId: string | null = null;
    try {
      const [pending] = await db
        .insert(netsuiteSoPushes)
        .values({
          quoteId,
          acceptedTierId: quote.acceptedTierId,
          status: "pending",
          idempotencyKey,
          amountPushed: String(currentAmount),
          payloadSnapshot: payload,
          startedByUserId: actorUserId,
        })
        .returning({ id: netsuiteSoPushes.id });
      pendingId = pending.id;
    } catch {
      // Non-fatal — POST still proceeds
    }

    let created;
    try {
      created = await createSalesOrder(payload, { idempotencyKey });
    } catch (e) {
      // NS create failed. Update the pending row (if we managed to
      // write it) to failed status with error detail. Then throw.
      const err = e instanceof NetsuiteError ? e : null;
      if (pendingId) {
        try {
          await db
            .update(netsuiteSoPushes)
            .set({
              status: "failed",
              errorClass: err?.className ?? "unknown",
              errorDetail: err?.context.detail ?? String(e),
              completedAt: new Date(),
            })
            .where(eq(netsuiteSoPushes.id, pendingId));
        } catch {
          // secondary write failed — original throw is the real error
        }
      }
      throw e;
    }

    salesOrderInternalId = created.internalId;
    salesOrderTranid = null; // caller can fetch tranId separately if needed
    amountPushed = currentAmount;
    retryOutcome = "fresh";

    // ============================================================
    // STEP 8 — PERSIST netsuite_so_pushes row (succeeded)
    // ============================================================
    if (pendingId) {
      await db
        .update(netsuiteSoPushes)
        .set({
          status: "succeeded",
          netsuiteSoId: salesOrderInternalId,
          netsuiteSoTranid: salesOrderTranid,
          completedAt: new Date(),
        })
        .where(eq(netsuiteSoPushes.id, pendingId));
    } else {
      // Original pending write failed; insert a fresh success row.
      await db.insert(netsuiteSoPushes).values({
        quoteId,
        acceptedTierId: quote.acceptedTierId,
        status: "succeeded",
        idempotencyKey,
        netsuiteSoId: salesOrderInternalId,
        netsuiteSoTranid: salesOrderTranid,
        amountPushed: String(currentAmount),
        payloadSnapshot: payload,
        startedByUserId: actorUserId,
        completedAt: new Date(),
      });
    }
  }

  // ============================================================
  // STEP 9 — DB tx: freeze + status='complete' + audit
  // ============================================================
  const completedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(quotesTable)
      .set({
        status: "complete",
        netsuiteSoId: salesOrderInternalId,
        netsuiteSoTranid: salesOrderTranid,
        netsuitePushedAt: completedAt,
        netsuiteSoPushStatus: "succeeded",
        netsuiteSoPushError: null,
        updatedAt: completedAt,
      })
      .where(eq(quotesTable.id, quoteId));

    await tx.insert(auditLog).values({
      userId: actorUserId,
      entityType: "quote",
      entityId: quoteId,
      action: "netsuite_so_pushed",
      diffJson: {
        from_status: "accepted",
        to_status: "complete",
        accepted_tier_id: quote.acceptedTierId,
        accepted_tier_label: tierRow.label,
        amount_pushed: currentAmount,
        retry_outcome: retryOutcome,
        netsuite: {
          sales_order_internal_id: salesOrderInternalId,
          sales_order_tranid: salesOrderTranid,
          customer_netsuite_id: customer.netsuiteCustomerId,
          item_groups: itemGroupOutcomes,
        },
      },
    });
  });

  // ============================================================
  // STEP 10 — Post-tx conditional HubSpot amount patch
  //          (per §7.2 as amended — never blocks complete)
  // ============================================================
  // Wired in a follow-up commit; for now, compare-only + record
  // intent in the return value.
  const priorAcceptAmount = await loadPriorAcceptedAmount(quoteId);
  const amountPatch = deriveAmountPatchIntent({
    priorAmount: priorAcceptAmount,
    currentAmount,
  });

  return {
    completedAt,
    netsuite: {
      salesOrderId: salesOrderInternalId,
      salesOrderTranid,
      amountPushed,
      itemGroups: itemGroupOutcomes,
    },
    amountPatch,
    retryOutcome,
  };
}

// ---------- helpers ----------

async function loadQuoteOrThrow(quoteId: string) {
  const rows = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.id, quoteId))
    .limit(1);
  if (rows.length === 0) {
    throw new Error(`Quote ${quoteId} not found.`);
  }
  return rows[0];
}

async function loadPriorAcceptedAmount(quoteId: string): Promise<number | null> {
  const rows = await db
    .select({ diffJson: auditLog.diffJson })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, "quote"),
        eq(auditLog.entityId, quoteId),
        eq(auditLog.action, "quote_accepted"),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  const dj = rows[0]?.diffJson as Record<string, unknown> | undefined;
  if (!dj) return null;
  const hs = dj.hubspot as { amount?: number } | undefined;
  return typeof hs?.amount === "number" ? hs.amount : null;
}

function deriveAmountPatchIntent(args: {
  priorAmount: number | null;
  currentAmount: number;
}): MarkCompleteResult["amountPatch"] {
  if (args.priorAmount === null) {
    return { status: "skipped", prior: null, current: args.currentAmount, delta: null };
  }
  const delta = args.currentAmount - args.priorAmount;
  if (Math.abs(delta) < 0.01) {
    return { status: "skipped", prior: args.priorAmount, current: args.currentAmount, delta: 0 };
  }
  // Placeholder: 8c-3 follow-up commit wires the actual PATCH call
  // to HubSpot with failure-doesnt-block semantics. For now, surface
  // the intent so smoke can verify the compare.
  return {
    status: "not_wired",
    prior: args.priorAmount,
    current: args.currentAmount,
    delta,
  };
}
