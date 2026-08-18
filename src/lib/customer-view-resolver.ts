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

import { desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { firmSettings, projects, quotes, quoteTiers, users } from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { projectCommercial } from "@/lib/commercial-projection";
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
    }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "bundle_error"; message: string };


export async function resolveCustomerView(args: {
  quoteId: string;
  searchParams?: CustomerViewSearchParams;
  commercialSettingsOverride?: CommercialSettingsResolution;
}): Promise<ResolveCustomerViewResult> {
  const { quoteId, searchParams = {}, commercialSettingsOverride } = args;
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

  const firmRows = await db
    .select()
    .from(firmSettings)
    .where(isNull(firmSettings.effectiveUntil))
    .orderBy(desc(firmSettings.effectiveFrom))
    .limit(1);
  const firm = firmRows[0] ?? null;

  const addendumData = await loadQuoteAddendum(quoteId);
  const bundle = await getCostingBundle(quoteId, commercialSettingsOverride);
  if (!bundle.ok) {
    return { ok: false, kind: "bundle_error", message: bundle.error.message };
  }

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

  const tiers: CustomerViewTier[] = bundle.data.costing.tiers.map((t) => ({
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
      tierPrices,
      shape,
    };
  });


  // Real recommendedTierIdx from quote_tiers.recommended (Step 4.3).
  const tierRecommendedRows =
    tiers.length > 0
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
    ? tiers.findIndex((t) => t.id === recommendedTierId)
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
      scope: "sku" as const,
      skuLabel: l.displaySku ?? undefined,
      label: l.displayName,
      sub: l.displaySub ?? "",
      tierAmounts: l.cells.map((c) => (c.state === "priced" ? c.lineAmount : null)),
      qtyLabel: l.displayQtyLabel ?? "1",
    }));

  // BV-009: freight remains in commercial costing. When bundled into unit
  // price it has no separate customer-facing line, avoiding double signaling.
  const freightLines: [] = [];

  const view: CustomerView = {
    vendor,
    customer: {
      name: project.clientName ?? "{customer-pending}",
      contact: null,
      role: null,
      email: null,
      address: null,
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
      customerFacingNotes: quote.customerFacingNotes,
      incoterms,
      tcs,
    },
    preparedBy,
    tiers,
    skus,
    serviceFees,
    freightLines,
    recommendedTierIdx,
    // Snapshot-or-live reads per Step 4.4 brief §4:
    //   isSent ? quote.{col} : (searchParams.{param} ?? quote.{col} ?? default)
    pdfLayout: isSent
      ? (quote.pdfLayoutSnapshot ?? "tier_table")
      : layout === "tier_table" || layout === "single_tier"
        ? layout
        : (quote.pdfLayoutSnapshot ?? "tier_table"),
    detailLevel: isSent
      ? (quote.detailLevelSnapshot ?? "itemized")
      : detail === "itemized" || detail === "turnkey_only"
        ? detail
        : (quote.detailLevelSnapshot ?? "itemized"),
    includeSpecAddendum: isSent
      ? (quote.includeSpecAddendumSnapshot ?? false)
      : addendum === "1" || addendum === "true"
        ? true
        : addendum === "0" || addendum === "false"
          ? false
          : (quote.includeSpecAddendumSnapshot ?? false),
  };

  return {
    ok: true,
    view,
    addendumData,
    project,
    quote,
    quoteRollup: bundle.data.costing.quoteRollup,
    commercial: projection,
  };
}
