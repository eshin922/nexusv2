import { notFound } from "next/navigation";
import Link from "next/link";
import { desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { firmSettings, projects, quotes, users } from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { ensureUser } from "@/lib/auth/ensure-user";
import { findHubspotOwnerById } from "@/lib/hubspot";
import { QuoteHost } from "@/components/quote/quote-host";
import { loadQuoteAddendum } from "@/lib/addendum-loader";
import { SurfaceChrome } from "@/components/nav/surface-chrome";
import { recordSurfaceVisit } from "@/app/actions/surface-visits";
import { VENDOR_FIXTURE } from "@/lib/quote-fixtures";
import type {
  CustomerView,
  CustomerViewPreparedBy,
  CustomerViewSku,
  CustomerViewTier,
  CustomerViewVendor,
} from "@/types/quote";

// Slice RI.6 — Quote page (visual shell + boundary-guard
// build invariant per brief §3.7).
// Slice RI.7 — wires real firm_settings live reads + per-quote
// snapshots into the data shape. Draft quotes preview against current
// firm defaults; sent+ quotes render the immutable snapshot captured
// by sendQuote.
//
// Slice 10 fills LRR + recommended-tier wiring; Slice 11 ships PDF
// render path + send-from-customer-view action.

export default async function CustomerViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; quoteId: string }>;
  searchParams: Promise<{ dev?: string }>;
}) {
  // 2026-06-17 prod-hang Vercel-side instrumentation (see
  // costs/page.tsx for full rationale). Quote umbrella also runs
  // getCostingBundle + addendum loader + PDF render tree (heavy on
  // memory if a quote has many SKUs).
  const t0 = Date.now();
  const heapMb = () =>
    Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
  const elapsed = () => `${Date.now() - t0}ms`;
  const { id: projectId, quoteId } = await params;
  const { dev } = await searchParams;
  const tag = quoteId.slice(0, 8);
  console.log(`[quote:${tag}] start memory=${heapMb()}MB`);

  try {
  // Slice RI.9 §6 step 9 — record surface visit for Home Resume card.
  await recordSurfaceVisit({
    projectId,
    quoteId,
    surfaceKey: "customer_view",
  });
  console.log(`[quote:${tag}] post-auth ${elapsed()} memory=${heapMb()}MB`);

  // Load quote, project, firm_settings (current), and costing bundle.
  // firm_settings is needed for both the vendor identity (live render)
  // and the customer-facing-defaults (draft-preview source).
  //
  // Note: getCostingBundle is heavy (8 inner queries via Promise.all).
  // Run AFTER the lightweight metadata load so we don't compound the
  // pool demand. See CLAUDE.md "getCostingBundle parallel-query
  // discipline".
  const quoteRows = await db
    .select({ quote: quotes, project: projects })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) notFound();
  const { quote, project } = quoteRows[0];
  if (project.id !== projectId) notFound();
  console.log(`[quote:${tag}] post-meta ${elapsed()} memory=${heapMb()}MB`);

  const firmRows = await db
    .select()
    .from(firmSettings)
    .where(isNull(firmSettings.effectiveUntil))
    .orderBy(desc(firmSettings.effectiveFrom))
    .limit(1);
  const firm = firmRows[0] ?? null;

  // Phase A.1 v2 impl-6 — addendum data loader runs alongside the
  // costing bundle. Returns the typed shape for the addendum render
  // tree (Pattern 45 boundary-safe; types cross via QuoteAddendumData).
  // No prebuild verifier violation since the loader lives in src/lib/
  // (outside the boundary) and the page is also outside.
  const addendumData = await loadQuoteAddendum(quoteId);

  const bundle = await getCostingBundle(quoteId);
  console.log(`[quote:${tag}] post-bundle ${elapsed()} memory=${heapMb()}MB`);
  if (!bundle.ok) {
    console.log(
      `[quote:${tag}] pre-render(error) ${elapsed()} memory=${heapMb()}MB`,
    );
    return (
      <main style={{ padding: "32px 24px", maxWidth: 880, margin: "0 auto" }}>
        <div style={{ marginBottom: 16 }}>
          <SurfaceChrome
            surfaceKey="customer_view"
            segments={[]}
            breadcrumbTarget="customer_view"
            projectId={project.id}
            quoteId={quote.id}
          />
        </div>
        <h1>Quote unavailable</h1>
        <p style={{ color: "var(--bad)" }}>{bundle.error.message}</p>
      </main>
    );
  }

  // Vendor identity: always live from firm_settings; fallback to the
  // VENDOR_FIXTURE constant only if firm columns are NULL (shouldn't
  // happen post-migration 0020, but keeps the customer view from
  // rendering empty firm name on a misconfigured admin state).
  const vendor: CustomerViewVendor = {
    name: firm?.vendorName ?? VENDOR_FIXTURE.name,
    sub: firm?.vendorTagline ?? VENDOR_FIXTURE.sub,
    address: firm?.vendorAddress ?? VENDOR_FIXTURE.address,
  };

  // Status-based snapshot vs live resolution (CR-SM DEC-7 + DEC-8).
  // Drafts read firm_settings.*_default (preview of what would land
  // at send); sent+ read the immutable per-quote snapshot.
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

  // PreparedBy resolution: drafts → live (users join + HubSpot fallback);
  // sent+ → snapshot fields on quote row. Phone is always nullable per
  // CR-SM DEC-8 — PdfHeader omits the phone line entirely when null.
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
    // Draft preview: resolve live.
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
      const owner = await findHubspotOwnerById(project.hubspotOwnerId);
      if (owner && owner.email) {
        preparedBy = {
          name: owner.name ?? owner.email,
          email: owner.email,
          phone: null, // Owners API has no phone — verified.
        };
      }
    }
  }

  // Build the typed customer-view shape from costing data + resolved
  // status-aware values.
  const tiers: CustomerViewTier[] = bundle.data.costing.tiers.map((t) => ({
    id: t.tierId,
    label: t.label,
    quantity: t.qty,
  }));

  // Customer-visible SKUs are LEAF only (assemblies are internal grouping).
  const leafSkus = bundle.data.costing.skuRollups.filter(
    (r) => r.skuRole === "leaf",
  );

  const skus: CustomerViewSku[] = leafSkus.map((rollup) => {
    const skuMeta = bundle.data.skus.find((s) => s.id === rollup.skuId);
    const tierPrices = tiers.map((t) => {
      const pt = rollup.perTier.find((p) => p.tierId === t.id);
      return pt ? pt.requiredSellPerUnit : null;
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
      // Pack format not yet on quote_skus — Slice 11 schema add.
      // Until then `pack: null` triggers graceful-degradation in
      // PdfPricingTable (caption suppressed entirely) rather than
      // shipping a synthetic "{pack-format-pending}" string to real
      // customer PDFs. Same shape as `preparedBy.phone === null`
      // handling in PdfHeader (line 77). Pattern 45 (customer-
      // facing render data-source verification — promoted to
      // standing during the rest-of-app sweep, Step 10 audit).
      pack: null,
      unitsPerPack: 1,
      retailBenchmark: skuMeta?.retailBenchmark ?? null,
      tierPrices,
      shape,
    };
  });

  // Recommended tier: stubbed to middle tier as placeholder. Slice 10
  // wires real recommended-tier flag from costing/quote schema.
  const recommendedTierIdx =
    tiers.length > 0 ? Math.floor(tiers.length / 2) : null;

  const view: CustomerView = {
    vendor,
    customer: {
      // project.clientName is the customer name today; fuller customer
      // contact/role/address fields are HubSpot-side data not yet
      // imported into Nexus schema (Slice 11).
      name: project.clientName ?? "{customer-pending}",
      contact: null,
      role: null,
      address: null,
    },
    quote: {
      quoteNumber,
      sentDate: quote.sentAt ? quote.sentAt.toISOString().slice(0, 10) : null,
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
    serviceFees: [],
    freightLines: [],
    recommendedTierIdx,
    pdfLayout: "tier_table",
  };

  const showStateSwitcher =
    dev === "1" || process.env.NODE_ENV !== "production";

  // Slice RI.7 — dev send stub gate. Two checks for safety:
  //   1. NODE_ENV !== 'production' — won't render in prod builds at all
  //   2. Admin role — even in dev, only admins see the affordance
  // Slice 11 replaces the entire stub with real PDF + email flow on
  // the existing Download buttons.
  const me = await ensureUser();
  const devSendEnabled =
    process.env.NODE_ENV !== "production" && me.role === "admin";

  console.log(`[quote:${tag}] pre-render ${elapsed()} memory=${heapMb()}MB`);
  return (
    <>
      {/* Slice RI.9 § 3.2 — <Breadcrumb> via <SurfaceChrome>.
          Customer view is rail-shed (Rule B: print-preview metaphor
          melts chrome); breadcrumb compensates. SurfaceChrome reads
          `shouldShowBreadcrumb("customer_view") === true` from
          SURFACE_META and renders the Breadcrumb primitive. Step 11
          audit fix HIGH-2 — wires the previously dead-code helper
          into a real caller so the XOR rule is structurally
          enforced. */}
      <div style={{ padding: "16px 24px 0" }}>
        <SurfaceChrome
          surfaceKey="customer_view"
          segments={[]}
          breadcrumbTarget="customer_view"
          projectId={project.id}
          quoteId={quote.id}
        />
      </div>
      <QuoteHost
        view={view}
        quoteId={quote.id}
        quoteStatus={quote.status}
        showStateSwitcher={showStateSwitcher}
        devSendEnabled={devSendEnabled}
        internalNotes={quote.internalNotes}
        addendumData={addendumData}
      />
    </>
  );
  } catch (e) {
    console.error(`[quote:${tag}] FAIL ${elapsed()} memory=${heapMb()}MB`, e);
    throw e;
  }
}
