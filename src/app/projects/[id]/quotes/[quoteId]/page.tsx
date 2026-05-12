import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  quotes,
  quoteSkus,
  quoteTiers,
  users,
} from "@/db/schema";
import { countPackagingLinesForQuote } from "@/app/actions/packaging";
import { countProductionCellsWithDataForQuote } from "@/app/actions/production";
import {
  countFreightCellsWithDataForQuote,
  countFreightLinesForQuote,
} from "@/app/actions/freight";
// Slice RI.8 step 1.5 — Pricing Control Summary moved off Setup
// per brief §5 + §3.5. getCostingBundle / CostingStoreProvider /
// QuoteSummaryCard imports dropped along with the CostingSummary
// helper component.
import { buildTreeRenderOrder, getEligibleParents } from "@/lib/sku-tree";
import { IdBadge } from "@/components/id-badge";
import { AddTierButton } from "./add-tier-button";
import { AddAssemblyButton } from "./add-assembly-button";
import { SkuRow } from "./sku-row";
import { SkuSearchPanel } from "./sku-search-panel";
import { TierRow } from "./tier-row";
import { NotesEditor } from "./notes-editor";
import { TierPresetSelect } from "./tier-preset-select";

// Slice RI.8 step 1 — token-backed status badges. Stock Tailwind
// `gray-*` / `blue-*` / `green-*` / `amber-*` / `red-*` palettes
// don't emit CSS under RI.0's @theme rebuild; mapped to project
// design tokens for visible rendering.
const STATUS_STYLES: Record<string, string> = {
  draft: "bg-paper-3 text-ink-2",
  sent: "bg-accent-soft text-accent-ink",
  accepted: "bg-good-soft text-good",
  superseded: "bg-warn-soft text-warn",
  lost: "bg-bad-soft text-bad",
};

export default async function QuoteBuilderPage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id: projectId, quoteId } = await params;

  const quoteRows = await db
    .select({
      quote: quotes,
      project: projects,
      pm: { name: users.name, email: users.email },
    })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .leftJoin(users, eq(users.id, projects.pmUserId))
    .where(eq(quotes.id, quoteId))
    .limit(1);

  if (quoteRows.length === 0) notFound();
  const { quote, project, pm } = quoteRows[0];
  if (project.id !== projectId) notFound(); // URL tampering

  const [skus, tiers] = await Promise.all([
    db
      .select()
      .from(quoteSkus)
      .where(eq(quoteSkus.quoteId, quote.id))
      .orderBy(asc(quoteSkus.sortOrder), asc(quoteSkus.createdAt)),
    db
      .select()
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quote.id))
      .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
  ]);

  const editable = quote.status === "draft";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-2 text-sm">
        <Link
          href={`/projects/${project.id}`}
          className="text-ink-3 hover:text-ink"
        >
          ← {project.dealName}
        </Link>
      </div>

      {/* Slice RI.8 step 1.5 — R1 page-head fidelity per
          source/round-1/app/setup.jsx lines 8-18 + styles.css
          .page-head / .page-title / .page-sub / .eyebrow. */}
      <header className="r1-setup-head">
        <div>
          <p className="r1-setup-eyebrow">
            Quote setup · {quote.scenarioLabel} v{quote.versionNumber}
          </p>
          <h1 className="r1-setup-title">
            Define <em>SKUs &amp; volume tiers</em>
          </h1>
          <p className="r1-setup-sub">
            Done once per quote. Tiers become first-class views — not
            duplicate columns of inputs.
            {project.clientName ? ` · ${project.clientName}` : ""}
            {pm?.name ? ` · PM ${pm.name}` : ""}
          </p>
          <div className="r1-setup-meta">
            <IdBadge id={quote.id} />
            <Badge
              className={STATUS_STYLES[quote.status] ?? STATUS_STYLES.draft}
            >
              {quote.status}
            </Badge>
            <span>created {quote.createdAt.toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Save draft — auto-save reinforcement; matches R1 line 15.
              Tooltip explains the auto-save model. */}
          <button
            type="button"
            className="r2-btn ghost"
            title="Saved automatically as you edit."
            disabled
          >
            Save draft
          </button>
          {/* Continue to cost build — primary CTA per R1 line 16. */}
          <Link
            href={`/projects/${project.id}/quotes/${quote.id}/cost-build`}
            className="r2-btn primary"
          >
            Continue to cost build →
          </Link>
        </div>
      </header>

      {!editable && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm text-warn"
        >
          This quote is <span className="font-mono">{quote.status}</span> and not
          editable.
        </div>
      )}

      {/* Slice RI.8 step 1.5 — R1 two-column setup grid. SKUs
          left (1.4fr), Volume tiers right (1fr) per R1 source.
          Notes section follows full-width below the grid. */}
      <div className="r1-setup-grid">

      {/* SKUs — referenced from HubSpot Products */}
      <Section title="SKUs">
        {editable && (
          <div className="border-b border-rule">
            <SkuSearchPanel
              quoteId={quote.id}
              eligibleParents={getEligibleParents(skus, null).map((p) => ({
                id: p.id,
                skuLabel: p.skuLabel,
                productName: p.productName,
                skuRole: p.skuRole,
              }))}
            />
            <div className="px-4 pb-3">
              <AddAssemblyButton
                quoteId={quote.id}
                eligibleParents={getEligibleParents(skus, null).map((p) => ({
                  id: p.id,
                  skuLabel: p.skuLabel,
                  productName: p.productName,
                  skuRole: p.skuRole as "leaf" | "assembly",
                }))}
              />
            </div>
          </div>
        )}
        {skus.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-3">
            {editable
              ? "Search HubSpot Products above to add the first SKU, or create a Nexus-local assembly."
              : "No SKUs."}
          </p>
        ) : (
          <>
            <SkuHeader />
            <div className="divide-y divide-rule">
              {buildTreeRenderOrder(skus).map(({ sku: s, depth }) => {
                const eligibleParents = getEligibleParents(skus, s.id).map((p) => ({
                  id: p.id,
                  skuLabel: p.skuLabel,
                  productName: p.productName,
                  skuRole: p.skuRole,
                }));
                const hasChildren = skus.some((x) => x.parentSkuId === s.id);
                return (
                  <SkuRow
                    key={s.id}
                    sku={{
                      id: s.id,
                      hubspotProductId: s.hubspotProductId,
                      skuLabel: s.skuLabel,
                      productName: s.productName,
                      unitsPerPack: s.unitsPerPack,
                      retailBenchmark: s.retailBenchmark,
                      notes: s.notes,
                      lastHubspotRefreshAt: s.lastHubspotRefreshAt,
                      skuRole: s.skuRole,
                      parentSkuId: s.parentSkuId,
                      qtyPerParent: s.qtyPerParent,
                    }}
                    depth={depth}
                    hasChildren={hasChildren}
                    eligibleParents={eligibleParents}
                    hubspotPortalId={process.env.HUBSPOT_PROD_HUB_ID ?? null}
                    disabled={!editable}
                  />
                );
              })}
            </div>
          </>
        )}
      </Section>

      {/* Tiers */}
      <Section
        title="Tiers"
        action={
          editable && (
            <div className="flex items-center gap-2">
              <TierPresetSelect
                quoteId={quote.id}
                existingTierCount={tiers.length}
                existingPackagingLineCount={await countPackagingLinesForQuote(quote.id)}
                existingProductionCellsWithData={await countProductionCellsWithDataForQuote(quote.id)}
                existingFreightLineCount={await countFreightLinesForQuote(quote.id)}
                existingFreightCellsWithData={await countFreightCellsWithDataForQuote(quote.id)}
              />
              <AddTierButton quoteId={quote.id} />
            </div>
          )
        }
      >
        {tiers.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-3">
            Add at least one tier to continue.
          </p>
        ) : (
          <>
            <TierHeader />
            <div className="divide-y divide-rule">
              {tiers.map((t, i) => (
                <TierRow
                  key={t.id}
                  tier={{ id: t.id, label: t.label, qty: t.qty }}
                  isFirst={i === 0}
                  isLast={i === tiers.length - 1}
                  disabled={!editable}
                />
              ))}
            </div>
          </>
        )}
      </Section>
      </div>
      {/* end .r1-setup-grid */}

      {/* Notes — full-width below the setup grid. R1 prototype
          doesn't include this surface (it was illustrative), so
          register matches the grid cards but the section spans
          full width as the canonical "internal + customer-facing"
          notes block. */}
      <Section title="Notes">
        <div className="p-[18px]">
          <NotesEditor
            quoteId={quote.id}
            internalNotes={quote.internalNotes}
            customerFacingNotes={quote.customerFacingNotes}
            disabled={!editable}
          />
        </div>
      </Section>

      {/* Slice RI.8 step 1.5 — `Cost inputs` Section block removed.
          The "Continue to cost build →" CTA now lives in the
          page-head action cluster per R1 source line 16. PMs
          have a single canonical path forward, not a redundant
          mid-page section.

          CostingSummary card removed entirely. Surface separation
          per brief §5 + §3.5: Pricing Control Summary lives on
          Costing Sheet only. Was a Slice 5/6/7-era convenience
          render; carried forward through RI.0-RI.7 unnecessarily.
          PMs reviewing margins navigate to Costing Sheet (via
          page-head Continue button or inner-rail). */}
    </main>
  );
}

// Slice RI.8 step 1 — CostInputLink helper removed. F-4 absorbed
// the three-column Cost inputs nav strip into a single
// "Continue to Cost build →" affordance.
//
// Slice RI.8 step 1.5 — Section helper now renders R1 card chrome
// per source/round-1/styles.css .card / .card-head / .card-body.
// Body is always flush (no internal padding); callers manage
// their own internal layout. mb-4 spacing between sections
// preserved.

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="r1-setup-card mb-4">
      <header className="r1-setup-card-head">
        <h3>{title}</h3>
        {action}
      </header>
      <div className="r1-setup-card-body flush">{children}</div>
    </section>
  );
}

function SkuHeader() {
  return (
    <div className="grid grid-cols-[1.4fr_2fr_0.9fr_0.6fr_0.7fr_1.4fr_auto] gap-2 border-b border-rule bg-paper-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-3">
      <span>SKU</span>
      <span>Product</span>
      <span>Type</span>
      <span>Units/pk</span>
      <span>Retail $</span>
      <span>Notes</span>
      <span className="text-right">Actions</span>
    </div>
  );
}

function TierHeader() {
  return (
    <div className="grid grid-cols-[2fr_1fr_auto] gap-2 border-b border-rule bg-paper-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-3">
      <span>Label</span>
      <span>Quantity</span>
      <span className="text-right">Actions</span>
    </div>
  );
}

function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
        className ?? ""
      }`}
    >
      {children}
    </span>
  );
}

// ReadOnlyNotes helper retained for future polish; not currently called.
// Slice RI.8 spot-fix updated styling to @theme tokens; rendering
// behavior unchanged.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ReadOnlyNotes({
  internal,
  customer,
}: {
  internal: string | null;
  customer: string | null;
}) {
  return (
    <div className="grid gap-3 text-sm">
      <div>
        <div className="mb-0.5 text-xs font-medium text-ink-2">
          Internal notes
        </div>
        <div className="whitespace-pre-wrap text-ink">
          {internal ?? <span className="text-ink-4">—</span>}
        </div>
      </div>
      <div>
        <div className="mb-0.5 text-xs font-medium text-ink-2">
          Customer-facing notes
        </div>
        <div className="whitespace-pre-wrap text-ink">
          {customer ?? <span className="text-ink-4">—</span>}
        </div>
      </div>
    </div>
  );
}
