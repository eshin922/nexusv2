// Slice 11 Step 6.2 — shared CustomerView resolver.
//
// Extracted from src/app/projects/[id]/quotes/[quoteId]/quote/
// page.tsx so both consumers of the customer-PDF render path
// build the CustomerView from the SAME code path:
//
//   1. Page: /projects/[id]/quotes/[quoteId]/quote — renders
//      QuoteHost + toolbar chrome; consumes CustomerView for
//      state + iframe src (Step 6.4).
//   2. Preview route: /api/quotes/[quoteId]/customer-pdf —
//      renders react-pdf via renderToStream; consumes
//      CustomerView + calls buildQuoteDocument (Step 6.3).
//
// sendQuote builds its OWN CustomerView from the pre-computed
// snapshot values (it knows what's about to become the snapshot;
// no re-resolve needed after the tx). Not routed through this
// helper — different data-source semantics (would-be-snapshot
// vs current-state).
//
// Pattern 45 boundary safe: consumes DB rows + costing bundle
// output + firm_settings; produces CustomerView (customer-facing
// projection). Does not import from src/components/pdf/.

import "server-only";

import { composeTierMoney } from "@/lib/customer-money";
import { composeAddress } from "@/lib/customer-address-display";
import { applyTierVisibility } from "@/lib/customer-tier-visibility";
import { projectBelowFloorAuthorization } from "@/lib/below-floor-projection";
import { findUnbillablePlacements } from "@/lib/commercial-recovery/unbillable-placements";
import { readChargeRecoveryPricingGaps } from "@/lib/component-charges/recovery-pricing";
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  belowFloorAuthorizations,
  firmSettings,
  hubspotDealsCache,
  presentationProfile,
  presentationProfileTier,
  projects,
  quotes,
  quoteTiers,
  users,
} from "@/db/schema";
import { type ProposedElections, getCostingBundle } from "@/app/actions/costing";
import { projectCommercial } from "@/lib/commercial-projection";
import { landedLogisticsForTier } from "@/lib/landed-logistics";
import {
  projectFrozenInstructions,
  projectRecoveryInstructionsForRead,
} from "@/lib/commercial-recovery/frozen-instruction";
import { buildRecoveryWorkspace } from "@/lib/commercial-recovery/workspace-view";
import { readComponentChargeReadiness } from "@/lib/component-charges/readiness";
import type { RecoveryChargeKey } from "@/lib/commercial-recovery/registry";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { loadQuoteAddendum } from "@/lib/addendum-loader";
import { toLocalIsoDate } from "@/lib/local-date";
import { VENDOR_FIXTURE } from "@/lib/quote-fixtures";
import { resolveGovernedPaymentTerms } from "@/lib/netsuite/customer-terms";
import type { QuoteAddendumData } from "@/lib/addendum-loader";
import type {
  CustomerView,
  CustomerViewPreparedBy,
  CustomerViewServiceFee,
  CustomerViewSku,
  CustomerViewTier,
  CustomerViewVendor,
} from "@/types/quote";
import type { CommercialSettingsResolution } from "@/lib/commercial-settings-contract";

export type CustomerViewSearchParams = {
  layout?: string;
  detail?: string;
  addendum?: string;
};

export type ResolveCustomerViewResult =
  | {
      ok: true;
      view: CustomerView;
      addendumData: QuoteAddendumData | null;
      project: typeof projects.$inferSelect;
      quote: typeof quotes.$inferSelect;
      /** Slice 12 Step 8a — full per-tier rollup for PM-facing
       * surfaces (Acceptance tier chips, Sales Order receipt totals).
       * The resolver already loads the costing bundle for the
       * customer-view projection; passing quoteRollup through avoids
       * a second `getCostingBundle` call in page.tsx (per CLAUDE.md
       * "getCostingBundle parallel-query discipline" — the bundle
       * fans out 8 queries internally and must not be nested inside
       * outer Promise.all calls).
       *
       * PM-facing only. Never route through `view` (Pattern 45 —
       * `view.tiers` intentionally strips margin/cost/status data
       * from the customer PDF projection). */
      quoteRollup: import("./costing").QuotePerTierRollup[];
      /**
       * The commercial projection this view was rendered FROM.
       *
       * Returned rather than recomputed so the send path freezes the same
       * in-memory result the customer document was built from. Calling
       * `projectCommercial` a second time at send would be a second
       * construction, and "the frozen matrix matches the PDF" would go back to
       * being a claim about two computations agreeing.
       */
      commercial: import("./commercial-projection").CommercialProjection;
      /** Recovery workspace rows, from the same bundle read. */
      /**
       * Recovery instructions for RENDERING a draft — the read projection.
       *
       * An unplaced component charge produces no instruction here and does not
       * fail the page. Before this split, `resolveCustomerView` ran the COMMIT
       * projection on every load, so any quote carrying an unplaced charge
       * returned 500 on the Quote surface — the page that hosts Commercial
       * Recovery, which is where that charge would have been placed.
       *
       * NOT what gets frozen. See `freezeRecoveryInstructions` below.
       */
      recoveryInstructions: import("./commercial-recovery/frozen-instruction").FrozenRecoveryInstruction[];
      /**
       * Charges this draft carries that nobody has placed yet.
       *
       * Named rather than silently omitted, so a caller that needs to know
       * cannot fail to be told — the read projection drops them from the
       * instruction list and this is where they go.
       */
      unplacedRecoveryCharges: {
        chargeKey: string;
        chargeInstanceId: string | null;
        tierId: string;
      }[];
      /**
       * The COMMIT projection, over the SAME construction — for the freeze.
       *
       * ── WHY A THUNK AND NOT A SECOND ARRAY ──────────────────────────────
       *
       * Two requirements meet here and both must hold. The freeze must project
       * from the construction the customer document was built from, not from a
       * second read — so it cannot re-resolve. And the freeze must still REFUSE
       * an unplaced charge, as defence in depth behind send-readiness — so it
       * cannot simply be handed the read list, which has already dropped them.
       *
       * A thunk closing over this resolution satisfies both: same construction,
       * and the throw happens at the moment of freezing rather than at every
       * page load. Calling it is the act of committing.
       */
      freezeRecoveryInstructions: () => import("./commercial-recovery/frozen-instruction").FrozenRecoveryInstruction[];
      /**
       * The footer's verdict — the SAME evaluation the send gate performs.
       *
       * The footer used to compute `blocked` from a hand-rolled margin
       * comparison and read no authorizations at all, so a properly authorized
       * quote was told to request approval it already held, for a send the gate
       * would have allowed. Two answers to one question; now one.
       */
      belowFloor: import("./below-floor-projection").BelowFloorProjection;
      /**
       * Recovery placed where this quote cannot bill it.
       *
       * Empty on every well-formed quote. Non-empty means the engine is
       * counting revenue the customer document does not ask for, and the
       * surface must say so rather than show a green pre-flight.
       *
       * The SAME function the send gate calls, over the SAME constructed state
       * this view was built from. The gate remains the boundary; this is the
       * surface telling the operator before they reach it, and the two cannot
       * disagree because there is only one detection.
       */
      unbillableRecovery: import("./commercial-recovery/unbillable-placements").UnbillablePlacement[];
      /**
       * Elected component charges carrying no recovery price.
       *
       * Same contract as `unbillableRecovery` above: ONE detection, read by the
       * surface and by `sendQuote`. A separately-elected charge with no ask
       * reached a customer document as "$0.00" on a quote the rail called
       * ready, because this question had no detection at all.
       */
      chargeRecoveryPricingGaps: import("./component-charges/recovery-pricing-rule").ChargeRecoveryPricingGap[];
      /**
       * Card 3's authored instruction to Accounting.
       *
       * Deliberately NOT on `CustomerView`. That type is the customer document,
       * and this is the one field on Card 3 the customer must never see - so it
       * travels beside the view rather than inside it, and the boundary
       * verifier keeps the render tree unable to reach it either way.
       */
      accountingInstruction: string | null;
      /** Card 1 · one row per governed recoverable charge. */
      recoveryRows: import("./commercial-recovery/workspace-view").RecoveryChargeRow[];
      /**
       * Card 2 · what the operator has decided the customer will SEE, and
       * Card 3's "Customer received" is a projection of exactly this.
       *
       * One record read once. Card 2 renders it as controls and Card 3 renders
       * it as prose, so the two cannot disagree about what the document does —
       * which they would the moment either derived its own copy.
       */
      presentation: {
        layout: "tier_table" | "single_tier";
        detailLevel: "itemized" | "turnkey_only";
        presentedTierId: string | null;
        includeFeeLines: boolean;
        includeTerms: boolean;
        includeAddendum: boolean;
        includeNote: boolean;
        /** Tier ids the operator has hidden. Absence means shown. */
        hiddenTierIds: string[];
        /** The note's text, from its one owner. Card 2 edits it there. */
        customerNote: string | null;
        /** Whether a profile row exists yet; false means every value is a default. */
        stored: boolean;
        /**
         * EVERY tier, including the hidden ones.
         *
         * Card 2's visibility toggles must list what the operator can show as
         * well as what they can hide. Sourcing them from the returned `view`
         * would list only the VISIBLE tiers — the ones that survived
         * `applyTierVisibility` — so hiding a tier would remove its own toggle
         * and there would be no way back. A one-way door built out of a filter
         * applied one step too early.
         */
        allTiers: { id: string; label: string; quantity: number; recommended: boolean }[];
      };
      /**
       * Card 0 · the read-only mirror.
       *
       * Per D5 the authority's "Approved recovery" IS the governed
       * `recoverableSell` — translated into the authority's vocabulary here,
       * not minted as a second record. NULL stays null: an unresolved recovery
       * renders as words, never as $0 (BV-013).
       */
      governed: {
        goodsSell: number | null;
        chargesAtCost: number | null;
        approvedRecovery: number | null;
        floorMarginPct: number;
        targetMarginPct: number;
        recommendedTierLabel: string | null;
      };
    }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "bundle_error"; message: string };


export async function resolveCustomerView(args: {
  quoteId: string;
  searchParams?: CustomerViewSearchParams;
  commercialSettingsOverride?: CommercialSettingsResolution;
  /**
   * A candidate recovery election set to evaluate INSTEAD of the persisted one.
   *
   * The whole projection is then built from it — the customer document, the
   * recovery rows, the rollups — so an operator exploring an election sees the
   * governed consequence of THAT election before anything is written.
   *
   * Absent on every ordinary render, which reads what is stored.
   */
  proposedElections?: ProposedElections;
}): Promise<ResolveCustomerViewResult> {
  const { quoteId, searchParams = {}, commercialSettingsOverride, proposedElections } = args;
  const { layout, detail, addendum } = searchParams;

  // Quote + project join. Consumer validates projectId separately
  // when it has one from the route (page.tsx does; api route doesn't).
  const quoteRows = await db
    .select({ quote: quotes, project: projects })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) return { ok: false, kind: "not_found" };
  const { quote, project } = quoteRows[0];

  // ── ONE WAVE, NOT FIVE ROUND TRIPS ─────────────────────────────────────
  //
  // These five reads are independent of each other. They were sequential, and
  // each is a round trip to the database region, so the page render paid for
  // all five one after another.
  //
  // That cost is not abstract: it is what an operator waits through after
  // electing a recovery treatment. The election writes in ~850ms and then the
  // whole page re-renders before anything on screen moves, so every avoidable
  // round trip in this function is time the control sits looking broken.
  //
  // Measured on production, click to visible document change: 2229 / 2468 /
  // 1738 / 1652 ms before three of these reads existed, and 4041 / 3011 / 2997
  // ms after I added them sequentially. The regression was mine.
  //
  // `getCostingBundle` stays OUTSIDE this wave, deliberately. It runs its own
  // 8-wide Promise.all internally, and nesting it inside another one makes the
  // demands additive against a pool of 3 — the documented failure that turns a
  // 2s render into a hang. Sequencing caps peak demand at max(5, 8) instead of
  // 13.
  const [firmRows, profileRows, hiddenTierRows, authorizationRows, addendumData] =
    await Promise.all([
      db
        .select()
        .from(firmSettings)
        .where(isNull(firmSettings.effectiveUntil))
        .orderBy(desc(firmSettings.effectiveFrom))
        .limit(1),
      // The presentation profile for THIS version. Keyed
      // `(quote_id, quote_version)`: a revision bumps the version and copies
      // the row forward, so reading the current version is what makes a
      // revision continue the conversation the customer is already part of
      // rather than start from defaults. Absent for a quote created between
      // the migration and its first edit, which is why every read below falls
      // back to the column's own default — absence and default are the same
      // document.
      db
        .select()
        .from(presentationProfile)
        .where(
          and(
            eq(presentationProfile.quoteId, quoteId),
            eq(presentationProfile.quoteVersion, quote.versionNumber),
          ),
        )
        .limit(1),
      // Hidden tiers only. ABSENCE MEANS SHOWN, so a quote that has hidden
      // nothing reads zero rows and every tier is presented — including a tier
      // added after the profile was written, which is what keeps a new tier
      // from being silently withheld from a customer.
      db
        .select({ tierId: presentationProfileTier.tierId })
        .from(presentationProfileTier)
        .where(
          and(
            eq(presentationProfileTier.quoteId, quoteId),
            eq(presentationProfileTier.quoteVersion, quote.versionNumber),
            eq(presentationProfileTier.shown, false),
          ),
        ),
      // Below-floor authorizations, for the verdict the footer and the send
      // gate share.
      db
        .select({
          id: belowFloorAuthorizations.id,
          quoteVersionNumber: belowFloorAuthorizations.quoteVersionNumber,
          tierId: belowFloorAuthorizations.tierId,
          approvedByUserId: belowFloorAuthorizations.approvedByUserId,
          stateFingerprint: belowFloorAuthorizations.stateFingerprint,
          invalidatedAt: belowFloorAuthorizations.invalidatedAt,
        })
        .from(belowFloorAuthorizations)
        .where(eq(belowFloorAuthorizations.quoteId, quoteId)),
      loadQuoteAddendum(quoteId),
    ]);

  const firm = firmRows[0] ?? null;
  const profile = profileRows[0];
  const hiddenTierIds = new Set(hiddenTierRows.map((r) => r.tierId));

  const bundle = await getCostingBundle(
    quoteId,
    commercialSettingsOverride,
    proposedElections,
  );
  if (!bundle.ok) {
    return { ok: false, kind: "bundle_error", message: bundle.error.message };
  }

  // Sequential, deliberately: `getCostingBundle` runs an 8-wide `Promise.all`
  // internally, and nesting this inside one would add to that peak rather than
  // cap it. One extra small read after the bundle costs nothing measurable.
  const chargeReadiness = await readComponentChargeReadiness(quoteId);

  /**
   * Which rollups OWN their charges, rather than carrying a merge of their
   * children's.
   *
   * Defined once and passed to both readers. When they each built their own,
   * one of them omitted it entirely and the workspace reported double the
   * governed recovery on the operator's surface.
   */
  const ownsItsCharges = (skuId: string) =>
    ((bundle.data.skus ?? []) as { id: string; skuRole?: string }[]).some(
      (s) => s.id === skuId && s.skuRole === "leaf",
    );

  // Projected ONCE, here, so the rendering and the freeze below are two views
  // of one construction rather than two constructions.
  const readInstructions = projectRecoveryInstructionsForRead(
    bundle.data.costing,
    ownsItsCharges,
  );

  const embeddedRecoveryByTier = (() => {
    const byTier = new Map<string, number | null>();
    for (const rollup of bundle.data.costing.skuRollups ?? []) {
      if (!ownsItsCharges(rollup.skuId)) continue;
      for (const cell of rollup.perTier ?? []) {
        const prior = byTier.get(cell.tierId);
        if (prior === null) continue; // already unattributable
        const v = cell.embeddedRecoveryTotal;
        byTier.set(cell.tierId, v === null ? null : (prior ?? 0) + v);
      }
    }
    return byTier;
  })();

  const vendor: CustomerViewVendor = {
    name: firm?.vendorName ?? VENDOR_FIXTURE.name,
    sub: firm?.vendorTagline ?? VENDOR_FIXTURE.sub,
    address: firm?.vendorAddress ?? VENDOR_FIXTURE.address,
  };

  const isSent = quote.status !== "draft";
  const quoteNumber = isSent ? quote.quoteNumber : null;
  // C.1 — payment terms are a COMMERCIAL COMMITMENT and need an authority.
  //
  // Sent quotes render their frozen snapshot, unchanged, forever: the term that
  // was actually promised. Only drafts resolve live, and they resolve against
  // the customer's governed NetSuite Terms record — not the firm-wide default,
  // which has no customer dimension and disagreed with all 9 verified customers
  // (5 of them materially).
  //
  // When the governed value cannot be resolved the draft still renders, marked
  // `provisional`, because a PM needs to see the quote taking shape. Send is
  // where that becomes intolerable, and `sendQuote` fails closed there.
  const governedTerms = isSent
    ? null
    : await resolveGovernedPaymentTerms(project.hubspotDealId);
  const paymentTerms = isSent
    ? quote.paymentTermsSnapshot
    : governedTerms?.status === "governed"
      ? governedTerms.value
      : (firm?.paymentTermsDefault ?? null);
  /** How much weight the rendered term can carry. Sent = frozen promise. */
  const paymentTermsSource: "frozen" | "governed" | "provisional" = isSent
    ? "frozen"
    : governedTerms?.status === "governed"
      ? "governed"
      : "provisional";
  const leadTime = isSent
    ? quote.leadTimeSnapshot
    : (firm?.leadTimeDefault ?? null);
  const incoterms = isSent
    ? quote.incotermsSnapshot
    : (firm?.incotermsDefault ?? null);
  const tcs = isSent ? quote.tcsSnapshot : (firm?.tcsDefault ?? null);

  // PreparedBy resolution — draft: live; sent+: snapshot. DEC-8.
  let preparedBy: CustomerViewPreparedBy | null = null;
  if (isSent) {
    if (quote.preparedByEmailSnapshot && quote.preparedByNameSnapshot) {
      preparedBy = {
        name: quote.preparedByNameSnapshot,
        email: quote.preparedByEmailSnapshot,
        phone: quote.preparedByPhoneSnapshot,
      };
    }
  } else {
    if (project.salesRepUserId) {
      const [rep] = await db
        .select({ name: users.name, email: users.email, phone: users.phone })
        .from(users)
        .where(eq(users.id, project.salesRepUserId))
        .limit(1);
      if (rep && rep.email) {
        preparedBy = {
          name: rep.name ?? rep.email,
          email: rep.email,
          phone: rep.phone,
        };
      }
    }
    if (!preparedBy && project.hubspotOwnerId) {
      const { hubspot } = await getApplicationDependencies();
      const owner = await hubspot.findOwnerById(project.hubspotOwnerId);
      if (owner && owner.email) {
        preparedBy = {
          name: owner.name ?? owner.email,
          email: owner.email,
          phone: null,
        };
      }
    }
  }

  const tierBase = bundle.data.costing.tiers.map((t) => ({
    id: t.tierId,
    label: t.label,
    quantity: t.qty,
  }));

  // ── THE SHARED COMMERCIAL PROJECTION ─────────────────────────────────
  //
  // Both halves of the customer-facing commercial statement — the priced unit
  // lines and the separately billed one-time charges — come from
  // `projectCommercial`, which the snapshot writer also consumes.
  //
  // This resolver used to build both itself. That is how the PDF and the
  // Sales Order came to disagree about allocation-OFF fees while each stayed
  // internally consistent: two correct constructions of two different
  // statements. Reconstructing them separately and comparing afterwards
  // cannot fix that, because the comparison is only ever as good as the pair
  // of reconstructions. Sharing the producer makes the agreement structural.
  const projection = projectCommercial(bundle.data);
  const unitLines = projection.lines.filter((l) => l.kind !== "otc");

  const skus: CustomerViewSku[] = unitLines.map((line) => {
    const tierPrices = line.cells.map((c) =>
      c.state === "priced" ? c.unitRate : null,
    );
    const allPriced = tierPrices.every((p) => p !== null);
    const allEqual = allPriced && tierPrices.every((p) => p === tierPrices[0]);
    const shape: CustomerViewSku["shape"] = !allPriced
      ? "partial"
      : allEqual
        ? "flat"
        : "step↓";
    return {
      label: line.displaySku ?? "",
      name: line.displayName,
      pack: null,
      unitsPerPack: 1,
      // Threaded from the projection's structural field. The resolver does not
      // decide multiplicity and does not compute it.
      multiplicityPerUnit: line.memberMultiplicity,
      tierPrices,
      // THE GOVERNED EXTENSION, CONSUMED -- never recomposed here.
      //
      // This called `composeLineTotals(tierPrices, tierQuantities)`, which
      // multiplied the rate by the TIER's quantity. That is the tier's fact,
      // not the line's: a member consumed q times per finished unit bills at
      // `tierQty x qtyPerParent`, and `projectCommercial` already resolved
      // that into `cell.quantity` and `cell.lineAmount`.
      //
      // The substitution was invisible for as long as every member carried
      // qtyPerParent = 1, which made `tierQty === cell.quantity` and the two
      // constructions agree by coincidence (Pattern 56). The first member in
      // the estate to carry 2 shorted its line -- and the tier total -- by
      // exactly one multiple of the rate, UNDER-billing the customer against
      // a Sales Order that books the correct quantity from the freeze.
      //
      // The comment above says sharing the producer makes the agreement
      // structural. It only does if this consumes what that produced. Rate is
      // still read for presentation; the money is read, not rebuilt.
      tierLineTotals: line.cells.map((c) =>
        c.state === "priced" ? c.lineAmount : null,
      ),
      shape,
    };
  });



  // Real recommendedTierIdx from quote_tiers.recommended (Step 4.3).
  const tierRecommendedRows =
    tierBase.length > 0
      ? await db
          .select({
            id: quoteTiers.id,
            recommended: quoteTiers.recommended,
          })
          .from(quoteTiers)
          .where(eq(quoteTiers.quoteId, quote.id))
      : [];
  const recommendedTierId =
    tierRecommendedRows.find((t) => t.recommended)?.id ?? null;
  // NO RECOMMENDATION IS A REAL ANSWER, AND THE ONLY HONEST ONE HERE.
  //
  // This fell back to `Math.floor(tiers.length / 2)` — the middle tier — when
  // no tier carried the flag. On a four-tier quote with every
  // `quote_tiers.recommended` false, the customer document highlighted Tier 3
  // and told the customer "Tier 3 is recommended for first-PO production runs."
  // The firm had made no such recommendation. Pricing said "None chosen" the
  // whole time; the disagreement was not two surfaces reading differently, it
  // was this one inventing an answer.
  //
  // A recommendation is a commercial claim. It comes from the flag or it does
  // not exist, and it is never inferred from tier order.
  const idx = recommendedTierId
    ? tierBase.findIndex((t) => t.id === recommendedTierId)
    : -1;
  const recommendedTierIdx = idx === -1 ? null : idx;

  // ── SEPARATELY BILLED ONE-TIME CHARGES ───────────────────────────────
  //
  // Per tier, from the shared projection. Two folds are gone with it:
  //
  //   • MAX-across-tiers on the AMOUNT. A fee entered against one tier was
  //     billed at every tier. Invisible while fees were tier-invariant, and
  //     wrong the moment a frozen line has to reconcile to an accepted total,
  //     because the figure would be attributed to a tier that never produced
  //     it.
  //
  //   • OR-across-tiers on ALLOCATION. One allocated tier suppressed the fee
  //     lines for all of them. The guard was against double-billing, which is
  //     real — but it is a per-tier question, and answering it per tier
  //     prevents the same double-count without silencing the tiers that
  //     genuinely bill separately.
  //
  // The amounts also now carry the governed Production markup (BV-013);
  // previously separately billed OTC left the firm at cost.
  const serviceFees: CustomerViewServiceFee[] = projection.lines
    .filter((l) => l.kind === "otc")
    .map((l) => ({
      id: l.key,
      // Threaded, not derived. `id` is `otc:instance:<uuid>` for a component
      // charge today, and a reader tempted to parse it would be reconstructing
      // an identity from a display key — the shape OD-028 warns about.
      chargeInstanceId: l.chargeInstanceId ?? null,
      scope: "sku" as const,
      skuLabel: l.displaySku ?? undefined,
      label: l.displayName,
      sub: l.displaySub ?? "",
      tierAmounts: l.cells.map((c) => (c.state === "priced" ? c.lineAmount : null)),
      qtyLabel: l.displayQtyLabel ?? "1",
    }));

  // Placed AFTER `serviceFees` deliberately. It reads them, and `.map()`
  // runs immediately -- referencing a `const` declared further down is a
  // TDZ ReferenceError at runtime. TypeScript does not catch it, because
  // the reference sits inside a callback and it cannot prove when the
  // callback runs; `tsc --noEmit` was clean on exactly that crash.
  // ── THE TIER'S MONETARY FACTS ────────────────────────────────────────
  //
  // Lifted out of `customer-pdf-helpers.ts`, where they were computed at render
  // time and made the PDF an authority over customer economics. The litmus:
  // if the PDF disappeared tomorrow, a tier's total and its displayed unit
  // price would still have to exist for Customer View. Pagination would not.
  //
  // COMPOSITION, NOT PRICING. Every figure below is a sum or a quotient of
  // values this projection already carries. No rate is looked up, no markup is
  // decided, no recovery treatment is resolved — those happened upstream in
  // governed code and arrive here settled.
  //
  // Accumulated in SKU order, and fees added after goods, because that is the
  // order the lifted implementation used. A sum reordered is a sum changed at
  // the last decimal place, and these figures are asserted bit-for-bit against
  // the pre-lift baseline.
  const tiers: CustomerViewTier[] = tierBase.map((t, ti) => ({
    ...t,
    money: composeTierMoney({
      quantity: t.quantity,
      lineTotals: skus.map((sku) => sku.tierLineTotals[ti]),
      feeAmounts: serviceFees.map((f) => f.tierAmounts[ti]),
      embeddedRecovery: embeddedRecoveryByTier.get(t.id) ?? null,
    }),
  }));

  // BV-009: freight remains in commercial costing. When bundled into unit
  // price it has no separate customer-facing line, avoiding double signaling.
  const freightLines: [] = [];

  // The governed landed-logistics reading, for the tier the document is about.
  //
  // Recomputes nothing: `landedLogisticsForTier` selects from the rollup the
  // costing layer already produced. Keyed to the RECOMMENDED tier because that
  // is the tier the customer document quotes and the operator is about to send;
  // a figure taken from some other tier would be a true number about the wrong
  // thing.
  const landedTierId =
    recommendedTierIdx !== null ? (tiers[recommendedTierIdx]?.id ?? null) : null;
  const landedLogistics = landedLogisticsForTier({
    rollup:
      landedTierId === null
        ? null
        : (bundle.data.costing.quoteRollup.find((r) => r.tierId === landedTierId) ?? null),
    separateFreightLineCount: freightLines.length,
  });

  // #431 Step 2 — the customer's CURRENTLY sourced identity, for drafts.
  //
  // Declared here, before the object that reads it: this file has shipped a
  // temporal-dead-zone bug twice, and the class is invisible to tsc and to the
  // unit suite.
  //
  // Skipped entirely on sent quotes — they read frozen, so the query would be
  // work whose result is discarded.
  let sourcedIdentity: { contact: string | null; role: string | null; address: string | null } | null = null;
  if (!isSent && project.hubspotDealId) {
    const [cached] = await db
      .select({
        contactName: hubspotDealsCache.customerContactName,
        contactTitle: hubspotDealsCache.customerContactTitle,
        line1: hubspotDealsCache.companyAddressLine1,
        line2: hubspotDealsCache.companyAddressLine2,
        city: hubspotDealsCache.companyCity,
        state: hubspotDealsCache.companyState,
        postalCode: hubspotDealsCache.companyPostalCode,
        country: hubspotDealsCache.companyCountry,
      })
      .from(hubspotDealsCache)
      .where(eq(hubspotDealsCache.dealId, project.hubspotDealId))
      .limit(1);
    if (cached) {
      sourcedIdentity = {
        contact: cached.contactName,
        role: cached.contactTitle,
        address: composeAddress({
          line1: cached.line1,
          line2: cached.line2,
          city: cached.city,
          state: cached.state,
          postalCode: cached.postalCode,
          country: cached.country,
        }),
      };
    }
  }

  const view: CustomerView = {
    vendor,
    customer: {
      // #431 Step 1 — draft: live; sent+: snapshot. The same DEC-8 rule that
      // governs `preparedBy` above, applied to the party on the other side of
      // the document.
      //
      // Until now this read the live project name unconditionally, so renaming
      // the company in HubSpot re-addressed quotes that had already been sent.
      // The stored PDF was always safe; the read model was not, and it is what
      // every internal surface and audit query reads.
      //
      // The fallback is deliberate rather than defensive: quotes sent before
      // 0105 backfilled are covered by the migration, but a row that somehow
      // carries no snapshot should still render the best name available rather
      // than "{customer-pending}" on a real sent quote.
      name:
        (isSent ? quote.customerNameSnapshot : null) ??
        project.clientName ??
        "{customer-pending}",
      // #431 Step 2/3 — same frozen-first rule as the name above. On a draft
      // these come from the deal cache, sourced from HubSpot; at Finalize they
      // are frozen; a sent quote reads what was frozen.
      //
      // Every one of them may legitimately be null and renders as absent:
      //   - contact  — blank unless the governed selection rule picked someone
      //                (explicit primary, or exactly one association). Several
      //                contacts with no primary stays blank ON PURPOSE.
      //   - role     — HubSpot's jobtitle, which is frequently empty.
      //   - address  — the PRIMARY company's governed address.
      contact: (isSent ? quote.customerContactSnapshot : sourcedIdentity?.contact) ?? null,
      role: (isSent ? quote.customerRoleSnapshot : sourcedIdentity?.role) ?? null,
      // The customer's own email is deliberately NOT rendered. PREPARED BY
      // carries the seller's address so the customer can reply; showing the
      // customer their own address back adds nothing and puts a personal
      // address into a document that gets forwarded. It is cached for operator
      // surfaces, not printed here.
      email: null,
      address: (isSent ? quote.customerAddressSnapshot : sourcedIdentity?.address) ?? null,
    },
    quote: {
      quoteNumber,
      projectTitle: project.dealName,
      // Slice 11 Step 6 FU — local ISO date via Intl (Nexus
      // operates on America/Los_Angeles). Was
      // `.toISOString().slice(0, 10)` which returns UTC date;
      // late-evening PDT sends showed the next day's Issued.
      sentDate: quote.sentAt ? toLocalIsoDate(quote.sentAt) : null,
      validUntil: quote.validUntil,
      paymentTerms,
      paymentTermsSource,
      leadTime,
      // ── M2 · frozen once sent, like every field beside it ──────────────
      //
      // This was the ONE customer-facing text read live on a sent quote.
      // Payment terms, lead time, incoterms and T&Cs all branch here; the note
      // did not, so editing it after send restated a quote the customer
      // already held — their copy and this one simply stopped agreeing, with
      // nothing failing and nothing warning.
      //
      // The fallback to the live note is for quotes sent BEFORE the snapshot
      // column existed. Their true sent value is unrecoverable; the backfill
      // adopted the live note, so this reproduces exactly what they render
      // today rather than blanking a note the customer can see.
      customerFacingNotes: isSent
        ? (quote.customerFacingNotesSnapshot ?? quote.customerFacingNotes)
        : quote.customerFacingNotes,
      incoterms,
      tcs,
    },
    preparedBy,
    tiers,
    skus,
    serviceFees,
    freightLines,
    landedLogistics,
    recommendedTierIdx,
    // Decided once. Both renderers read it; neither re-derives it.
    feeBasisTierIdx: recommendedTierIdx ?? 0,
    // Same rule the adapter's `hasCharges` has always used, stated once here so
    // both renderers read it rather than each deriving it.
    foldFeesIntoTotal: serviceFees.length > 0 || freightLines.length > 0,
    // Snapshot-or-live reads per Step 4.4 brief §4:
    //   isSent ? quote.{col} : (searchParams.{param} ?? quote.{col} ?? default)
    // ── DRAFT AXES NOW HAVE A RECORD ───────────────────────────────────
    //
    // Precedence on a draft: searchParams, then the PROFILE, then the quote's
    // own snapshot columns.
    //
    // The profile is the new middle term and it is what closes G4's gap. Before
    // it, a draft's axes fell through to `quotes.*_snapshot` — the LAST SENT
    // values — so an operator's choices on an unsent quote survived only as URL
    // parameters and were gone on reload. Card 2 said so in as many words.
    //
    // searchParams still win, and still must: `sendQuote` passes the operator's
    // current toggles as parameters at send time, so the document that goes out
    // is the one on screen. The snapshot fallback stays for quotes that predate
    // the profile.
    pdfLayout: isSent
      ? (quote.pdfLayoutSnapshot ?? "tier_table")
      : layout === "tier_table" || layout === "single_tier"
        ? layout
        : (profile?.layout ?? quote.pdfLayoutSnapshot ?? "tier_table"),
    detailLevel: isSent
      ? (quote.detailLevelSnapshot ?? "itemized")
      : detail === "itemized" || detail === "turnkey_only"
        ? detail
        : (profile?.detailLevel ?? quote.detailLevelSnapshot ?? "itemized"),
    includeSpecAddendum: isSent
      ? (quote.includeSpecAddendumSnapshot ?? false)
      : addendum === "1" || addendum === "true"
        ? true
        : addendum === "0" || addendum === "false"
          ? false
          : (profile?.includeAddendum ?? quote.includeSpecAddendumSnapshot ?? false),
    // No searchParam override and no snapshot column for these three: they are
    // new with the profile, so the profile (or its default) is the only source.
    // A sent quote keeps rendering them at the default it was sent under, which
    // is what it was sent under.
    includeFeeLines: profile?.includeFeeLines ?? true,
    includeTerms: profile?.includeTerms ?? true,
    includeNote: profile?.includeNote ?? true,
  };



  // ── IN-UNIT-PRICE RECOVERY, PER TIER ───────────────────────────────────
  //
  // Summed over the rollups that OWN their charges - the same predicate the
  // recovery workspace uses. An assembly's rollup carries the MERGE of its
  // children's, so summing every rollup would count each charge twice, which
  // is exactly how this model once reported double the governed recovery on
  // the operator's surface.
  //
  // The value each rollup reports is what the LADDER embedded, computed where
  // the ladder's own operands live. Nothing is priced or re-derived here; this
  // adds up figures it is given.
  //
  // NULL propagates: one unattributable cell makes the tier unattributable. A
  // tier that summed only its attributable cells would print a number that
  // looks like the whole and is not - the failure this whole reconciliation
  // exists to prevent.

  // The floor verdict, evaluated exactly as the send gate evaluates it.
  //
  // Loaded unconditionally rather than behind an "is anything below floor"
  // guard: the projection needs the rows to decide, and a quote with nothing
  // below floor reads an empty set and returns ok. The gate keeps its
  // short-circuit because it runs on the write path where the query is worth
  // avoiding; a page render is already reading far more than this.
  const belowFloorProjection = projectBelowFloorAuthorization({
    rollups: bundle.data.costing.quoteRollup,
    authorizations: authorizationRows,
    quoteVersionNumber: quote.versionNumber,
  });

  // Recovery the quote cannot bill. Detected here, not re-derived: the send
  // gate calls this same function over this same constructed state, and a
  // second implementation would be free to disagree with the boundary about
  // whether the quote may go out.
  //
  // Declared before the return that reads it. This file has twice shipped a
  // read above its declaration, and the second one took down every quote page.
  // OD-032 · the charges elected for recovery that nobody has priced.
  //
  // Computed HERE, beside `unbillableRecovery`, for the same stated reason: the
  // send gate calls this same function, so the surface and the boundary cannot
  // disagree about whether the quote may go out. The operator learns it before
  // clicking Finalize rather than after.
  const chargeRecoveryPricingGaps = await readChargeRecoveryPricingGaps(quote.id);

  const unbillableRecovery = findUnbillablePlacements({
    skuRollups: bundle.data.costing.skuRollups,
    tierLabels: new Map(bundle.data.costing.quoteRollup.map((r) => [r.tierId, r.label])),
  });

  // Hidden tiers are removed HERE, once, so neither renderer has to skip
  // positions in six index-aligned arrays without ever getting it wrong. See
  // `customer-tier-visibility`.
  //
  // Applied after the view is fully composed, so nothing downstream of it is
  // recomputed: the figures that survive are the same objects they were.
  const presentedView = applyTierVisibility(view, [...hiddenTierIds]);

  return {
    ok: true,
    view: presentedView,
    addendumData,
    project,
    quote,
    quoteRollup: bundle.data.costing.quoteRollup,
    commercial: projection,
    /**
     * The recovery workspace's rows, built from THIS bundle read.
     *
     * Returned here rather than loaded by the page for the same reason
     * `commercial` is: the surface must read the construction the document was
     * built from, not an equivalent one from a second read. It also keeps the
     * page to a single `getCostingBundle` — the 8-wide fan-out is documented as
     * the connection pool's limit.
     */
    /**
     * The frozen recovery instruction, from THIS bundle read.
     *
     * Returned rather than rebuilt at send for the same reason `commercial` is:
     * the record Accounting later reads must be a projection of the
     * construction the customer document was built from, not an equivalent one
     * from a second read.
     */
    // READ, not commit. An unplaced charge is a legitimate state on a draft,
    // and this call happens on every page load — including the load of the
    // page where that charge gets placed.
    recoveryInstructions: readInstructions.instructions,
    unplacedRecoveryCharges: readInstructions.unplaced,
    // The freeze, over this same construction, refusing an unplaced charge as
    // it always has. Nothing calls it until something commits.
    freezeRecoveryInstructions: () =>
      projectFrozenInstructions(bundle.data.costing, ownsItsCharges),
    belowFloor: belowFloorProjection,
    unbillableRecovery,
    chargeRecoveryPricingGaps,
    // Live on a draft, frozen once sent - the same rule as every other quote
    // fact, and the reason is the same: Accounting acts on this after
    // acceptance, and it must describe the quote it was written for.
    accountingInstruction: isSent
      ? (quote.accountingInstruction ?? null)
      : (quote.accountingInstruction ?? null),
    presentation: {
      layout: profile?.layout ?? "tier_table",
      detailLevel: profile?.detailLevel ?? "itemized",
      presentedTierId: profile?.presentedTierId ?? null,
      includeFeeLines: profile?.includeFeeLines ?? true,
      includeTerms: profile?.includeTerms ?? true,
      includeAddendum: profile?.includeAddendum ?? false,
      includeNote: profile?.includeNote ?? true,
      hiddenTierIds: [...hiddenTierIds],
      // Read from the note's ONE owner. Card 2 edits that column; nothing here
      // holds a second copy of the text.
      customerNote: quote.customerFacingNotes,
      stored: profile !== undefined,
      // From the UNFILTERED view, deliberately — see the type.
      allTiers: view.tiers.map((t, i) => ({
        id: t.id,
        label: t.label,
        quantity: t.quantity,
        recommended: view.recommendedTierIdx === i,
      })),
    },
    recoveryRows: buildRecoveryWorkspace({
      // Structural state, read from the instance and tier tables. The costing
      // bundle cannot supply it: a charge with no economics was never
      // constructed, which is exactly why it used to appear nowhere.
      chargeEconomics: new Map(
        chargeReadiness.map((r) => [
          r.chargeInstanceId,
          {
            state: r.state,
            chargeKey: r.chargeKey as RecoveryChargeKey,
            ownLabel: r.ownLabel,
            // The causal owner, so an UNCOSTED sibling can be disambiguated on
            // the same footing as a placed one — two components may each label
            // their charge the same, and then only the owner separates them.
            quoteLeafId: r.quoteLeafId,
            missingTierLabels: r.missingTierLabels,
          },
        ]),
      ),
      costing: bundle.data.costing,
      isLeaf: ownsItsCharges,
      elections: bundle.data.chargeElections ?? [],
      // Component names, for collision-only labelling. Keyed by the CANONICAL
      // quote-leaf id, which is the causal owner a component charge carries —
      // never the anchor, which no row is given a label from.
      ownerNames: new Map(
        ((bundle.data.skus ?? []) as {
          canonicalQuoteLeafId?: string | null;
          productName?: string | null;
          skuLabel?: string | null;
        }[])
          .filter((k) => k.canonicalQuoteLeafId)
          .map(
            (k) =>
              [
                k.canonicalQuoteLeafId as string,
                k.productName || k.skuLabel || "",
              ] as const,
          )
          // An empty name is worse than none: it would render a label that says
          // nothing where the absence of one at least reads as unambiguous.
          .filter(([, name]) => name.length > 0),
      ),
      allocationStates: [
        ...new Set(
          ((bundle.data.production ?? []) as {
            allocateServiceFeesToCost?: boolean | null;
          }[]).map((r) => r.allocateServiceFeesToCost ?? true),
        ),
      ],
    }),
    governed: (() => {
      const rollups = bundle.data.costing.quoteRollup ?? [];
      // The recommended tier, or the last one — the authority shows goods sell
      // "· {recommended tier}" and needs a tier to name.
      // ── NO SURROGATE FOR THE RECOMMENDED TIER ────────────────────────
      //
      // Card 0's goods-sell row is scoped to the RECOMMENDED tier. An earlier
      // version fell back to the last rollup when no recommendation existed
      // and labelled it "Tier 4" — which reads as a governed choice and is
      // not one. "The last tier" and "the recommended tier" are different
      // facts, and substituting one for the other is the shape of error this
      // surface exists to avoid.
      //
      // With no recommendation the card states the absence and shows no
      // tier-scoped amounts, because every one of them needs a tier basis and
      // this quote has not named one. Making the recommendation authorable is
      // G4's job, and the empty state is what makes that visible.
      const recId =
        view.recommendedTierIdx === null
          ? null
          : (view.tiers[view.recommendedTierIdx]?.id ?? null);
      const rec = recId
        ? (rollups.find((t: { tierId: string }) => t.tierId === recId) ?? null)
        : null;

      let cost = 0;
      let recovery: number | null = 0;
      for (const rollup of bundle.data.costing.skuRollups ?? []) {
        if (!ownsItsCharges(rollup.skuId)) continue;
        for (const pt of rollup.perTier ?? []) {
          if (rec && pt.tierId !== rec.tierId) continue;
          const c = pt.constructed;
          if (!c) continue;
          cost += c.totalChargeCost;
          // NULL propagates. A total containing an unknown is unknown, and
          // reporting it as a number would state a figure nothing governs.
          recovery =
            recovery === null || c.totalChargeRevenue === null
              ? null
              : recovery + c.totalChargeRevenue;
        }
      }

      return {
        // Goods sell is tier revenue less what the charges contributed.
        goodsSell:
          rec && recovery !== null ? rec.totalRevenue - recovery : null,
        // Both are per-tier in this model — a setup fee differs by tier — so
        // without a named tier neither can be stated either.
        chargesAtCost: rec ? cost : null,
        approvedRecovery: rec ? recovery : null,
        floorMarginPct: bundle.data.firmSettings.floorMarginPct,
        targetMarginPct: bundle.data.firmSettings.targetMarginPct,
        recommendedTierLabel: rec?.label ?? null,
      };
    })(),
  };
}
