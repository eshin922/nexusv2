import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  quotes as quotesTable,
  quoteTiers,
  quoteSnapshots,
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
import { formatResolutionErrors, type ResolveResult } from "./item-resolver";
import { findOrCreateItemGroup } from "./item-groups";
import {
  buildSalesOrderPayload,
  computeIdempotencyKey,
  type SalesOrderLine,
} from "./sales-orders";
import { NetsuiteError } from "./errors";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { requireResolvedQuoteCosts } from "@/lib/quote-cost-completeness";

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
    // 'skipped'  — no prior amount, or delta below $0.01 tolerance
    // 'patched'  — HubSpot update succeeded
    // 'failed'   — HubSpot update threw; logged but complete NOT blocked
    status: "skipped" | "patched" | "failed";
    prior: number | null;
    current: number;
    delta: number | null;
    errorDetail?: string;
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
  const { netsuite } = await getApplicationDependencies();

  // ============================================================
  // STEP 1 — Load state + guards
  // ============================================================
  const quote = await loadQuoteOrThrow(quoteId);
  if (quote.status !== "accepted") {
    throw new Error(
      `markComplete only fires on 'accepted' quotes; current state: '${quote.status}'.`,
    );
  }

  // Choice / commitment split per R9 §6 LOAD-BEARING #1:
  //   customer_accepted_tier_id — the tier the customer NAMED at
  //     acceptance (captured by markAccepted).
  //   accepted_tier_id          — the tier the PM COMMITTED to at
  //     the lock. NULL pre-send in v1 (no separate commit UI).
  //     Populated INSIDE this tx's freeze step so post-send both
  //     columns carry the committed tier.
  //
  // Effective read: PM override wins (accepted_tier_id set) →
  // fall back to customer choice. v1 no-override path always
  // falls back; v1.1+ override affordance will pre-write
  // accepted_tier_id and this precedence picks it up.
  const effectiveAcceptedTierId =
    quote.acceptedTierId ?? quote.customerAcceptedTierId;
  if (!effectiveAcceptedTierId) {
    throw new Error(
      "Quote is accepted but has neither customer_accepted_tier_id nor accepted_tier_id set — cannot proceed.",
    );
  }

  const [tierRow] = await db
    .select({
      id: quoteTiers.id,
      label: quoteTiers.label,
      qty: quoteTiers.qty,
    })
    .from(quoteTiers)
    .where(and(eq(quoteTiers.id, effectiveAcceptedTierId), eq(quoteTiers.quoteId, quoteId)))
    .limit(1);
  if (!tierRow) {
    throw new Error(
      "Accepted tier not found on this quote — data integrity issue.",
    );
  }

  const acceptedSnapshotRows = await db
    .select({ id: quoteSnapshots.id })
    .from(quoteSnapshots)
    .where(
      and(
        eq(quoteSnapshots.quoteId, quoteId),
        isNull(quoteSnapshots.supersededAt),
      ),
    )
    .limit(2);
  if (acceptedSnapshotRows.length !== 1) {
    throw new Error(
      `Accepted Quote must resolve exactly one active sent snapshot; found ${acceptedSnapshotRows.length}.`,
    );
  }
  const acceptedSnapshotId = acceptedSnapshotRows[0].id;

  // Phase 1 defense in depth. Governed customer send already rejects an
  // unresolved cost, so accepted Quotes cannot normally reach this state.
  // Keep the guard before costing and every NetSuite resolution/write for
  // protection against out-of-band lifecycle mutation.
  await requireResolvedQuoteCosts(quoteId);

  const bundle = await getCostingBundle(quoteId);
  if (!bundle.ok) {
    throw new Error(`Costing bundle error: ${bundle.error.message}`);
  }

  const tierRollup = bundle.data.costing.quoteRollup.find(
    (r) => r.tierId === effectiveAcceptedTierId,
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

  // Slice 12 Step 9 CB round-1 finding — round at the boundary.
  // tierRollup.totalRevenue carries IEEE 754 residue in the general
  // case; every downstream consumer of currentAmount is a boundary
  // (HubSpot §7.2 patch, netsuite_so_pushes.amount_pushed audit
  // column, audit_log's diff_json.amount_pushed, MarkCompleteResult
  // return value). Rounding once at the source keeps them all in
  // agreement + prevents float residue from crossing any external
  // wire. NetSuite line rates use parseFloat(rate.toFixed(4))
  // separately at build-sales-order-payload — same discipline,
  // different precision for the line-level fields.
  const currentAmount = Number(tierRollup.totalRevenue.toFixed(2));

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
      `HubSpot deal ${projectRow.hubspotDealId} has no cached row or associated company. Governed HubSpot lineage is required before completion.`,
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
    resolutionResults.push(await netsuite.resolveItem(sku));
  }
  const resolutionError = formatResolutionErrors(resolutionResults);
  if (resolutionError) throw new Error(resolutionError);
  // Build a sku → resolved id map from the "found" results.
  const nsIdBySku = new Map<string, string>();
  for (const r of resolutionResults) {
    if (r.status === "found") nsIdBySku.set(r.sku, r.netsuiteItemId);
  }

  // ============================================================
  // STEP 4 — Resolve list-typed enum fields (block on fetch fail)
  // ============================================================
  // Two NS list fields need label / id translation before payload
  // build. Fail-closed per CA (2026-07-28 Q6 + 2026-07-29 parity fix):
  // never send a raw label to a list field; NS rejects the whole SO
  // with USER_ERROR "Invalid Field Value X for the following field: Y".
  //
  //   1. business_segment — HubSpot returns the enum ID; NS accepts
  //      the same numeric id in both `class` and `cseg_dps_bus_seg`.
  //      Resolver's job is fetching the LABEL for backfill display.
  //   2. project_source — HubSpot returns the LABEL ("Domestic"); NS
  //      wants the internal id from `customlist_dps_project_source`.
  //      Resolver's job is the reverse — label→id at push time.
  let resolvedBusinessSegmentLabel: string | null = null;
  if (dealCache.businessSegmentId) {
    resolvedBusinessSegmentLabel = await netsuite.resolveBusinessSegment(
      dealCache.businessSegmentId,
      { dealIdForBackfill: projectRow.hubspotDealId },
    );
  }

  let resolvedProjectSourceId: string | null = null;
  if (dealCache.sourcingLocation) {
    resolvedProjectSourceId = await netsuite.resolveProjectSource(
      dealCache.sourcingLocation,
    );
  }

  // ============================================================
  // STEP 5 — Item Group find-or-create — DELIBERATELY NOT INVOKED
  // ============================================================
  //
  // Per CA disposition 2026-07-28 after exhaustive REST + SOAP probe:
  // NetSuite's SO validator refuses Item Group lines at CREATE via
  // BOTH REST and SOAP (identical USER_ERROR "Please enter a value
  // for Amount"). The UI's `record.create` uses SuiteScript's N/record
  // with different interactive-save semantics — that's why Aisha's
  // manual flow works and the API path is closed.
  //
  // ⚠️ THIS IS CUSTOMER-VISIBLE — NOT COSMETIC.
  //   The Item Group is what makes the customer's invoice show a
  //   single turnkey line ($X per unit) instead of the freight,
  //   customs, and setup components separately. INV2978 (Aisha's
  //   canonical example): two grouped lines at $2.218 and $2.419
  //   with freight/customs invisible — the group doing its job.
  //   Flat lines from Nexus would expose those components on any
  //   customer-facing document.
  //   → Aisha's wrap step remains MANDATORY for anything invoiced.
  //     Nexus emits correct prices; Aisha wraps in the NS UI post-
  //     push before invoice generation.
  //
  // The `findOrCreateItemGroup` code + composition_hash + Nexus's
  // `netsuite_item_groups` table stay live in the codebase. 8c-1's
  // sandbox smoke (`npm run smoke:netsuite-item-groups`) exercises
  // the find-or-create path end-to-end against real NetSuite;
  // preserving that smoke prevents silent rot before Assembly
  // migration (v1.1+ candidate) OR a RESTlet integration (if we
  // ever choose that path) picks the primitives back up.
  //
  // See UX_BACKLOG entry "NetSuite Assembly migration (v1.1+)" for
  // the strategic direction — Assemblies (proven via Probe 4 to work
  // cleanly at REST) are the durable answer to the "grouped items on
  // SO" problem; DPS already has 9 in the catalog, so this is
  // expansion not greenfield.
  //
  // /* const itemGroupOutcomes … */  // ← intentionally not built
  const itemGroupOutcomes: MarkCompleteResult["netsuite"]["itemGroups"] = [];

  // ============================================================
  // STEP 6 — CHECK netsuite_so_pushes for prior success (#145 case)
  // ============================================================
  const [priorSuccess] = await db
    .select()
    .from(netsuiteSoPushes)
    .where(
      and(
        eq(netsuiteSoPushes.quoteId, quoteId),
        eq(netsuiteSoPushes.quoteSnapshotId, acceptedSnapshotId),
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
  // Slice 12 Step 10 Q15 — tranid_fetch_outcome tracks the four
  // possible states of the post-create GET on tranid:
  //   'succeeded'          — fresh create fetch returned a tranid
  //   'failed'             — fresh create fetch returned null (network,
  //                          parse, or missing field); non-blocking per
  //                          Amendment A pattern
  //   'skipped_on_retry'   — retry-convergence path; prior success
  //                          already had a tranid stored, no re-fetch
  //   'backfilled_on_retry' — retry-convergence path; prior success
  //                          had NULL tranid (earlier failed fetch);
  //                          this retry filled it via a fresh GET
  let tranidFetchOutcome:
    | "succeeded"
    | "failed"
    | "skipped_on_retry"
    | "backfilled_on_retry";

  if (priorSuccess) {
    // Convergence path — retry sees prior success, skips SO create,
    // jumps to freeze-tx with the stored so_id.
    salesOrderInternalId = priorSuccess.netsuiteSoId!;
    salesOrderTranid = priorSuccess.netsuiteSoTranid;
    amountPushed = Number(priorSuccess.amountPushed);
    retryOutcome = "converged_from_prior_success";

    // Q15 backfill opportunity — if prior success stored NULL tranid
    // (earlier failed fetch or pre-Q15 code path that never fetched),
    // try the fetch now. Cheap: one GET against a known internal id.
    // Failure keeps NULL and stays non-blocking; success self-heals
    // the historical gap.
    if (salesOrderTranid === null) {
      const backfilled = await netsuite.fetchSalesOrderTranid(
        salesOrderInternalId,
      );
      if (backfilled !== null) {
        salesOrderTranid = backfilled;
        tranidFetchOutcome = "backfilled_on_retry";
      } else {
        tranidFetchOutcome = "failed";
      }
    } else {
      tranidFetchOutcome = "skipped_on_retry";
    }
  } else {
    // ============================================================
    // STEP 7 — Build SO payload + REST POST create
    // ============================================================
    // Build per-line SO items: one line per assembly, referencing the
    // Item Group internal id + tier qty + tier revenue-per-unit.
    // Assemblies map to top-level skuRollups (NEW model — assemblies
    // FLAT LINES per leaf — one SO line per leaf assembly-membership.
    //
    // Nexus's assemblies (parent SKUs like "SMOKE-MC-…-0") don't
    // exist as NetSuite items; only LEAVES resolve to NS items via
    // SKU-match. So the SO cannot reference an assembly directly —
    // each leaf becomes its own SO line at its per-tier rate.
    //
    // Rate + quantity source (SkuPerTierRollup on the leaf's
    // skuRollup entry):
    //   • quantity = tier.qty × leaf.qtyPerParent
    //     (member count × tier order size — the "effective units"
    //     for this leaf at this tier)
    //   • rate     = leaf.perTier.requiredSellPerUnit
    //     (the per-effective-unit sell price the math layer computes;
    //     multiplied by qty = leaf's revenue contribution to the
    //     assembly's tier total)
    // Sum of all leaf-line amounts = tier's totalRevenue by
    // construction, so accountingly the SO balances to Nexus's math.
    const tierId = effectiveAcceptedTierId;
    const leafRollups = bundle.data.costing.skuRollups.filter(
      (r) => r.skuRole === "leaf",
    );
    const lines: SalesOrderLine[] = [];
    for (const leafRollup of leafRollups) {
      // Locate the leaf's tree entry to get its SKU + name.
      const treeLeaf = tree.assemblies
        .flatMap((a) => a.children.map((c) => ({ assembly: a, child: c })))
        .find(({ child }) => child.junctionId === leafRollup.skuId);
      if (!treeLeaf?.child.sku) continue; // no SKU → skipped upstream by resolver
      const nsId = nsIdBySku.get(treeLeaf.child.sku);
      if (!nsId) continue;

      const perTierRollup = leafRollup.perTier.find((pt) => pt.tierId === tierId);
      if (!perTierRollup) continue;

      // Effective qty for this leaf at this tier:
      // tier.qty × qtyPerParent (leaves have qtyPerParent per math layer).
      const qtyPerParent = Math.max(1, Math.round(leafRollup.qtyPerParent ?? 1));
      const effectiveQty = (tierRow.qty ?? 0) * qtyPerParent;

      lines.push({
        netsuiteItemId: nsId,
        sku: treeLeaf.child.sku,
        description:
          treeLeaf.child.name ||
          `${treeLeaf.assembly.name} — ${treeLeaf.child.sku}`,
        quantity: effectiveQty,
        rate: Number(perTierRollup.requiredSellPerUnit),
        unitCost:
          perTierRollup.contributionCostPerUnit != null
            ? Number(perTierRollup.contributionCostPerUnit)
            : null,
      });
    }

    if (lines.length === 0) {
      throw new Error(
        "No SO lines built — every leaf failed to resolve or had no per-tier rollup. Cannot push.",
      );
    }

    const builtPayload = buildSalesOrderPayload({
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
      projectSourceId: resolvedProjectSourceId,
      businessSegmentId: dealCache.businessSegmentId,
      businessSegmentLabel: resolvedBusinessSegmentLabel,
      clientPo: dealCache.clientPo,
      invoiceDateEst: dealCache.invoiceDateEst,
      productionShipDateEst: dealCache.productionShipDateEst,
      priority: dealCache.priority,
      dealType: dealCache.dealType,
      lines,
    });

    let [durableAttempt] = await db
      .select({
        id: netsuiteSoPushes.id,
        payloadSnapshot: netsuiteSoPushes.payloadSnapshot,
      })
      .from(netsuiteSoPushes)
      .where(
        and(
          eq(netsuiteSoPushes.quoteId, quoteId),
          eq(netsuiteSoPushes.quoteSnapshotId, acceptedSnapshotId),
          sql`${netsuiteSoPushes.payloadSnapshot} IS NOT NULL`,
        ),
      )
      .orderBy(asc(netsuiteSoPushes.createdAt))
      .limit(1);
    let payload = (durableAttempt?.payloadSnapshot ?? builtPayload) as Record<string, unknown>;
    const idempotencyKey = computeIdempotencyKey(quoteId, acceptedSnapshotId);

    // The snapshot-keyed attempt and first payload must be durable before
    // POST. A concurrent loser reloads and replays the winner's payload.
    let pendingId: string;
    if (durableAttempt) {
      pendingId = durableAttempt.id;
      await db
        .update(netsuiteSoPushes)
        .set({ status: "pending", errorClass: null, errorDetail: null })
        .where(eq(netsuiteSoPushes.id, pendingId));
    } else {
      try {
        const [pending] = await db
          .insert(netsuiteSoPushes)
          .values({
            quoteId,
            acceptedTierId: effectiveAcceptedTierId,
            quoteSnapshotId: acceptedSnapshotId,
            status: "pending",
            idempotencyKey,
            amountPushed: String(currentAmount),
            payloadSnapshot: payload,
            startedByUserId: actorUserId,
          })
          .returning({ id: netsuiteSoPushes.id });
        pendingId = pending.id;
      } catch {
        [durableAttempt] = await db
          .select({
            id: netsuiteSoPushes.id,
            payloadSnapshot: netsuiteSoPushes.payloadSnapshot,
          })
          .from(netsuiteSoPushes)
          .where(eq(netsuiteSoPushes.quoteSnapshotId, acceptedSnapshotId))
          .limit(1);
        if (!durableAttempt?.payloadSnapshot) {
          throw new Error(
            "Could not establish the durable Sales Order send identity before NetSuite execution.",
          );
        }
        pendingId = durableAttempt.id;
        payload = durableAttempt.payloadSnapshot as Record<string, unknown>;
      }
    }

    // Debug hook: NETSUITE_DEBUG_PAYLOAD=1 logs the SO body pre-POST.
    // Load-bearing for sandbox smoke reproduction; kept as opt-in gate.
    if (process.env.NETSUITE_DEBUG_PAYLOAD === "1") {
      console.log("[markComplete] SO payload:\n" + JSON.stringify(payload, null, 2));
    }

    let created;
    try {
      created = await netsuite.createSalesOrder(payload, { idempotencyKey });
    } catch (e) {
      // NS create failed. Update the pending row (if we managed to
      // write it) to failed status with error detail. Then throw.
      const err = e instanceof NetsuiteError ? e : null;
      const failedAt = new Date();
      const errClass = err?.className ?? "unknown";
      const errDetail = err?.context.detail ?? String(e);
      if (pendingId) {
        try {
          await db
            .update(netsuiteSoPushes)
            .set({
              status: "failed",
              errorClass: errClass,
              errorDetail: errDetail,
              completedAt: failedAt,
            })
            .where(eq(netsuiteSoPushes.id, pendingId));
        } catch {
          // secondary write failed — original throw is the real error
        }
      }
      // Slice 12 Step 8c-4 — mirror failure state onto the quote row
      // so the /quote page's Sales Order tab reads the failed variant
      // across page reloads without a join to netsuite_so_pushes.
      // Non-fatal — if this write fails, netsuite_so_pushes still
      // carries the row; preflight loader reads either source.
      try {
        await db
          .update(quotesTable)
          .set({
            netsuiteSoPushStatus: "failed",
            netsuiteSoPushError: errDetail,
            updatedAt: failedAt,
          })
          .where(eq(quotesTable.id, quoteId));
      } catch {
        // non-fatal — preflight reads netsuite_so_pushes as fallback
      }
      throw e;
    }

    salesOrderInternalId = created.internalId;
    amountPushed = currentAmount;
    retryOutcome = "fresh";

    // Slice 12 Step 10 Q15 — post-create tranid fetch.
    //
    // NetSuite REST POST /record/v1/salesOrder returns only the
    // Location header (internal id). The human-readable tranId
    // ("SO2697") requires a follow-up GET. This is the fetch that
    // used to be a TODO-as-statement-of-intent
    // (`salesOrderTranid = null; // caller can fetch tranId separately`)
    // — no caller ever picked it up, and every completed quote shipped
    // with NULL tranid despite a real display id existing in NetSuite.
    //
    // Non-blocking per Amendment A pattern (same rule as the amount
    // patch): failure logs + writes NULL, complete never blocks.
    // The SO itself exists; tranid is diagnostic, not
    // correctness-critical. Backfill on next retry-convergence attempt
    // (see priorSuccess branch above).
    const fresh = await netsuite.fetchSalesOrderTranid(salesOrderInternalId);
    if (fresh !== null) {
      salesOrderTranid = fresh;
      tranidFetchOutcome = "succeeded";
    } else {
      salesOrderTranid = null;
      tranidFetchOutcome = "failed";
    }

    // ============================================================
    // STEP 8 — PERSIST netsuite_so_pushes row (succeeded)
    // ============================================================
    //
    // Path 3 sub-case 2 recovery (per CA):
    //   If this attempt's local pendingId is null (in-memory only) but
    //   a prior attempt DID insert a pending row with the same
    //   idempotency_key, UPDATE that row in place rather than inserting
    //   a fresh one. Two motivations:
    //   1. Keeps the netsuite_so_pushes table clean — one row per
    //      (quote, tier) attempt, not one succeeded + N orphaned
    //      pending from prior retries.
    //   2. Robustness: while the partial unique index only enforces
    //      uniqueness on status='succeeded' (so a fresh insert
    //      wouldn't violate against a stale pending), operational
    //      hygiene beats "constraint permits it."
    //
    // Order: (a) update the current-attempt pendingId row if we have
    // one; (b) else look for a matching idempotency_key row and update
    // that; (c) else insert fresh.
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
      // Look for a stale pending row with the same idempotency_key
      // (means a prior attempt's pending insert succeeded but this
      // orchestrator run doesn't remember the id — retry path).
      const [priorPending] = await db
        .select({ id: netsuiteSoPushes.id })
        .from(netsuiteSoPushes)
        .where(
          and(
            eq(netsuiteSoPushes.quoteId, quoteId),
            eq(netsuiteSoPushes.acceptedTierId, effectiveAcceptedTierId),
            eq(netsuiteSoPushes.quoteSnapshotId, acceptedSnapshotId),
            eq(netsuiteSoPushes.idempotencyKey, idempotencyKey),
            eq(netsuiteSoPushes.status, "pending"),
          ),
        )
        .orderBy(desc(netsuiteSoPushes.createdAt))
        .limit(1);

      if (priorPending) {
        await db
          .update(netsuiteSoPushes)
          .set({
            status: "succeeded",
            netsuiteSoId: salesOrderInternalId,
            netsuiteSoTranid: salesOrderTranid,
            completedAt: new Date(),
          })
          .where(eq(netsuiteSoPushes.id, priorPending.id));
      } else {
        // Truly fresh — no prior pending row exists.
        await db.insert(netsuiteSoPushes).values({
          quoteId,
          acceptedTierId: effectiveAcceptedTierId,
          quoteSnapshotId: acceptedSnapshotId,
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
  }

  // ============================================================
  // STEP 9 — DB tx: freeze + status='complete' + audit
  // ============================================================
  // Writes accepted_tier_id INSIDE the tx per R9 §6 LOAD-BEARING #1
  // (choice/commitment split — accepted_tier_id is the commitment
  // record). Pre-send in v1: NULL. Post-send: populated with the
  // effective tier (customer choice unless v1.1+ override wrote a
  // different one pre-send). Also on Pattern 52's freeze list.
  //
  // If a PM override affordance lands v1.1+ and pre-writes
  // accepted_tier_id, this line is idempotent — writing the same
  // value that's already there. Only when accepted_tier_id was NULL
  // (v1 no-override path) does this line actually persist the
  // commitment. Audit row's diff_json carries both the from-state
  // (accepted_tier_id_before) and the to-state so the choice/
  // commitment split — including override divergence — is
  // forensically visible.
  const completedAt = new Date();
  const acceptedTierIdBefore = quote.acceptedTierId ?? null;
  await db.transaction(async (tx) => {
    await tx
      .update(quotesTable)
      .set({
        status: "complete",
        acceptedTierId: effectiveAcceptedTierId,
        netsuiteSoId: salesOrderInternalId,
        netsuiteSoTranid: salesOrderTranid,
        netsuitePushedAt: completedAt,
        netsuiteSoPushStatus: "succeeded",
        netsuiteSoPushError: null,
        updatedAt: completedAt,
      })
      .where(eq(quotesTable.id, quoteId));

    // Slice 12 Step 9 CB Item 2 rename — the transition is
    // accepted → complete. Prior action name `netsuite_so_pushed`
    // named the mechanism (SO push) rather than the state
    // transition, breaking the convention every other lifecycle
    // action follows (quote_sent / quote_accepted / quote_reverted
    // / quote_revised). Mechanism detail stays in diff_json (the
    // netsuite: subtree carries sales_order_internal_id + tranid +
    // customer id + item_groups); the action name records what
    // happened to the quote. Renamed while row count was zero
    // (two orphan smoke rows deleted 2026-07-29).
    //
    // Bank (CLAUDE.md): name audit actions after the transition,
    // not the mechanism — especially when the mechanism is the
    // interesting part. The convention slips at exactly that moment.
    await tx.insert(auditLog).values({
      userId: actorUserId,
      entityType: "quote",
      entityId: quoteId,
      action: "quote_completed",
      diffJson: {
        from_status: "accepted",
        to_status: "complete",
        accepted_tier_id_before: acceptedTierIdBefore,
        accepted_tier_id_after: effectiveAcceptedTierId,
        customer_accepted_tier_id: quote.customerAcceptedTierId,
        accepted_tier_label: tierRow.label,
        override_applied:
          acceptedTierIdBefore !== null &&
          acceptedTierIdBefore !== quote.customerAcceptedTierId,
        amount_pushed: currentAmount,
        retry_outcome: retryOutcome,
        netsuite: {
          sales_order_internal_id: salesOrderInternalId,
          sales_order_tranid: salesOrderTranid,
          // Slice 12 Step 10 Q15 — forensic trail for the post-create
          // tranid fetch outcome. Lets audit queries find completed
          // quotes with NULL tranid but succeeded push_status
          // ("did we hit the fetch failure? or a pre-Q15 legacy?").
          tranid_fetch_outcome: tranidFetchOutcome,
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
  // Fires whenever the current order total differs from the amount
  // last pushed to HubSpot. Compares against the most-recent
  // quote_accepted audit row's diff_json.hubspot.amount (which
  // markAccepted / recordCustomerAcceptance write).
  //
  // Failure semantics per CA Amendment A: patch failure is LOGGED
  // but MUST NOT block complete. Quote status is already 'complete';
  // the amount drift becomes a HubSpot data-quality issue that a
  // future retry / manual patch can fix.
  const priorAcceptAmount = await loadPriorAcceptedAmount(quoteId);
  const amountPatch = await runAmountPatchIfNeeded({
    hubspotDealId: projectRow.hubspotDealId,
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

async function runAmountPatchIfNeeded(args: {
  hubspotDealId: string;
  priorAmount: number | null;
  currentAmount: number;
}): Promise<MarkCompleteResult["amountPatch"]> {
  if (args.priorAmount === null) {
    return { status: "skipped", prior: null, current: args.currentAmount, delta: null };
  }
  const delta = args.currentAmount - args.priorAmount;
  if (Math.abs(delta) < 0.01) {
    return { status: "skipped", prior: args.priorAmount, current: args.currentAmount, delta: 0 };
  }

  // Amount drift → PATCH HubSpot. Failure LOGGED but never thrown —
  // per CA §7.2 amended: patch failure must NEVER block complete.
  // Uses hubspot-write client (HUBSPOT_WRITE_ACCESS_TOKEN).
  //
  // Slice 12 Step 9 CB round-1 finding — round at the push boundary.
  // Internal precision stays as-is (#148 P5); outbound payload rounds
  // to 2dp so IEEE 754 residue like `300.00000000000006` doesn't
  // land on real HubSpot deals. Pairs with hubspot.ts:updateDealStage's
  // matching toFixed(2) on the initial acceptance-time amount write.
  try {
    const { hubspot } = await getApplicationDependencies();
    await hubspot.updateDealAmount(args.hubspotDealId, args.currentAmount);
    return {
      status: "patched",
      prior: args.priorAmount,
      current: args.currentAmount,
      delta,
    };
  } catch (e) {
    const errorDetail = e instanceof Error ? e.message : String(e);
    console.error(
      `[markComplete] HubSpot amount patch failed for deal ${args.hubspotDealId}: ${errorDetail}. Quote is complete; amount drift remains in HubSpot until manual patch.`,
    );
    return {
      status: "failed",
      prior: args.priorAmount,
      current: args.currentAmount,
      delta,
      errorDetail,
    };
  }
}
