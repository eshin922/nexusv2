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
import { NetsuiteError } from "./errors";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { requireResolvedQuoteCosts } from "@/lib/quote-cost-completeness";
import {
  planCostProjection,
  projectGovernedCosts,
  type CostProjectionOutcome,
} from "./cost-projection";

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
  // A quote is pushable if it carries ANY product. Requiring an assembly was
  // the structural assumption that made a Direct Product unshippable — the
  // quote had products, just not grouped ones.
  if (!tree || (tree.assemblies.length === 0 && tree.directProducts.length === 0)) {
    throw new Error("Quote has no products to push.");
  }

  // Every UNIQUE product SKU on the quote must resolve — grouped members AND
  // Direct Products. A Direct Product resolves through the identical SKU-match;
  // membership has never been part of item resolution.
  const uniqueSkus = Array.from(
    new Set(
      [
        ...tree.assemblies.flatMap((a) => a.children),
        ...tree.directProducts,
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
    // Track B §4 — assembly attribution, captured HERE rather than re-derived
    // later. Constraint 3: the plan is built from the same governed state as
    // the outgoing handoff, so the two cannot disagree.
    const planLines: PlanLineInput[] = [];
    for (const leafRollup of leafRollups) {
      // Locate the product's tree entry to get its SKU + name. Grouped members
      // and Direct Products are searched in ONE space keyed by the canonical
      // identity — a Direct Product differs only in having no assembly, which
      // is carried as `assembly: null` rather than by being looked up elsewhere.
      const treeLeaf =
        tree.assemblies
          .flatMap((a) =>
            a.children.map((c) => ({
              assembly: a as AssemblyNode | null,
              child: c as DirectProductNode,
            })),
          )
          // OD-028 — match on the CANONICAL cost-input identity. `skuRollups` are
          // keyed by quote_leaf_id since OD-017; `junctionId` is the legacy
          // assembly_leaf id and matched 0/2 on Order B, so every leaf was
          // skipped and the empty-lines guard refused the push. Deliberately NO
          // fallback to junctionId: a fallback would silently re-absorb the next
          // re-key, which is exactly how this class keeps recurring.
          .find(({ child }) => child.quoteLeafId === leafRollup.skuId) ??
        tree.directProducts
          .filter((d) => d.quoteLeafId === leafRollup.skuId)
          .map((d) => ({ assembly: null as AssemblyNode | null, child: d }))[0];
      if (!treeLeaf?.child.sku) continue; // no SKU → skipped upstream by resolver
      const nsId = nsIdBySku.get(treeLeaf.child.sku);
      if (!nsId) continue;

      const perTierRollup = leafRollup.perTier.find((pt) => pt.tierId === tierId);
      if (!perTierRollup) continue;

      // Effective qty for this leaf at this tier:
      // tier.qty × qtyPerParent (leaves have qtyPerParent per math layer).
      const qtyPerParent = Math.max(1, Math.round(leafRollup.qtyPerParent ?? 1));
      const effectiveQty = (tierRow.qty ?? 0) * qtyPerParent;

      const lineRate = Number(perTierRollup.requiredSellPerUnit);
      lines.push({
        netsuiteItemId: nsId,
        sku: treeLeaf.child.sku,
        description:
          treeLeaf.child.name ||
          (treeLeaf.assembly
            ? `${treeLeaf.assembly.name} — ${treeLeaf.child.sku}`
            : treeLeaf.child.sku),
        quantity: effectiveQty,
        rate: lineRate,
        unitCost:
          perTierRollup.contributionCostPerUnit != null
            ? Number(perTierRollup.contributionCostPerUnit)
            : null,
      });
      planLines.push({
        // NULL for a Direct Product. The plan records it as attributed to no
        // group, which is a positive fact the walk can assert — not an absence.
        assemblyId: treeLeaf.assembly?.id ?? null,
        assemblySku: treeLeaf.assembly?.sku ?? null,
        assemblyName: treeLeaf.assembly?.name ?? null,
        sku: treeLeaf.child.sku,
        netsuiteItemId: nsId,
        quantity: effectiveQty,
        // The Item Group DEFINITION multiplier — how many of this leaf one
        // group contains, independent of how many groups the tier buys.
        qtyPerParent,
        rate: lineRate,
        // Same expression as the flat line above, deliberately — one governed
        // source reaching both structures is the invariant this repair exists
        // to hold. Never re-derived from `rate`, the accepted total, freight,
        // duty or tariff.
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

    // Extracted so the turnkey_only branch can rebuild the SAME header with
    // group lines swapped in — every governed header field stays identical by
    // construction rather than by being re-listed.
    const soPayloadInput = {
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
    if (groupingPlan.groupingRequired && groupingPlan.groups.length > 0) {
      // MIXED-STRUCTURE BOUNDARY — fail closed, do not guess.
      //
      // A turnkey_only quote carrying BOTH grouped assemblies and Direct
      // Products would need group lines and flat lines in one payload.
      // `buildSalesOrderPayload` refuses that combination because Probe 7a
      // observed NetSuite expanding the group AND honouring explicit members,
      // returning 204 while silently doubling the order.
      //
      // That probe concerned members OF a group sent alongside it, and a Direct
      // Product is a member of nothing — so the duplication may well not apply
      // here. It has not been measured, and a plausible argument is not
      // evidence. Refusing before CREATE costs an operator an error message;
      // being wrong costs a doubled Sales Order on a real customer.
      //
      // Unblocking this needs one disposable sandbox probe: group line + an
      // unrelated flat line in a single CREATE, then read back the line count.
      const directLineCount = groupingPlan.lineAttribution.filter(
        (l) => l.assemblyId === null,
      ).length;
      if (directLineCount > 0) {
        throw new Error(
          `[markComplete] This quote mixes ${groupingPlan.groups.length} Item Group(s) with ` +
            `${directLineCount} Direct Product line(s) at turnkey_only detail. Emitting both in one ` +
            `Sales Order is unproven against NetSuite's group expansion (Probe 7a duplication), so ` +
            `Nexus refuses before CREATE rather than risk a doubled order. Send this quote itemized, ` +
            `or place the Direct Products in an Item Group.`,
        );
      }
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

      // Group lines REPLACE the flat lines — never accompany them. The builder
      // refuses both together (Probe 7a duplication), so this is checked twice
      // by construction.
      payloadForSend = buildSalesOrderPayload({
        ...soPayloadInput,
        lines: [],
        groupLines: emittedGroupLines,
      });
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
    if (groupingPlan.groupingRequired && groupingPlan.groups.length > 0) {
      try {
        const convergence = await runRateConvergence({
          soId: salesOrderInternalId,
          plannedGroups: groupingPlan.groups,
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
            patchLine: (id: string, address: number, patch: { rate: number }) =>
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
