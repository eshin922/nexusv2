import { orderPacketUrl } from "@/lib/order-packet/url";
import { POSTED_RATE_SCALE } from "@/lib/commercial-rate";
import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  evaluateBelowFloorAuthorization,
  fingerprintCommercialState,
} from "@/lib/below-floor-authorization";
import {
  belowFloorAuthorizations,
  quotes as quotesTable,
  quoteTiers,
  quoteSnapshots,
  projects,
  firmSettings,
  hubspotDealsCache,
  netsuiteSoPushes,
  auditLog,
  assemblyProductionInputs,
} from "@/db/schema";
import { writeAuditEntry, writeAuditEntryReturningId } from "@/lib/audit";
import { isHubspotAcceptSyncSuppressed } from "@/lib/config/certification-mode";
import { getCostingBundle } from "@/app/actions/costing";
import {
  loadAssemblyTree,
  type AssemblyNode,
  type DirectProductNode,
} from "@/lib/assembly-tree";
import {
  resolveNetsuiteCustomer,
  formatCustomerMissingError,
} from "./customer-map";
import { formatResolutionErrors, type ResolveResult } from "./item-resolver";
import {
  findOrCreateItemGroup,
  readItemGroupMembers,
  readSalesOrderHeader,
  readSalesOrderLines,
} from "./item-groups";
import { runRateConvergence } from "./rate-convergence";
import { patchSalesOrderLine } from "./client";
import { enforceNonTaxableLines } from "./tax-policy";
import { reconcileBeforeCreate } from "./create-reconciliation";
import {
  adaptPlannedGroup,
  assertIdentityMatchesPlan,
  verifyReusedGroupMembership,
} from "./grouping-plan-adapter";
import {
  awaitingRatesOperatorMessage,
  mustNotCreate,
  recordAttemptFailure,
  recordNeedsReconciliation,
  recordSalesOrderCreated,
} from "./attempt-lifecycle";
import {
  buildSalesOrderPayload,
  computeIdempotencyKey,
  type SalesOrderLine,
} from "./sales-orders";
import {
  attachGroupingPlan,
  buildGroupingPlan,
  stripGroupingPlan,
  type PlanLineInput,
} from "./grouping-plan";
import type { DirectServiceIdentity } from "@/lib/product-structure/direct-service";
import { NetsuiteError } from "./errors";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { requireResolvedQuoteCosts } from "@/lib/quote-cost-completeness";
import {
  planCostProjection,
  projectGovernedCosts,
  type CostProjectionOutcome,
} from "./cost-projection";
// ── F1/F4 · the frozen accepted column as commercial authority ────────────
import { buildFrozenSalesOrder } from "./frozen-sales-order";
import type { FrozenSalesOrderLine } from "./frozen-sales-order";
import { checkStructureAgreement } from "./frozen-order-assembly";
import type { LiveStructureMember } from "./frozen-order-assembly";
import { checkPostGroupingReg4 } from "./reg4-post-grouping";
import type {
  PostGroupingFlatLine,
  PostGroupingGroup,
} from "./reg4-post-grouping";
import { recordPostingProvenance } from "./posting-provenance";
import { decimalFromCents } from "./frozen-cents";
import { describeBlockers } from "./projection-readiness";
import { OTC_COLUMN_DESTINATION } from "./bv011-destinations";
import type { OtcColumn } from "./bv011-destinations";

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
    // Track B §4 — detail_level comes from the ACCEPTED SNAPSHOT, not the live
    // quotes column: the applicability datum must be the value that was true
    // when the customer agreed, per the OD-004 disposition.
    .select({ id: quoteSnapshots.id, detailLevel: quoteSnapshots.detailLevel })
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
  const acceptedDetailLevel = acceptedSnapshotRows[0].detailLevel;

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
    // TRACK A · BV-005 1c. Completion has its OWN gate, independently of
    // acceptance — the accepted tier may differ from the customer-accepted one
    // under PM override paths, and a state that drifted between accepting and
    // completing must be caught here rather than assumed settled upstream.
    //
    // Independence is measured against the actor COMPLETING, for the same
    // reason it is measured against the actor accepting: whoever commits the
    // below-floor outcome may not be the person who authorized it. No fallback.
    const authorizations = await db
      .select({
        id: belowFloorAuthorizations.id,
        quoteVersionNumber: belowFloorAuthorizations.quoteVersionNumber,
        tierId: belowFloorAuthorizations.tierId,
        approvedByUserId: belowFloorAuthorizations.approvedByUserId,
        stateFingerprint: belowFloorAuthorizations.stateFingerprint,
        invalidatedAt: belowFloorAuthorizations.invalidatedAt,
      })
      .from(belowFloorAuthorizations)
      .where(eq(belowFloorAuthorizations.quoteId, quote.id));

    const verdict = evaluateBelowFloorAuthorization({
      authorizations,
      scope: { quoteVersionNumber: quote.versionNumber, tierId: tierRollup.tierId },
      currentFingerprint: fingerprintCommercialState({
        totalRevenue: tierRollup.totalRevenue,
        totalCost: tierRollup.totalCost,
        blendedMarginPct: tierRollup.blendedMarginPct,
      }),
      actingUserId: actorUserId,
    });

    if (!verdict.ok) {
      throw new Error(
        `Blocked — the accepted tier (${tierRollup.label}) is below the firm's margin floor. ${verdict.message}`,
      );
    }
  }
  // Same reasoning as markAccepted's companion guard: an unpriced tier was
  // previously caught by the floor check via a fabricated 0% margin. It stays
  // blocked on its own grounds rather than being released by a correctness fix.
  if (tierRollup.blendedMarginStatus === "COST_WITHOUT_REVENUE") {
    throw new Error(
      `Blocked — the accepted tier (${tierRollup.label}) carries cost with no revenue against it. Completing books a certain loss. Cannot advance to complete.`,
    );
  }
  if (tierRollup.blendedMarginStatus === "UNAVAILABLE") {
    throw new Error(
      `Blocked — the accepted tier (${tierRollup.label}) has no revenue, so its margin cannot be assessed. Cannot advance to complete.`,
    );
  }

  // ── THE ORDER AMOUNT IS NO LONGER COMPUTED HERE ────────────────────────
  //
  // It used to be `Number(tierRollup.totalRevenue.toFixed(2))` — the LIVE
  // costing rollup, recomputed at push time and therefore reproducing the
  // accepted quote only for as long as draft-lock happened to hold every input
  // still. That is a convention, and a convention is not an authority.
  //
  // `currentAmount` is now the frozen accepted tier's commercial total, taken
  // at STEP 3.5 once the frozen order has been built and proved. It is
  // declared here so its downstream consumers keep their existing positions:
  // the HubSpot §7.2 patch, `netsuite_so_pushes.amount_pushed`, the audit
  // row's `diff_json.amount_pushed`, the convergence gate's `acceptedTotal`,
  // and the returned result. All of them now read one governed figure.
  //
  // The rounding note that stood here is obsolete rather than relocated: a
  // frozen total is `numeric(14,2)`, so there is no IEEE residue to round off
  // at the boundary. It is converted through integer cents, not through
  // `toFixed`.
  let currentAmount: number;

  // `tierRollup` survives above for what it is still permitted to say — the
  // margin verdicts guarding this push, and the per-unit cost basis. It no
  // longer contributes a single commercial figure to the Sales Order.

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
  // A quote is pushable if it carries ANY product. Requiring an assembly was
  // the structural assumption that made a Direct Product unshippable — the
  // quote had products, just not grouped ones.
  if (!tree || (tree.assemblies.length === 0 && tree.directProducts.length === 0)) {
    throw new Error("Quote has no products to push.");
  }

  // MIXED STRUCTURE — certified 2026-08-13, refusal removed.
  //
  // A quote may hold both Direct Products and Item Groups. P1 (SO2713,
  // disposable, deleted) measured one CREATE carrying a group line plus a flat
  // line for an item in no group: five lines, group header once, each member
  // expanded once at the sent quantity, EndGroup, flat line once. No
  // duplication, no quantity multiplication.
  //
  // The refusal that stood here claimed only "not yet certified", which was the
  // honest claim available at the time — Probe 7a concerned members sent
  // alongside THEIR OWN group, a different payload that proved nothing about
  // this one. P1 is the evidence the refusal named as missing, so it is gone
  // rather than weakened.
  //
  // What replaces it is a narrower, permanent guard one layer down:
  // `buildSalesOrderPayload` refuses a flat line for an item an emitted group
  // already expands. That is the condition Probe 7a actually established, and
  // it remains true.

  // ── DIRECT SERVICES ARE NOT SKU-RESOLVED, AND NOW DO PROJECT ────────────
  //
  // `tree.directProducts` holds every top-level row, and since Stage 2 that
  // includes Direct Services. Two things follow.
  //
  // 1. A service must NEVER enter the SKU-match loop. Its `SVC-*` SKU is a
  //    Nexus-invented identifier that nothing put in NetSuite, so the match
  //    would normally find nothing — and the danger is the case where it finds
  //    SOMETHING, an unrelated item an admin happened to create with that
  //    code. A wrong item on a Sales Order is worse than a blocked push.
  //    Services are partitioned out by their `commercialKind`, never by
  //    inspecting the SKU string. Unchanged, and permanent.
  //
  // 2. The blanket projection refusal that stood here is REMOVED (F1/F4).
  //    Before Stage 2 a service quote was blocked BY ACCIDENT — its
  //    unresolvable SKU threw — and Stage 2 made that accident deliberate so
  //    that supplying a mapping could not silently remove it (Pattern 56). It
  //    stood for "projecting a service onto a Sales Order is not certified",
  //    and that is what has now been built:
  //
  //      · the line's economics come from the frozen accepted column, through
  //        `assessProjectionReadiness` and the quantity-1 accounting emitter;
  //      · its item comes from its governed BV-011 destination, resolved once,
  //        in one place;
  //      · the COMPLETE emitted order — products, services and fees — must
  //        reconcile to the frozen tier total exactly, twice: before the
  //        payload is built, and again against the expansion NetSuite will
  //        calculate, immediately before the POST.
  //
  //    So a service can no longer be emitted at "whatever quantity and rate
  //    that path computes": there is no such path left for it to fall into.
  //    The quantity is 1 and the amount is frozen.
  //
  // What SURVIVES here is the mapping-usability check, which is not redundant
  // with readiness. Readiness refuses an unmapped destination by the ABSENCE of
  // a mapping row; this asks NetSuite whether the mapped item still exists and
  // is active, so a mapping that rotted after it was entered is caught before
  // the CREATE rather than by NetSuite rejecting it.
  const directServices = tree.directProducts.filter(
    (p) => p.commercialKind === "service",
  );
  const directProductsOnly = tree.directProducts.filter(
    (p) => p.commercialKind !== "service",
  );

  // BV-011 CONSUMER CUTOVER (#317) — the legacy Direct Service gate is GONE.
  //
  // It resolved through `netsuite_service_item_map`, which admin governance and
  // readiness had already left behind for `netsuite_destination_item_map`. Two
  // authorities answering "which item does this service post to" meant a
  // correct, audited destination mapping was invisible to the writer, and the
  // push refused a quote that was in fact fully mapped.
  //
  // `assessProjectionReadiness` already covers every Direct Service line: it
  // derives the destination from the governed identity via
  // SERVICE_IDENTITY_DESTINATION when the frozen row predates the column,
  // blocks with `unmapped_destination` when that destination has no row, and
  // resolves `netsuiteItemId` from the destination map into the SAME
  // `ResolvedAccountingLine` the emitter posts. Readiness and emission cannot
  // disagree because there is one pass and one answer.
  //
  // Deliberately NO fallback to the legacy map. A fallback would re-create the
  // split this removes, and would let a stale legacy row make a push succeed
  // that the governed authority says is unmapped.

  // Every UNIQUE product SKU on the quote must resolve — grouped members AND
  // Direct Products. A Direct Product resolves through the identical SKU-match;
  // membership has never been part of item resolution.
  const uniqueSkus = Array.from(
    new Set(
      [
        ...tree.assemblies.flatMap((a) => a.children),
        ...directProductsOnly,
      ]
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
  // The sku → item map that used to be built here is gone. Product lines now
  // take their NetSuite item from `buildFrozenSalesOrder`, which resolves each
  // frozen product SKU through `resolveSku` below — the same authority, reading
  // the same results. Keeping a second map alive would leave two answers to
  // "which item is this line", and a line resolved by one and posted by the
  // other is how a REG-4-clean order reaches the wrong item.

  // ============================================================
  // STEP 3.5 — F1/F4 · the frozen accepted column becomes the
  //            commercial authority for this Sales Order
  // ============================================================
  //
  // Everything commercial on the order — quantity, sell rate, line amount,
  // the OTC and Direct Service economics, and the accepted total — now comes
  // from the matrix frozen when the customer was sent the quote they accepted.
  // Nothing here recomputes a price.
  //
  // ── WHAT THIS REPLACES, AND WHY IT WAS NOT ALREADY SAFE ────────────────
  //
  // The order was previously assembled from a LIVE costing bundle fetched at
  // push time. Every figure on it was therefore recomputed AFTER acceptance,
  // and reproduced the accepted quote only because draft-lock stops cost edits
  // and the commercial pin holds the rate. Those are conventions. A convention
  // that has never been violated is indistinguishable from an invariant right
  // up until it is, and there was nothing in the push that could tell the
  // difference (Pattern 56).
  //
  // It also under-billed. No OTC and no Direct Service line was emitted at
  // ALL, so a quote carrying separately billed fees posted an order short by
  // exactly those fees — and the order still reconciled against its own
  // remaining lines, because the total it was checked against was recomputed
  // from the same incomplete set (Pattern 58's "exact reconciliation is
  // necessary but not sufficient").
  //
  // ── THE DIVISION OF AUTHORITY ──────────────────────────────────────────
  //
  //   FROZEN governs WHAT WAS SOLD — quantity, rate, amount, total.
  //   LIVE structure governs only HOW an already-frozen line is GROUPED:
  //     Item Group membership, the group's SKU and name, qty-per-parent.
  //   `unitCost` stays LIVE and stays non-commercial. It feeds
  //     `custcol_dps_unit_cost` / `costEstimateRate`, an Accounting
  //     cost-reporting basis, and never a sell rate, an amount, or REG-4.
  //
  // ── ORDER OF REFUSAL, ALL BEFORE ANY WRITE ─────────────────────────────
  //
  //   1  projection readiness, incl. provisional accepted tier   (here)
  //   2  REG-4 link A — the frozen record agrees with itself     (here)
  //   3  product SKU resolution                                  (here)
  //   4  REG-4 link B — the COMPLETE emitted order sums frozen   (here)
  //   5  live structure agrees with frozen structure             (here)
  //   6  post-grouping REG-4, over what NetSuite will calculate  (STEP 7)
  //
  // Steps 1-5 run before the customer, Item Group or payload work; step 6 runs
  // immediately before the POST, against the grouped representation NetSuite
  // actually expands. No tolerance at any of them, and no rounding repair — a
  // discrepancy refuses.

  // Product SKU resolution reuses the results just obtained rather than issuing
  // a second round of `resolveItem`. Same authority, memoised: a SKU resolved a
  // moment ago cannot resolve differently now, and a frozen SKU absent from the
  // live tree — the one case the loop above does not cover — still reaches the
  // real resolver rather than being reported unresolved for want of a lookup.
  const resolveSkuMemo = new Map<string, ResolveResult>();
  for (const r of resolutionResults) resolveSkuMemo.set(r.sku, r);
  const resolveSku = async (sku: string): Promise<ResolveResult> => {
    const hit = resolveSkuMemo.get(sku);
    if (hit) return hit;
    const fresh = await netsuite.resolveItem(sku);
    resolveSkuMemo.set(sku, fresh);
    return fresh;
  };

  const frozenOrder = await buildFrozenSalesOrder(quoteId, { resolveSku });
  if (!frozenOrder.ok) {
    const reasons = [
      ...describeBlockers(frozenOrder.blockers),
      ...frozenOrder.reg4.map((f) => f.detail),
    ];
    throw new Error(
      "Blocked — this Quote's Sales Order cannot be built from the column the customer " +
        `accepted. ${reasons.join(" ")} Nothing was posted.`,
    );
  }

  // The LIVE structure, indexed by the canonical cost-input identity
  // (`quote_leaves.id` — OD-017/OD-028; never `junctionId`, which lives in a
  // different id space and matched 0/2 the last time a consumer used it).
  //
  // Services are excluded deliberately. A Direct Service is not product
  // structure: it is never an Item Group member, it carries no qty-per-parent,
  // and its economics come from the frozen matrix through the accounting-line
  // emitter. Including one here would make it read as a live product line with
  // no frozen counterpart and refuse a correct order.
  type LiveStructureEntry = LiveStructureMember & {
    assembly: AssemblyNode | null;
    child: DirectProductNode;
  };
  const liveByLeafId = new Map<string, LiveStructureEntry>();
  for (const leafRollup of bundle.data.costing.skuRollups) {
    if (leafRollup.skuRole !== "leaf") continue;

    const treeLeaf =
      tree.assemblies
        .flatMap((a) =>
          a.children
            .filter((c) => c.commercialKind !== "service")
            .map((c) => ({
              assembly: a as AssemblyNode | null,
              child: c as DirectProductNode,
            })),
        )
        .find(({ child }) => child.quoteLeafId === leafRollup.skuId) ??
      directProductsOnly
        .filter((d) => d.quoteLeafId === leafRollup.skuId)
        .map((d) => ({ assembly: null as AssemblyNode | null, child: d }))[0];
    if (!treeLeaf?.child.sku) continue;

    const perTierRollup = leafRollup.perTier.find(
      (pt) => pt.tierId === effectiveAcceptedTierId,
    );
    if (!perTierRollup) continue;

    liveByLeafId.set(leafRollup.skuId, {
      quoteLeafId: leafRollup.skuId,
      sku: treeLeaf.child.sku,
      assemblyId: treeLeaf.assembly?.id ?? null,
      assemblySku: treeLeaf.assembly?.sku ?? null,
      assemblyName: treeLeaf.assembly?.name ?? null,
      // The Item Group DEFINITION multiplier — how many of this leaf ONE group
      // contains, independent of how many groups the tier buys.
      qtyPerParent: Math.max(1, Math.round(leafRollup.qtyPerParent ?? 1)),
      // Reporting basis only. Never reaches a rate, an amount or REG-4.
      unitCost:
        perTierRollup.contributionCostPerUnit != null
          ? Number(perTierRollup.contributionCostPerUnit)
          : null,
      assembly: treeLeaf.assembly,
      child: treeLeaf.child,
    });
  }

  // Both directions, because each hides a different failure: a live product
  // with no frozen line is a line ADDED after acceptance; a frozen product with
  // no live structure is a line silently DROPPED, and the order would still
  // reconcile against whatever remained if the total were recomputed rather
  // than compared to the frozen one. A re-keyed identity appears as one of each.
  const structureDisagreements = checkStructureAgreement({
    frozenLines: frozenOrder.lines,
    liveMembers: [...liveByLeafId.values()],
    tierQty: tierRow.qty ?? 0,
  });
  if (structureDisagreements.length > 0) {
    throw new Error(
      "Blocked — the Quote's current structure no longer agrees with the accepted one. " +
        `${structureDisagreements.map((d) => d.detail).join(" ")} Nothing was posted.`,
    );
  }

  // THE order amount. One governed figure, parsed from the frozen decimal
  // rather than divided out of cents, so every consumer downstream reads the
  // same value the customer accepted.
  currentAmount = Number(decimalFromCents(frozenOrder.totalCents));

  // ── ACCOUNTING COST BASIS · live, governed, non-commercial ──────────────
  //
  // Accounting's Case 0 disposition: send an explicit CUSTOM cost for OTC and
  // Direct Service lines rather than letting NetSuite fall back to the item
  // master's LASTPURCHPRICE or ITEMDEFINED. 98% of the account's existing fee
  // lines carry an explicitly set cost; without this, ours were the 2%.
  //
  // ── NO NEW COST AUTHORITY IS CREATED HERE ──────────────────────────────
  //
  // Both figures already exist and already govern something:
  //
  //   direct_service   `contributionCostPerUnit` — the SAME math-layer field a
  //                    product line already sends. A service is not a special
  //                    case in the projection; it runs the same unit-line
  //                    branch. It is absent from the order today only because
  //                    the cutover set `unitCost: null` on every non-product
  //                    line, which over-reached: excluding services from the
  //                    STRUCTURE index was right for quantity and rate, and
  //                    wrong for cost.
  //
  //   otc              the production fee column the sell price is COMPUTED
  //                    from — `amount = raw × (1 + productionMarkupPct)`. The
  //                    cost is not missing; it is the number the price was
  //                    built on. Read live from `assembly_production_inputs`
  //                    by (assembly, accepted tier), resolved through the
  //                    governed `OTC_COLUMN_DESTINATION` map inverted.
  //
  // A new operator input would have been a SECOND authority for a number that
  // already has one (Pattern 58). It was traced for, and not needed.
  //
  // ── ZERO IS A VALUE; NULL IS AN ABSENCE ────────────────────────────────
  //
  // Accounting settled this explicitly, and against my own initial caution.
  // A governed cost of exactly 0 is a STATEMENT about cost, and suppressing it
  // would substitute NetSuite's item-master guess for a fact Nexus holds. So 0
  // is sent as CUSTOM 0. Only a genuine NULL — no governed cost available —
  // sends nothing and leaves NetSuite's own default intact.
  //
  // ── AND IT IS NOT COMMERCIAL ───────────────────────────────────────────
  //
  // Nothing below reaches a quantity, a sell rate, a line amount, the accepted
  // total, or REG-4. Those come from the frozen column and are already fixed
  // by this point. Proved by perturbation rather than asserted — see
  // `tests/unit/accounting-cost-basis.test.ts`.
  //
  // KNOWN BOUNDARY, recorded per the disposition: cost is read LIVE, so it is
  // not part of the commercial freeze. A cost edited after SEND can move the
  // margin basis shown on the eventual Sales Order while the accepted
  // commercial statement stays exactly as accepted. Draft-lock keeps that
  // window narrow. Historical quote-time cost reproduction is a separate
  // future snapshot capability and is NOT established here.

  // Direct Service cost, keyed by the canonical leaf identity. Deliberately a
  // SEPARATE index from `liveByLeafId`: that one is structure, and a service
  // must never enter it or it could acquire a product line's quantity or rate.
  const serviceCostByLeafId = new Map<string, number | null>();
  for (const rollup of bundle.data.costing.skuRollups) {
    if (rollup.skuRole !== "leaf") continue;
    const perTier = rollup.perTier.find((pt) => pt.tierId === effectiveAcceptedTierId);
    if (!perTier) continue;
    serviceCostByLeafId.set(
      rollup.skuId,
      perTier.contributionCostPerUnit != null
        ? Number(perTier.contributionCostPerUnit)
        : null,
    );
  }

  // OTC cost, keyed by owning assembly, for the accepted tier only. One read of
  // the governed table rather than the bundle's production array, because that
  // array is anchor-leaf coerced (per-assembly values attached to the lowest
  // child) and this needs the per-assembly row it was coerced from.
  const otcCostRows = await db
    .select({
      assemblyId: assemblyProductionInputs.assemblyId,
      setupFeeTotal: assemblyProductionInputs.setupFeeTotal,
      toolingTotal: assemblyProductionInputs.toolingTotal,
      artworkTotal: assemblyProductionInputs.artworkTotal,
      rdTotal: assemblyProductionInputs.rdTotal,
      otherServiceTotal: assemblyProductionInputs.otherServiceTotal,
    })
    .from(assemblyProductionInputs)
    .where(eq(assemblyProductionInputs.tierId, effectiveAcceptedTierId));
  const otcCostByAssembly = new Map(
    otcCostRows.filter((r) => r.assemblyId !== null).map((r) => [r.assemblyId!, r] as const),
  );

  /**
   * The governed live cost for one frozen accounting line, or null when none
   * is available. Never invents, never falls back to a sibling figure.
   */
  function accountingCostFor(line: FrozenSalesOrderLine): number | null {
    if (line.kind === "direct_service") {
      return line.quoteLeafId ? (serviceCostByLeafId.get(line.quoteLeafId) ?? null) : null;
    }
    if (line.kind !== "otc" || line.destination === null) return null;
    // Invert the governed column→destination map. Within `otc` this is
    // injective, so the inversion is total rather than a guess.
    const column = (Object.keys(OTC_COLUMN_DESTINATION) as OtcColumn[]).find(
      (c) => OTC_COLUMN_DESTINATION[c] === line.destination,
    );
    if (!column || !line.owningAssemblyId) return null;
    const row = otcCostByAssembly.get(line.owningAssemblyId);
    const raw = row ? (row as Record<string, string | null>)[column] : null;
    // `numeric` arrives as a string. "0.00" is a value; null is an absence.
    return raw === null || raw === undefined || raw === "" ? null : Number(raw);
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
  //
  //   ┌─ SUPERSEDED 2026-08-11 (Edward, OD-004 business disposition) ─┐
  //   │ This block previously read: "Aisha's wrap step remains         │
  //   │ MANDATORY for anything invoiced."                              │
  //   │                                                                │
  //   │ That is OVERBROAD and is no longer governing authority.        │
  //   │ Grouping FOLLOWS THE QUOTE'S AGREED CUSTOMER PRESENTATION:     │
  //   │                                                                │
  //   │   detail_level = 'itemized'      → do NOT group. The itemized  │
  //   │                                    presentation is what the    │
  //   │                                    customer agreed to; wrapping│
  //   │                                    it would show them an       │
  //   │                                    invoice shaped unlike their │
  //   │                                    quote.                      │
  //   │   detail_level = 'turnkey_only'  → grouping IS required.       │
  //   │                                                                │
  //   │ The axis is `quotes.detail_level`, read from the SEND-TIME     │
  //   │ SNAPSHOT (`detail_level_snapshot`) — the value that was true   │
  //   │ when the customer agreed, not the live column.                 │
  //   │                                                                │
  //   │ Governing record: docs/validation/od-004-decision-set.md.      │
  //   │ Do not restore the universal rule; two live rules is exactly   │
  //   │ what this supersession exists to prevent.                      │
  //   └────────────────────────────────────────────────────────────────┘
  //
  //   Where grouping IS required, Aisha wraps in the NS UI post-push
  //   before invoice generation; Nexus emits correct prices and (once
  //   the grouping plan lands) the deterministic plan she executes.
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

  // Master-data evidence, read back from NetSuite at the boundary and recorded
  // BEFORE the Sales Order exists. These are qtyPerParent quantities — what ONE
  // group contains — never transaction quantities. Kept at this scope so the
  // audit row carries them even when a later stage fails.
  const itemGroupDefinitions: Array<{
    assemblySku: string;
    itemidDisplay: string;
    netsuiteInternalId: string;
    netsuiteExternalId: string;
    outcome: string;
    members: Array<{ netsuiteItemId: string; qtyPerParent: number }>;
  }> = [];

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
  // Initialised null: Step 3's convergence block runs BEFORE the tranid fetch
  // (the SO id is the recovery key; the tranid is diagnostic), so its operator
  // messages must tolerate a not-yet-known display id.
  let salesOrderTranid: string | null = null;
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
  // What the frozen lines' posting provenance write did. `null` on the
  // convergence-from-prior-success path, where a previous invocation already
  // recorded it and this one posts nothing — distinct from `written: 0`, which
  // would say the write ran and found nothing to record.
  let provenanceOutcome: { written: number; error: string | null } | null = null;

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
    // Build per-line SO items by walking the FROZEN accepted order.
    //
    // ── WHAT CHANGED, AND WHAT DID NOT ────────────────────────────────────
    //
    // The iteration used to be over `bundle.data.costing.skuRollups` — the
    // live math layer — taking `quantity = tier.qty × qtyPerParent` and
    // `rate = perTier.requiredSellPerUnit` from it. Both are now read from the
    // frozen accepted column instead; the loop below iterates
    // `frozenOrder.lines`, which STEP 3.5 already proved reconciles to the
    // frozen tier total exactly.
    //
    // The live tree is still consulted, for structure and cost only:
    //   · which Item Group a member belongs to, and that group's identity
    //   · `qtyPerParent`, the group DEFINITION multiplier
    //   · `unitCost`, the Accounting cost-reporting basis
    // Every one of those was proved to agree with the frozen set at STEP 3.5,
    // so `liveByLeafId.get(...)` cannot miss here — the lookup is asserted
    // rather than fallen back on, because a fallback is how a re-keyed
    // identity gets silently absorbed.
    //
    // Nexus's assemblies (parent SKUs like "SMOKE-MC-…-0") still do not exist
    // as NetSuite items; only leaves resolve by SKU-match, so the flat payload
    // remains one line per leaf and the turnkey branch below swaps in the
    // Item Group header lines exactly as before.
    const lines: SalesOrderLine[] = [];
    // The subset of `lines` belonging to Direct Products. Collected in the same
    // pass that builds `lines`, keyed by the attachment's own structure rather
    // than by index alignment or SKU matching — the same product may legitimately
    // be attached directly AND be a member of a group on one quote, so SKU is
    // not an identity here.
    const directLines: SalesOrderLine[] = [];
    // The quantity-1 accounting half: separately billed OTC and Direct Service.
    // Peer to `directLines` — never grouped, never expanded, and never absent,
    // which is the whole of the under-billing defect this closes.
    const accountingLines: SalesOrderLine[] = [];
    // Every frozen line reaching the order, paired with the item it will post
    // to, so the post-grouping REG-4 check and the provenance write both read
    // what was actually sent rather than a second derivation of it.
    const emitted: Array<{
      frozen: FrozenSalesOrderLine;
      soLine: SalesOrderLine;
      /** The Item Group this line will be expanded by, or null if none does. */
      assemblyId: string | null;
      /** How many of this member ONE group contains. 1 for anything ungrouped. */
      qtyPerGroup: number;
    }> = [];
    // Track B §4 — assembly attribution, captured HERE rather than re-derived
    // later. Constraint 3: the plan is built from the same governed state as
    // the outgoing handoff, so the two cannot disagree.
    const planLines: PlanLineInput[] = [];

    for (const frozenLine of frozenOrder.lines) {
      const isProduct =
        frozenLine.kind === "item_group_member" ||
        frozenLine.kind === "direct_product";

      // FROZEN, all three. The rate is rendered at the transmitted precision
      // (`numeric(14,4)`, which is what the payload builder emits) so the
      // number checked by REG-4 is the number NetSuite receives.
      const lineRate = Number(frozenLine.rate);

      if (!isProduct) {
        // OTC and Direct Service. Quantity 1 by construction — the emitter
        // carries the frozen amount as the rate and multiplies by nothing.
        const soLine: SalesOrderLine = {
          netsuiteItemId: frozenLine.netsuiteItemId,
          sku: frozenLine.sku ?? frozenLine.description,
          description: frozenLine.description,
          quantity: frozenLine.quantity,
          rate: lineRate,
          // The governed live cost — see the ACCOUNTING COST BASIS block at
          // STEP 3.5. Zero is sent as a value; only NULL sends nothing.
          unitCost: accountingCostFor(frozenLine),
        };
        accountingLines.push(soLine);
        emitted.push({ frozen: frozenLine, soLine, assemblyId: null, qtyPerGroup: 1 });
        continue;
      }

      // Structure agreement already proved this resolves. Asserted, not
      // defaulted — see the block comment above.
      const live = frozenLine.quoteLeafId
        ? liveByLeafId.get(frozenLine.quoteLeafId)
        : undefined;
      if (!live) {
        throw new Error(
          `[markComplete] frozen line "${frozenLine.description}" passed the structure ` +
            "agreement guard but has no live structure entry. Refusing before CREATE.",
        );
      }

      const soLine: SalesOrderLine = {
        netsuiteItemId: frozenLine.netsuiteItemId,
        sku: live.child.sku as string,
        description:
          live.child.name ||
          (live.assembly
            ? `${live.assembly.name} — ${live.child.sku}`
            : (live.child.sku as string)),
        quantity: frozenLine.quantity,
        rate: lineRate,
        unitCost: live.unitCost,
      };
      lines.push(soLine);
      if (live.assembly === null) directLines.push(soLine);
      emitted.push({
        frozen: frozenLine,
        soLine,
        assemblyId: live.assemblyId,
        qtyPerGroup: live.qtyPerParent,
      });
      planLines.push({
        // NULL for a Direct Product. The plan records it as attributed to no
        // group, which is a positive fact the walk can assert — not an absence.
        assemblyId: live.assemblyId,
        assemblySku: live.assemblySku,
        assemblyName: live.assemblyName,
        sku: live.child.sku as string,
        netsuiteItemId: frozenLine.netsuiteItemId,
        quantity: frozenLine.quantity,
        // The Item Group DEFINITION multiplier — how many of this leaf one
        // group contains, independent of how many groups the tier buys.
        qtyPerParent: live.qtyPerParent,
        rate: lineRate,
        // Same expression as the flat line above, deliberately — one governed
        // source reaching both structures is the invariant this repair exists
        // to hold. Never re-derived from `rate`, the accepted total, freight,
        // duty or tariff.
        unitCost: live.unitCost,
      });
    }

    // The accounting half rides the flat line list. It is never a group member,
    // so it cannot collide with an expanded member (the Probe 7a doubling the
    // payload builder refuses); P1/SO2713 measured a group plus a flat line for
    // an un-grouped item expanding exactly once.
    lines.push(...accountingLines);

    if (lines.length === 0) {
      throw new Error(
        "No SO lines built — the frozen accepted column produced no postable line. Cannot push.",
      );
    }

    // Extracted so the turnkey_only branch can rebuild the SAME header with
    // group lines swapped in — every governed header field stays identical by
    // construction rather than by being re-listed.
    const soPayloadInput = {
      netsuiteCustomerId: customer.netsuiteCustomerId,
      subsidiaryId: firm.netsuiteSubsidiaryId,
      orderStatusCode: firm.netsuiteSoOrderStatusCode,
      // `taxCodeId` removed — every Nexus Sales Order is non-taxable by
      // governed rule, so it is a constant in tax-policy.ts rather than a
      // value this call site (or an admin) can supply. The firm_settings
      // column remains in the schema, now unread.
      paymentTermsText: quote.paymentTermsSnapshot,
      hubspotDealId: projectRow.hubspotDealId,
      hubspotDealName: dealCache.dealName,
      dealFolderUrl: dealCache.dealFolderUrl,
      // ORDER-scoped, alongside the DEAL-scoped SharePoint link above. Both are
      // written; neither replaces the other. Null when no base URL is
      // configured — an empty field is visibly empty, whereas a link to the
      // wrong host is not, and this value outlives the deploy that wrote it.
      orderPacketUrl: orderPacketUrl(
        acceptedSnapshotId,
        process.env.NEXT_PUBLIC_APP_BASE_URL,
      ),
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
    };
    const builtPayload = buildSalesOrderPayload(soPayloadInput);

    // Track B §4 — freeze the grouping plan ALONGSIDE the payload, under a
    // reserved key stripped before transmission. It is the comparison target
    // the turnkey_only read-back needs; without it a wrong-member grouping with
    // a correct total is undetectable.
    const groupingPlan = buildGroupingPlan({
      detailLevel: acceptedDetailLevel,
      customerNetsuiteId: customer.netsuiteCustomerId,
      tierQty: tierRow.qty ?? null,
      lines: planLines,
    });
    // ── Step 2 — deterministic Item Group resolution + Group-line emission ──
    //
    // turnkey_only ONLY. `itemized` keeps the flat payload built above,
    // byte-for-byte: an itemized quote acquires no grouping requirement, and
    // its presentation is what the customer agreed to.
    //
    // The plan is the authority. No hash is recomputed and no identity is
    // derived here — `adaptPlannedGroup` carries the frozen
    // `compositionHash` / `nxs-grp-<hash>` through, and
    // `assertIdentityMatchesPlan` proves the primitive returned that same
    // identity rather than one of its own.
    let payloadForSend = builtPayload;
    // Named once, and used by BOTH the payload branch below and the
    // post-grouping REG-4 check that follows it. Two spellings of the same
    // condition is how a check ends up verifying a representation the order
    // was not sent in.
    const sendsGroupLines =
      groupingPlan.groupingRequired && groupingPlan.groups.length > 0;
    if (sendsGroupLines) {
      // Mixed structure was already refused at STEP 3, before any provider
      // call. Nothing carrying a Direct Product reaches this branch.
      if (!groupingPlan.derivable) {
        throw new Error(
          "[markComplete] The grouping plan carries no deterministic identity for at least one " +
            "assembly, so Item Group lines cannot be emitted. Refusing before Sales Order CREATE.",
        );
      }

      const groupCtx = {
        // GOVERNED SUBSIDIARY AUTHORITY — the same firm_settings value the
        // Sales Order header uses. Not hardcoded; the Case B fixture's
        // subsidiary must not be baked into the primitive.
        subsidiaryId: firm.netsuiteSubsidiaryId,
        customerNetsuiteId: customer.netsuiteCustomerId,
        // Description text only — the group's identity is the composition
        // hash, never this string.
        customerDisplay: customer.netsuiteCustomerId,
        dealName: dealCache.dealName,
        hubspotDealId: projectRow.hubspotDealId as string,
        quoteId,
        userId: actorUserId,
      };

      const emittedGroupLines: Array<{
        netsuiteItemId: string;
        sku: string;
        quantity: number;
      }> = [];

      for (const planned of groupingPlan.groups) {
        const adapted = adaptPlannedGroup(planned, groupCtx);
        const resolved = await findOrCreateItemGroup(adapted);

        // The primitive must have produced the identity the plan froze.
        assertIdentityMatchesPlan(adapted, resolved);

        // MASTER-DATA BOUNDARY. Read the definition back from NetSuite and
        // verify it before any Sales Order references it — for CREATED groups
        // as well as reused ones.
        //
        // Reuse safety is the older half: an external-id hit proves the group
        // was created for this composition once, not that it still HAS that
        // composition. An administrator can re-quantify members afterwards and
        // the external id does not change with them.
        //
        // Created groups are verified for a different reason, learned from
        // SO2703. A freshly created group used to be TRUSTED — the write
        // succeeded, so its contents were assumed correct. They were not: the
        // adapter had written tier-expanded quantities into the definition,
        // NetSuite accepted them, and the error only became visible after the
        // Sales Order had expanded them to 1,000,000 units and consumed the
        // deal. The definition is the last thing that can be checked while
        // failure is still free, so it is checked unconditionally.
        //
        // Fails CLOSED, before CREATE. The group is never rewritten to match:
        // Item Groups are shared master data, and silently re-editing one could
        // change another order's meaning.
        const actualMembers = await readItemGroupMembers(resolved.netsuiteInternalId);
        const verdict = verifyReusedGroupMembership(adapted, actualMembers);
        if (!verdict.matches) {
          throw new Error(
            `[markComplete] NetSuite Item Group ${resolved.itemidDisplay} ` +
              `(${resolved.netsuiteExternalId}, ${resolved.outcome}) does not match the frozen ` +
              `grouping plan for assembly ${planned.assemblySku}: ${verdict.problems.join("; ")}. ` +
              `Refusing before Sales Order CREATE rather than rewriting shared NetSuite master data.`,
          );
        }
        itemGroupDefinitions.push({
          assemblySku: planned.assemblySku,
          itemidDisplay: resolved.itemidDisplay,
          netsuiteInternalId: resolved.netsuiteInternalId,
          netsuiteExternalId: resolved.netsuiteExternalId,
          outcome: resolved.outcome,
          // qtyPerParent master quantities, as NetSuite holds them.
          members: actualMembers.map((m) => ({
            netsuiteItemId: m.netsuiteItemId,
            qtyPerParent: m.quantity,
          })),
        });

        emittedGroupLines.push({
          netsuiteItemId: resolved.netsuiteInternalId,
          sku: resolved.itemidDisplay,
          quantity: groupingPlan.tierQty ?? 0,
        });

        itemGroupOutcomes.push({
          assemblyId: planned.assemblyId,
          compositionHash: resolved.compositionHash,
          netsuiteExternalId: resolved.netsuiteExternalId,
          netsuiteInternalId: resolved.netsuiteInternalId,
          itemidDisplay: resolved.itemidDisplay,
          outcome: resolved.outcome,
        });
      }

      // Grouped members are replaced by their group lines; Direct Products are
      // NOT, because no group expands them.
      //
      // This previously sent `lines: []` unconditionally, which silently
      // DROPPED every Direct Product from a turnkey quote — the quote would
      // complete, the Sales Order would balance against its own lines, and a
      // product the customer had accepted would simply not be on the order.
      // The mixed-structure refusal that stood here masked it; removing the
      // refusal without this would have exposed it.
      //
      // The accounting half rides alongside for the same reason and would fail
      // the same way: an OTC or Direct Service line is expanded by no group, so
      // omitting it here would under-bill a turnkey order by exactly the fees —
      // which is the defect this slice closes, reintroduced one branch later.
      //
      // Member ids come from `itemGroupDefinitions`, which holds the membership
      // READ BACK from NetSuite and verified — what the groups will actually
      // expand, rather than what the plan intended them to.
      const expandedMemberItemIds = itemGroupDefinitions.flatMap((d) =>
        d.members.map((m) => m.netsuiteItemId),
      );
      payloadForSend = buildSalesOrderPayload({
        ...soPayloadInput,
        lines: [...directLines, ...accountingLines],
        groupLines: emittedGroupLines,
        groupMemberItemIds: expandedMemberItemIds,
      });
    }

    // ── POST-GROUPING REG-4 · over the order NetSuite will CALCULATE ───────
    //
    // The flat list checked at STEP 3.5 is not what gets posted. A turnkey
    // order posts Item Group HEADER lines carrying a quantity and no rate;
    // NetSuite expands each into its members, and the member rates arrive
    // afterwards by PATCH. So the amounts that land are
    //
    //     member amount = (group quantity × member qty-per-group) × patched rate
    //
    // computed by NetSuite from an expansion never sent explicitly. Checking
    // the intermediate would verify a representation that is not the order —
    // exactly the "reconciles internally while being wrong" shape.
    //
    // The expansion is therefore reproduced here in integer cents and compared
    // line by line against the frozen amounts, using the rates that will
    // actually be transmitted. Runs immediately before the POST, after the
    // Item Groups have been resolved and their membership read back, so the
    // group quantities and qty-per-group are the real ones.
    //
    // Grouped and flat are partitioned on `assemblyId`, the same attribution
    // the grouping plan was built from — not on item id, which is not an
    // identity here (one product may legitimately be a group member on one
    // line and attached directly on another). Every emitted line lands in
    // exactly one half, so nothing can be checked twice or go unchecked.
    const reg4Groups: PostGroupingGroup[] = sendsGroupLines
      ? groupingPlan.groups.map((g) => ({
          groupQuantity: groupingPlan.tierQty ?? 0,
          members: emitted
            .filter((e) => e.assemblyId !== null && e.assemblyId === g.assemblyId)
            .map((e) => ({
              sourceLineId: e.frozen.sourceLineId,
              description: e.frozen.description,
              netsuiteItemId: e.frozen.netsuiteItemId,
              qtyPerGroup: e.qtyPerGroup,
              // The transmitted rate, not the frozen string — the rendering
              // matches the payload builder exactly (same POSTED_RATE_SCALE), so
              // if that rendering ever lost precision the check refuses instead
              // of the order quietly computing a different amount than the one
              // proved at STEP 3.5.
              rate: e.soLine.rate.toFixed(POSTED_RATE_SCALE),
              frozenAmount: e.frozen.amount,
            })),
        }))
      : [];
    const groupedSourceLineIds = new Set(
      reg4Groups.flatMap((g) => g.members.map((m) => m.sourceLineId)),
    );
    const reg4FlatLines: PostGroupingFlatLine[] = emitted
      .filter((e) => !groupedSourceLineIds.has(e.frozen.sourceLineId))
      .map((e) => ({
        sourceLineId: e.frozen.sourceLineId,
        description: e.frozen.description,
        netsuiteItemId: e.frozen.netsuiteItemId,
        quantity: e.soLine.quantity,
        rate: e.soLine.rate.toFixed(POSTED_RATE_SCALE),
        frozenAmount: e.frozen.amount,
      }));
    const postGroupingFailures = checkPostGroupingReg4({
      groups: reg4Groups,
      flatLines: reg4FlatLines,
      frozenAcceptedTotal: decimalFromCents(frozenOrder.totalCents),
    });
    if (postGroupingFailures.length > 0) {
      throw new Error(
        "Blocked — the Sales Order NetSuite would calculate does not reproduce the accepted " +
          `column. ${postGroupingFailures.map((f) => f.detail).join(" ")}`,
      );
    }

    const builtPayloadWithPlan = attachGroupingPlan(payloadForSend, groupingPlan);

    let [durableAttempt] = await db
      .select({
        id: netsuiteSoPushes.id,
        payloadSnapshot: netsuiteSoPushes.payloadSnapshot,
        // Step 1 recovery core — the resumable state is (status, so_id).
        // Both are selected so the CREATE branch can be skipped when an
        // order already exists at the provider.
        status: netsuiteSoPushes.status,
        netsuiteSoId: netsuiteSoPushes.netsuiteSoId,
        netsuiteSoTranid: netsuiteSoPushes.netsuiteSoTranid,
      })
      .from(netsuiteSoPushes)
      .where(
        and(
          eq(netsuiteSoPushes.quoteId, quoteId),
          eq(netsuiteSoPushes.quoteSnapshotId, acceptedSnapshotId),
          sql`${netsuiteSoPushes.payloadSnapshot} IS NOT NULL`,
          // Lifecycle-aware election (2026-08-12). A CLOSED attempt does not
          // own the snapshot's future retry payload.
          //
          // `status` used to be ignored here, so a terminal validation
          // rejection permanently pinned its own invalid body: every later
          // retry replayed the known-bad payload and no code repair could ever
          // reach NetSuite. Found when the Class repair could not take effect
          // on the Case B retry.
          //
          // ONLY `failed + validation` is excluded, and only because the
          // evidence shows that state is conclusively terminal AND
          // side-effect-free:
          //   - NetSuite returned an explicit 4xx validation rejection;
          //   - no internal id came back;
          //   - the deal still carried ZERO Sales Orders afterwards (measured,
          //     not assumed — Walk 1, deal 58332160883);
          //   - the provider never created a transaction.
          //
          // Deliberately NOT a blanket `status <> 'failed'`. Every other
          // failure keeps pinning, because its outcome is not conclusively
          // known:
          //   server  (5xx)   — NetSuite may have committed and failed to reply
          //   network         — response lost; the POST may have landed
          //   unknown         — unclassified by definition
          //   rate_limit/auth/forbidden/not_found — refused before processing,
          //                     so probably safe, but we have no MEASURED
          //                     evidence for them and conservatism costs only
          //                     a stuck payload, never a duplicate order.
          //
          // Backstop if a validation failure ever did create a record: the
          // account's `_dps_ue_prevent_dupplicated_so.js` refuses a second
          // Sales Order for a deal that already has one (DUPLICATED DEAL).
          //
          // MUST stay in lockstep with the partial unique index
          // `netsuite_so_pushes_snapshot_attempt_unique_idx` (migration 0065),
          // which uses the identical predicate so an excluded attempt also
          // releases its claim on the snapshot and a new attempt row can be
          // inserted. Selector and constraint are one rule expressed twice;
          // changing one without the other reopens the defect.
          sql`NOT (${netsuiteSoPushes.status} = 'failed' AND ${netsuiteSoPushes.errorClass} = 'validation')`,
        ),
      )
      .orderBy(asc(netsuiteSoPushes.createdAt))
      .limit(1);
    let payload = (durableAttempt?.payloadSnapshot ?? builtPayloadWithPlan) as Record<string, unknown>;
    const idempotencyKey = computeIdempotencyKey(quoteId, acceptedSnapshotId);

    // The snapshot-keyed attempt and first payload must be durable before
    // POST. A concurrent loser reloads and replays the winner's payload.
    let pendingId: string;
    // Step 1 recovery core — resumable post-CREATE attempt.
    //
    // Set when the elected attempt already carries a NetSuite Sales Order id.
    // An order exists at the provider; issuing another CREATE is never
    // correct, and the duplicate-deal SuiteScript would refuse it anyway.
    //
    // Keyed on SO-id presence rather than status alone (see
    // attempt-lifecycle.mustNotCreate) so that a row which somehow carries an
    // id under any other status still cannot re-create.
    // True when this run rejoined an order the provider already held rather
    // than creating one. Keeps the post-catch fallthrough from labelling it
    // `fresh`.
    let adoptedViaReconciliation = false;
    let resumeSoId: string | null = durableAttempt?.netsuiteSoId ?? null;
    let resumeSoTranid: string | null = durableAttempt?.netsuiteSoTranid ?? null;

    if (durableAttempt) {
      pendingId = durableAttempt.id;
      // Only reset to `pending` when nothing has been created. Resetting a
      // resumable attempt would erase the very state that prevents a second
      // CREATE.
      if (!mustNotCreate(durableAttempt)) {
        await db
          .update(netsuiteSoPushes)
          .set({ status: "pending", errorClass: null, errorDetail: null })
          .where(eq(netsuiteSoPushes.id, pendingId));
      }
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
            status: netsuiteSoPushes.status,
            netsuiteSoId: netsuiteSoPushes.netsuiteSoId,
            netsuiteSoTranid: netsuiteSoPushes.netsuiteSoTranid,
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
        // The concurrent loser may have re-elected a row that ALREADY carries
        // an SO id. Refresh the resume keys from what was actually loaded —
        // they were computed before this re-select, and a stale null here
        // would send the loser into CREATE against an existing order.
        resumeSoId = durableAttempt.netsuiteSoId ?? null;
        resumeSoTranid = durableAttempt.netsuiteSoTranid ?? null;
      }
    }

    // Debug hook: NETSUITE_DEBUG_PAYLOAD=1 logs the SO body pre-POST.
    // Load-bearing for sandbox smoke reproduction; kept as opt-in gate.
    if (process.env.NETSUITE_DEBUG_PAYLOAD === "1") {
      console.log("[markComplete] SO payload:\n" + JSON.stringify(payload, null, 2));
    }

    // ── AMBIGUOUS-CREATE RECONCILIATION (Step 2) ──────────────────────────
    //
    // An INHERITED attempt in `pending + netsuite_so_id = NULL` is not "safe to
    // create again": it is indistinguishable between "died before POST" and
    // "POST landed, response lost". A row inserted during THIS invocation has
    // provably not been POSTed, so it is excluded — only `durableAttempt`
    // reaches here.
    //
    // Provider-header idempotency cannot be leaned on: measured absent on this
    // account (two identical keys → SO2705 + SO2706).
    if (
      durableAttempt &&
      !mustNotCreate({ status: durableAttempt.status ?? "", netsuiteSoId: resumeSoId })
    ) {
      const decision = await reconcileBeforeCreate({
        trigger: "ambiguous_attempt",
        quoteId,
        expect: {
          customerId: customer.netsuiteCustomerId,
          hubspotDealId: projectRow.hubspotDealId as string,
          tierQty: groupingPlan.tierQty ?? 0,
          plannedGroups: groupingPlan.groups,
        },
      });
      if (decision.action === "adopt") {
        // Rejoin the normal post-CREATE lifecycle through the SAME recovery
        // boundary a fresh CREATE uses. No CREATE is issued; convergence and
        // the unweakened final gate still have to pass before `succeeded`.
        await recordSalesOrderCreated({
          attemptId: pendingId,
          netsuiteSoId: decision.candidate.internalId,
          netsuiteSoTranid: decision.candidate.tranid,
          amountPushed: currentAmount,
        });
        resumeSoId = decision.candidate.internalId;
        resumeSoTranid = decision.candidate.tranid;
        adoptedViaReconciliation = true;
        // The prior CREATE DID succeed — only its response was lost — so this
        // is convergence from a prior success, not a new outcome kind. The
        // adoption itself is forensically recorded on the attempt row.
        retryOutcome = "converged_from_prior_success";
      } else if (decision.action === "fail_closed") {
        await recordNeedsReconciliation({
          attemptId: pendingId,
          errorDetail: `${decision.reason}${decision.failures.length ? ` — ${decision.failures.join("; ")}` : ""}`,
        });
        throw new Error(
          `[markComplete] ambiguous Sales Order CREATE outcome: ${decision.reason}`,
        );
      }
      // action === "create" — the provider positively shows no order for this
      // deal, so the CREATE below is safe.
    }

    let created;
    if (mustNotCreate({ status: durableAttempt?.status ?? "", netsuiteSoId: resumeSoId })) {
      // RESUME. A Sales Order already exists for this durable attempt, so the
      // CREATE is skipped entirely — not retried, not conditionally repeated.
      // Step 2 will read this SO back structurally and complete the member
      // rates; Step 1 only guarantees we arrive here instead of creating a
      // duplicate.
      created = { internalId: resumeSoId as string };
      salesOrderInternalId = resumeSoId as string;
      salesOrderTranid = resumeSoTranid;
      amountPushed = currentAmount;
      retryOutcome = "converged_from_prior_success";
    } else {
    try {
      // Track B §4 — the envelope never reaches NetSuite. Unconditional and
      // safe on payloads that never carried one, which is what makes it
      // correct on the durable-replay path too (a replayed snapshot carries
      // the envelope). The transmitted body is byte-identical to pre-§4.
      created = await netsuite.createSalesOrder(stripGroupingPlan(payload), {
        idempotencyKey,
      });
    } catch (e) {
      // NS create failed. Route through the centralised lifecycle so the
      // invariant is enforced in one place: pre-CREATE (no SO id) is terminal
      // `failed` with 0065 semantics intact; an attempt that already carries
      // an SO id can never be marked failed.
      const err = e instanceof NetsuiteError ? e : null;
      const failedAt = new Date();
      const errClass = err?.className ?? "unknown";
      const errDetail = err?.context.detail ?? String(e);

      // ── DUPLICATED DEAL (Step 3) ────────────────────────────────────────
      //
      // The provider has just asserted an order EXISTS for this governed deal.
      // Its HTTP class is 400, shared with ordinary validation, but its business
      // meaning is the opposite: validation means "nothing happened, discard
      // safely" — this means "the external effect you attempted may already
      // exist". Routing it to the validation branch is what released snapshot
      // ownership and orphaned the real order.
      if (errClass === "duplicate_deal" && pendingId) {
        const decision = await reconcileBeforeCreate({
          trigger: "duplicate_deal",
          quoteId,
          expect: {
            customerId: customer.netsuiteCustomerId,
            hubspotDealId: projectRow.hubspotDealId as string,
            tierQty: groupingPlan.tierQty ?? 0,
            plannedGroups: groupingPlan.groups,
          },
        });
        if (decision.action === "adopt") {
          await recordSalesOrderCreated({
            attemptId: pendingId,
            netsuiteSoId: decision.candidate.internalId,
            netsuiteSoTranid: decision.candidate.tranid,
            amountPushed: currentAmount,
          });
          created = { internalId: decision.candidate.internalId };
          salesOrderInternalId = decision.candidate.internalId;
          salesOrderTranid = decision.candidate.tranid;
          amountPushed = currentAmount;
          adoptedViaReconciliation = true;
          retryOutcome = "converged_from_prior_success";
        } else {
          // Zero candidates is a CONTRADICTION — the guard matched on something
          // this query cannot see — and several candidates cannot be
          // disambiguated. Both park; neither creates. `create` is unreachable
          // here by construction (`decideReconciliation` never returns it for
          // this trigger), and is treated as fail-closed regardless.
          const reason =
            decision.action === "fail_closed" ? decision.reason : "unresolved duplicate-deal outcome";
          const detail =
            decision.action === "fail_closed" && decision.failures.length
              ? `${reason} — ${decision.failures.join("; ")}`
              : reason;
          await recordNeedsReconciliation({ attemptId: pendingId, errorDetail: detail });
          throw new Error(`[markComplete] DUPLICATED DEAL could not be reconciled: ${detail}`);
        }
      } else {
      if (pendingId) {
        try {
          await recordAttemptFailure({
            attemptId: pendingId,
            netsuiteSoId: resumeSoId,
            errorClass: errClass,
            errorDetail: errDetail,
          });
        } catch {
          // secondary write failed — original throw is the real error
        }
      }
      // Slice 12 Step 8c-4 — mirror failure state onto the quote row
      // so the /quote page's Sales Order tab reads the failed variant
      // across page reloads without a join to netsuite_so_pushes.
      // Non-fatal — if this write fails, netsuite_so_pushes still
      // carries the row; preflight loader reads either source.
      //
      // Step 1: mirrors the RESUMABLE variant when an SO already exists, so
      // the operator surface never shows "failed" for an order that was in
      // fact created. Same branch condition as the lifecycle helper.
      try {
        await db
          .update(quotesTable)
          .set({
            netsuiteSoPushStatus: resumeSoId ? "awaiting_rates" : "failed",
            netsuiteSoPushError: resumeSoId
              ? awaitingRatesOperatorMessage(resumeSoTranid)
              : errDetail,
            updatedAt: failedAt,
          })
          .where(eq(quotesTable.id, quoteId));
      } catch {
        // non-fatal — preflight reads netsuite_so_pushes as fallback
      }
      throw e;
      }
    }

    salesOrderInternalId = created.internalId;
    amountPushed = currentAmount;
    // An adopted order was created by the PRIOR attempt whose response was
    // lost, so it must not be relabelled `fresh` on the way out of the catch.
    retryOutcome = adoptedViaReconciliation ? "converged_from_prior_success" : "fresh";

    // *** THE RECOVERY BOUNDARY ***
    //
    // Persist the SO identity and move the attempt to `awaiting_rates`
    // IMMEDIATELY, before anything else can fail. Step 2's member-rate
    // PATCH sequence runs after this point; a crash anywhere in it leaves a
    // row that knows which order exists and resumes against it.
    //
    // Deliberately BEFORE the tranid fetch below: the tranid is diagnostic,
    // the internal id is the recovery key, and the id must be durable even
    // if the follow-up GET fails.
    try {
      await recordSalesOrderCreated({
        attemptId: pendingId,
        netsuiteSoId: salesOrderInternalId,
        netsuiteSoTranid: null,
        amountPushed: currentAmount,
      });
    } catch (persistErr) {
      // A created SO whose id we failed to persist is the one thing worse
      // than a failed create — it is unreachable by any retry. Surface it
      // loudly rather than continuing into the rate sequence.
      throw new Error(
        `[markComplete] Sales Order ${salesOrderInternalId} was created but its identity could not be persisted; ` +
          `manual reconciliation required. Cause: ${String(persistErr)}`,
      );
    }
    } // end CREATE branch (skipped entirely when resuming)

    let rateConvergenceSummary: { patched: number; alreadyCorrect: number } | null = null;
  // Reporting only — never a gate. See cost-projection.ts.
  let costProjectionSummary: CostProjectionOutcome | null = null;
  // Reported like the others, but IS a gate — see the enforcement block below.
  let taxEnforcementSummary: { patched: number; alreadyNonTaxable: number } | null =
      null;

    // ── Step 3 — negotiated member-rate convergence + verification ────────
    //
    // Runs for turnkey_only only, AFTER the recovery boundary. Every failure
    // from here on routes through recordAttemptFailure, which — because
    // `netsuite_so_id` is now non-null — holds the attempt at
    // `awaiting_rates` rather than `failed`. So an interruption anywhere in
    // this block leaves an order that the next invocation resumes against.
    //
    // Convergent, not replayed: the order is re-read every run, addresses are
    // re-derived from that read, correct members are skipped, and only
    // mismatches are patched. A fully-correct order performs no commercial
    // mutation.
    if (sendsGroupLines) {
      try {
        const convergence = await runRateConvergence({
          soId: salesOrderInternalId,
          plannedGroups: groupingPlan.groups,
          // Every UNGROUPED line the accepted order requires, so the gate can
          // prove each one reached the Sales Order. Derived from the SAME
          // arrays that built the payload — the gate must check what was
          // actually required, not a second derivation that could agree with a
          // wrong payload.
          //
          // The accounting half is included for two reasons, both load-bearing.
          // Presence: an OTC or Direct Service line dropped by NetSuite would
          // otherwise pass unnoticed, which is precisely the under-billing this
          // slice closes. Totals: `acceptedTotal` is now the FROZEN total,
          // which includes those fees — so a gate told only about Direct
          // Products would refuse a correct order for the amount of the fees,
          // and the gate's own "unexpected ungrouped line" check would reject
          // each of them by name.
          plannedDirectLines: [...directLines, ...accountingLines].map((l) => ({
            sku: l.sku,
            netsuiteItemId: l.netsuiteItemId,
            quantity: l.quantity,
            rate: l.rate,
            amount: Math.round(l.rate * l.quantity * 10000) / 10000,
          })),
          tierQty: groupingPlan.tierQty ?? 0,
          acceptedTotal: currentAmount,
          expectHeader: {
            customerId: customer.netsuiteCustomerId,
            hubspotDealId: projectRow.hubspotDealId as string,
            businessSegmentId: dealCache.businessSegmentId,
            termsPresent: true,
          },
          provider: {
            readLines: (id: string) => readSalesOrderLines(id),
            readHeader: (id: string) => readSalesOrderHeader(id),
            patchLine: (id: string, address: number, patch: { rate: number; priceLevelId?: string }) =>
              patchSalesOrderLine(id, address, patch),
          },
        });

        if (!convergence.gate.pass) {
          // The order exists and may be partly priced. Retained as resumable
          // with the SO identity intact — never discarded, never re-created.
          throw new Error(
            `Sales Order ${salesOrderTranid ?? salesOrderInternalId} was created but is not ` +
              `commercially complete. ${convergence.gate.failures.join("; ")}. ` +
              `The order is retained and this push can be safely retried — it will resume ` +
              `against the same Sales Order rather than creating another.`,
          );
        }
        rateConvergenceSummary = {
          patched: convergence.patched.length,
          alreadyCorrect: convergence.alreadyCorrect,
        };

        // ---- Governed tax policy → every line non-taxable ----
        //
        // AFTER convergence, because Item Group MEMBER lines do not exist until
        // NetSuite has expanded the group — and the member is exactly the line
        // that was taxable on SO2716 while the group header around it was not.
        //
        // UNLIKE the cost projection below, this is NOT best-effort. Cost is a
        // reporting basis, so a commercially correct order must not be refused
        // when it fails to write. Non-taxability is a governed commercial rule,
        // so an order that stays taxable is not one to complete quietly. The
        // Sales Order is retained and the push resumes against it, exactly as
        // the convergence gate does.
        {
          const tax = await enforceNonTaxableLines({
            readLines: async () =>
              (await readSalesOrderLines(salesOrderInternalId!)).map((l) => ({
                line: l.line,
                taxCodeId: l.taxCodeId,
              })),
            patchLine: (address, taxCodeId) =>
              patchSalesOrderLine(salesOrderInternalId!, address, { taxCodeId }),
          });
          taxEnforcementSummary = {
            patched: tax.patched.length,
            alreadyNonTaxable: tax.alreadyNonTaxable.length,
          };
          if (tax.residual.length > 0 || tax.failures.length > 0) {
            throw new Error(
              `Sales Order ${salesOrderTranid ?? salesOrderInternalId} was created but is not ` +
                `tax-compliant. Every Nexus Sales Order must be non-taxable; line(s) ` +
                `${tax.residual.join(", ") || "—"} still carry a taxable code` +
                (tax.failures.length > 0
                  ? `, and ${tax.failures.length} tax patch(es) failed: ` +
                    tax.failures.map((f) => `line ${f.line}: ${f.message}`).join("; ")
                  : "") +
                `. The order is retained and this push can be safely retried — it will resume ` +
                `against the same Sales Order rather than creating another.`,
            );
          }
        }

        // ---- Governed cost → NetSuite Accounting basis (one-shot) ----
        //
        // AFTER convergence, because member line identities only exist once
        // NetSuite has expanded the group, and OUTSIDE its gate, because cost
        // has no commercial invariant to converge toward. See cost-projection.ts.
        //
        // Never throws: a Sales Order that is commercially correct must not be
        // refused because a reporting basis failed to write.
        try {
          const costLines = await readSalesOrderLines(salesOrderInternalId);
          const plan = planCostProjection({
            lines: costLines,
            governed: groupingPlan.groups.flatMap((g) =>
              g.members.map((m) => ({
                netsuiteItemId: m.netsuiteItemId,
                unitCost: m.unitCost,
              })),
            ),
          });
          costProjectionSummary = await projectGovernedCosts({
            plan,
            patchLine: (address, unitCost) =>
              patchSalesOrderLine(salesOrderInternalId!, address, { unitCost }),
          });
        } catch (e) {
          costProjectionSummary = {
            written: 0,
            skipped: 0,
            failures: [
              { address: -1, message: e instanceof Error ? e.message : String(e) },
            ],
          };
        }
      } catch (e) {
        const err = e instanceof NetsuiteError ? e : null;
        // POST-CREATE VERIFICATION CLASS. Everything reachable here runs AFTER
        // the Sales Order exists, so a non-provider failure in this block is
        // always the same thing: the order was created but could not be shown
        // to be commercially complete. `"verification"` names that; the old
        // `"unknown"` said only that nobody had classified it, which is what
        // SO2703's gate refusal recorded despite being fully understood.
        //
        // A NetsuiteError keeps its own className (rate_limit, auth, …) — that
        // is strictly more specific, and those are transport failures rather
        // than verdicts about the order's contents.
        //
        // CANNOT BECOME RELEASABLE. The 0065 predicate releases only
        // `failed + validation`; `netsuiteSoId` is non-null here, so
        // recordAttemptFailure holds the attempt at `awaiting_rates` and it can
        // never be `failed` at all. The predicate is untouched — this class is
        // excluded by the invariant, not by widening the rule.
        await recordAttemptFailure({
          attemptId: pendingId,
          netsuiteSoId: salesOrderInternalId, // non-null ⇒ cannot become `failed`
          errorClass: err?.className ?? "verification",
          errorDetail: err?.context.detail ?? String(e),
        });
        try {
          await db
            .update(quotesTable)
            .set({
              netsuiteSoPushStatus: "awaiting_rates",
              netsuiteSoPushError: awaitingRatesOperatorMessage(salesOrderTranid),
              updatedAt: new Date(),
            })
            .where(eq(quotesTable.id, quoteId));
        } catch {
          // non-fatal — netsuite_so_pushes still carries the resumable row
        }
        throw e;
      }
    }

    // ── POSTING PROVENANCE · what each frozen line ACTUALLY posted to ─────
    //
    // Runs after the order exists and, where grouping applies, after its
    // member rates have converged — so it records a settled fact rather than
    // an intention.
    //
    // Not a breach of the freeze. Pattern 52 makes the frozen COMMERCIAL
    // columns immutable, and they stay that way: no amount, rate, quantity,
    // pricing state or total is touched. `netsuite_item_id` is posting
    // provenance, in the same family as `pdf_url` — a record of what happened
    // to a line after it was frozen, written after the event it describes.
    //
    // NON-BLOCKING, deliberately and for the same reason the tranid fetch is:
    // the Sales Order is created and commercially proved by this point, and
    // refusing to complete a correct order because an audit column failed to
    // write would trade a real outcome for a bookkeeping one. The failure is
    // carried into the audit row instead of being swallowed.
    try {
      const written = await recordPostingProvenance(
        db,
        emitted.map((e) => ({
          sourceLineId: e.frozen.sourceLineId,
          postedNetsuiteItemId: e.frozen.netsuiteItemId,
        })),
      );
      provenanceOutcome = { written: written.written, error: null };
    } catch (e) {
      provenanceOutcome = {
        written: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }

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
    await writeAuditEntry({
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
          // Provider-read master definitions (qtyPerParent), captured before
          // SO CREATE. Separate from item_groups, which records identity and
          // create-vs-reuse outcome rather than contents.
          item_group_definitions: itemGroupDefinitions,
          // F1/F4 — the commercial authority this order was built from, stated
          // rather than inferred from the absence of a contrary note. A reader
          // asking "was this order priced from the accepted column or
          // recomputed?" gets an answer from the audit row itself.
          commercial_source: "frozen_accepted_tier",
          frozen_accepted_total: decimalFromCents(frozenOrder.totalCents),
          // Non-blocking by design (see the write site). Recorded so a failed
          // provenance write is visible in audit rather than silent.
          posting_provenance: provenanceOutcome,
        },
      },
    }, tx);
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
  // CERTIFICATION MODE — see src/lib/config/certification-mode.ts. Complete is
  // the SECOND production HubSpot write in the certification path: on amount
  // drift it PATCHes the real deal, which would change the deal's
  // last-modified timestamp even though Accept left it untouched. Checked
  // before the drift computation so no drift can reach the write at all.
  //
  // Reported as "skipped" (the existing no-write status) rather than a new
  // status, so every downstream consumer of amountPatch keeps working; the
  // suppression itself is legible from the certification banner and the
  // suppressed quote_accepted audit row.
  if (isHubspotAcceptSyncSuppressed()) {
    return {
      status: "skipped",
      prior: args.priorAmount,
      current: args.currentAmount,
      delta: null,
    };
  }
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
