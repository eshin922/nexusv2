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
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { loadQuoteAddendum } from "@/lib/addendum-loader";
import { toLocalIsoDate } from "@/lib/local-date";
import { VENDOR_FIXTURE } from "@/lib/quote-fixtures";
import type { QuoteAddendumData } from "@/lib/addendum-loader";
import type {
  CustomerView,
  CustomerViewFreightLine,
  CustomerViewPreparedBy,
  CustomerViewServiceFee,
  CustomerViewSku,
  CustomerViewTier,
  CustomerViewVendor,
} from "@/types/quote";

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
    }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "bundle_error"; message: string };

// Slice 11 Step 5.1 — service-fee copy hardcoded per column-type
// (Q2 disposition). Firm-wide copy; refine via commit if wording
// shifts. Same map used at both preview and sendQuote paths.
const FEE_COPY = [
  {
    field: "setupFeeTotal" as const,
    label: "Setup",
    sub: "One-time setup — filling-line, dye-cuts, plates.",
    qtyLabel: "1 (setup)",
  },
  {
    field: "toolingArtworkTotal" as const,
    label: "Tooling & artwork",
    sub: "One-time tooling + artwork.",
    qtyLabel: "1 (tooling)",
  },
  {
    field: "rdTotal" as const,
    label: "R&D",
    sub: "One-time R&D work.",
    qtyLabel: "1 (R&D)",
  },
  {
    field: "otherServiceTotal" as const,
    label: "Other services",
    sub: "One-time other services.",
    qtyLabel: "1 (services)",
  },
];

export async function resolveCustomerView(args: {
  quoteId: string;
  searchParams?: CustomerViewSearchParams;
}): Promise<ResolveCustomerViewResult> {
  const { quoteId, searchParams = {} } = args;
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
  const bundle = await getCostingBundle(quoteId);
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
  const paymentTerms = isSent
    ? quote.paymentTermsSnapshot
    : (firm?.paymentTermsDefault ?? null);
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

  const leafSkus = bundle.data.costing.skuRollups.filter(
    (r) => r.skuRole === "leaf",
  );

  const skus: CustomerViewSku[] = leafSkus.map((rollup) => {
    const tierPrices = tiers.map((t) => {
      const pt = rollup.perTier.find((p) => p.tierId === t.id);
      if (!pt) return null;
      // Slice 11 Step 8 matrix smoke Cluster 2A fix (2026-07-27) —
      // treat cells with zero revenue AND zero contribution cost as
      // UNPRICED (null), not as "computed sell price = $0.00". The
      // math layer returns numeric 0 when a leaf has no cost data;
      // downstream render tree treats null as the "quote on request"
      // / "from $X" / "total on request" signal per shape. Same
      // isMissing check the pricing-classifier context already
      // applies (see pricing-classifier-context.tsx:281-282). Both
      // adapters must agree on what "unpriced" looks like or the
      // customer PDF renders $0.00 where CD's placeholder should
      // appear.
      if (pt.requiredSellPerUnit === 0 && pt.contributionCostPerUnit === 0) {
        return null;
      }
      return pt.requiredSellPerUnit;
    });
    const allPriced = tierPrices.every((p) => p !== null);
    const allEqual =
      allPriced && tierPrices.every((p) => p === tierPrices[0]);
    const shape: CustomerViewSku["shape"] = !allPriced
      ? "partial"
      : allEqual
        ? "flat"
        : "step↓";
    return {
      label: rollup.skuLabel,
      name: rollup.productName,
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
  const recommendedTierIdx =
    tiers.length === 0
      ? null
      : recommendedTierId
        ? (tiers.findIndex((t) => t.id === recommendedTierId) ?? -1) !== -1
          ? tiers.findIndex((t) => t.id === recommendedTierId)
          : Math.floor(tiers.length / 2)
        : Math.floor(tiers.length / 2);

  // Service-fee projection (Step 5.1). #78 eligibility carve —
  // COGS columns explicitly excluded.
  const skuById = new Map(bundle.data.skus.map((s) => [s.id, s]));
  const assemblyByLeafId = new Map<
    string,
    (typeof bundle.data.skus)[number]
  >();
  for (const s of bundle.data.skus) {
    if (s.skuRole === "leaf" && s.parentSkuId) {
      const asm = skuById.get(s.parentSkuId);
      if (asm && asm.skuRole === "assembly") {
        assemblyByLeafId.set(s.id, asm);
      }
    }
  }
  // Slice 11 matrix Fix 1b (2026-07-27) — aggregate across tier rows.
  //
  // Prior behavior: `productionByAssembly.set(assembly.id, p)` with
  // `if (!has)` guard kept ONLY the first tier row per assembly, then
  // read fees + allocate policy from that arbitrary row. Bug:
  // one-time fees (setup/tooling/rd/other) are semantically
  // per-assembly, but the schema stores them per-tier row. PMs
  // typing a fee on Tier 1 leaves Tier 2's row with null fees; if
  // the resolver picked Tier 2, fees vanished from the render.
  //
  // Fix: aggregate ALL tier rows for each assembly:
  //   - `allocateServiceFeesToCost`: AND-aggregate — if ANY tier
  //     says alloc=true (fold into cost), treat the assembly as
  //     alloc=true. Safer against double-counting: the math layer
  //     amortizes per-tier (each row's own alloc), so if any tier
  //     is amortizing, showing the fees as separate line items
  //     would present the fees twice on that tier's price.
  //   - Fee fields: COALESCE MAX per fee across tier rows. Since
  //     fees are conceptually per-assembly, whichever tier row
  //     PM populated is authoritative. MAX handles the transient
  //     state where a fresh tier row has null while a prior row
  //     has the value.
  //
  // Fix 1a in `assembly-production-inputs.ts` (INSERT branch policy
  // inheritance) prevents future rows from having conflicting
  // allocate policies. This resolver fix handles the current
  // pre-fix bad state + guards against future adapter drift.
  type ProdAggregate = {
    allocateServiceFeesToCost: boolean;
    setupFeeTotal: number | null;
    toolingArtworkTotal: number | null;
    rdTotal: number | null;
    otherServiceTotal: number | null;
  };
  const maxNum = (a: number | null, b: number | null): number | null => {
    if (a == null) return b;
    if (b == null) return a;
    return Math.max(a, b);
  };
  const aggByAssembly = new Map<string, ProdAggregate>();
  for (const p of bundle.data.production) {
    const assembly = assemblyByLeafId.get(p.quoteSkuId);
    if (!assembly) continue;
    const existing = aggByAssembly.get(assembly.id);
    if (!existing) {
      aggByAssembly.set(assembly.id, {
        allocateServiceFeesToCost: p.allocateServiceFeesToCost,
        setupFeeTotal: p.setupFeeTotal,
        toolingArtworkTotal: p.toolingArtworkTotal,
        rdTotal: p.rdTotal,
        otherServiceTotal: p.otherServiceTotal,
      });
    } else {
      existing.allocateServiceFeesToCost =
        existing.allocateServiceFeesToCost || p.allocateServiceFeesToCost;
      existing.setupFeeTotal = maxNum(existing.setupFeeTotal, p.setupFeeTotal);
      existing.toolingArtworkTotal = maxNum(
        existing.toolingArtworkTotal,
        p.toolingArtworkTotal,
      );
      existing.rdTotal = maxNum(existing.rdTotal, p.rdTotal);
      existing.otherServiceTotal = maxNum(
        existing.otherServiceTotal,
        p.otherServiceTotal,
      );
    }
  }
  const serviceFees: CustomerViewServiceFee[] = [];
  for (const [assemblyId, agg] of aggByAssembly) {
    if (agg.allocateServiceFeesToCost) continue;
    const assembly = skuById.get(assemblyId);
    if (!assembly) continue;
    for (const spec of FEE_COPY) {
      const value = agg[spec.field];
      if (value == null || value <= 0) continue;
      serviceFees.push({
        id: `${assemblyId}::${spec.field}`,
        scope: "sku",
        skuLabel: assembly.skuLabel,
        label: spec.label,
        sub: spec.sub,
        amount: value,
        qtyLabel: spec.qtyLabel,
      });
    }
  }

  // Pass-through freight projection (Step 5.2).
  const passThroughLegs = bundle.data.freightLegs.filter(
    (l) => l.treatment === "pass_through",
  );
  const freightLines: CustomerViewFreightLine[] = passThroughLegs.map((leg) => {
    const tierAmounts: number[] = tiers.map((t) => {
      for (const rollup of leafSkus) {
        const perTier = rollup.perTier.find((pt) => pt.tierId === t.id);
        if (!perTier) continue;
        const legBreak = perTier.freightLegs.find(
          (fb) => fb.legId === leg.id,
        );
        if (!legBreak) continue;
        return (
          legBreak.containerFreightWithMarkupPerUnit +
          legBreak.dutyWithMarkupPerUnit +
          legBreak.tariffWithMarkupPerUnit
        );
      }
      return 0;
    });
    return {
      id: leg.id,
      label: leg.label ?? "Freight",
      sub: "",
      qtyLabel: "Per unit · per shipment",
      tierAmounts,
    };
  });

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
  };
}
