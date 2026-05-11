import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, quotes } from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { CustomerViewHost } from "@/components/customer-view/customer-view-host";
import {
  VENDOR_FIXTURE,
  buildQuoteFixture,
} from "@/lib/customer-view-fixtures";
import type {
  CustomerView,
  CustomerViewSku,
  CustomerViewTier,
} from "@/types/customer-view";

// Slice RI.6 — Customer view page.
// Visual shell + boundary-guard build invariant per brief §3.7.
// Slice 10 fills LRR + recommended-tier wiring; Slice 11 ships PDF
// render path + send action + snapshot capture.

export default async function CustomerViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; quoteId: string }>;
  searchParams: Promise<{ dev?: string }>;
}) {
  const { id: projectId, quoteId } = await params;
  const { dev } = await searchParams;

  const quoteRows = await db
    .select({ quote: quotes, project: projects })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) notFound();
  const { quote, project } = quoteRows[0];
  if (project.id !== projectId) notFound();

  const bundle = await getCostingBundle(quoteId);
  if (!bundle.ok) {
    return (
      <main style={{ padding: "32px 24px", maxWidth: 880, margin: "0 auto" }}>
        <div style={{ marginBottom: 16, fontSize: 13 }}>
          <Link
            href={`/projects/${project.id}/quotes/${quote.id}`}
            style={{ color: "var(--ink-3)" }}
          >
            ← Quote builder
          </Link>
        </div>
        <h1>Customer view unavailable</h1>
        <p style={{ color: "var(--bad)" }}>{bundle.error.message}</p>
      </main>
    );
  }

  // Build the typed customer-view shape from costing data + stub fixtures.
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
    // Shape inference for visual treatment — flat / step↓ / partial.
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
      pack: "{pack-format-pending}",
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
    vendor: VENDOR_FIXTURE,
    customer: {
      // project.clientName is the customer name today; fuller customer
      // contact/role/address fields are HubSpot-side data not yet
      // imported into Nexus schema (Slice 11).
      name: project.clientName ?? "{customer-pending}",
      contact: null,
      role: null,
      address: null,
    },
    quote: buildQuoteFixture({
      customerFacingNotes: quote.customerFacingNotes,
      sentAt: quote.sentAt,
      validUntil: quote.validUntil,
    }),
    tiers,
    skus,
    serviceFees: [],
    freightLines: [],
    recommendedTierIdx,
    pdfLayout: "tier_table",
  };

  const showStateSwitcher =
    dev === "1" || process.env.NODE_ENV !== "production";

  return (
    <>
      <div style={{ padding: "12px 24px 0", fontSize: 13 }}>
        <Link
          href={`/projects/${project.id}/quotes/${quote.id}`}
          style={{ color: "var(--ink-3)" }}
        >
          ← Quote builder
        </Link>
        {" · "}
        <Link
          href={`/projects/${project.id}/quotes/${quote.id}/costing`}
          style={{ color: "var(--ink-3)" }}
        >
          Costing Sheet
        </Link>
      </div>
      <CustomerViewHost view={view} showStateSwitcher={showStateSwitcher} />
    </>
  );
}
