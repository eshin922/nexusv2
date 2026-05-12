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
import { getCostingBundle } from "@/app/actions/costing";
import { CostingStoreProvider } from "@/components/costing-store-provider";
import { QuoteSummaryCard } from "@/components/quote-summary-card";
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

      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {quote.scenarioLabel} · v{quote.versionNumber}
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            {project.clientName ?? "—"}
            {pm?.name && (
              <>
                {" · PM: "}
                <span className="text-ink-2">{pm.name}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IdBadge id={quote.id} />
          <Badge className={STATUS_STYLES[quote.status] ?? STATUS_STYLES.draft}>
            {quote.status}
          </Badge>
          <span className="text-xs text-ink-3">
            created {quote.createdAt.toLocaleDateString()}
          </span>
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

      {/* Notes */}
      <Section title="Notes">
        <div className="p-4">
          <NotesEditor
            quoteId={quote.id}
            internalNotes={quote.internalNotes}
            customerFacingNotes={quote.customerFacingNotes}
            disabled={!editable}
          />
        </div>
      </Section>

      {/* Slice RI.8 F-4 fix — replaces the legacy 3-column Cost
          inputs nav strip (which pointed at deprecated
          /packaging, /production, /freight routes RI.4 unified
          into one Cost Build page). Per brief §3.5 + R1 design
          source, this is now a single "Continue to Cost build →"
          affordance. The three legacy routes still redirect, so
          existing inbound links from elsewhere keep working —
          but PMs entering from Setup see the canonical IA. */}
      <Section title="Cost inputs">
        <div className="p-4">
          <Link
            href={`/projects/${project.id}/quotes/${quote.id}/cost-build`}
            className="r2-btn primary"
          >
            Continue to Cost build →
          </Link>
          <p className="mt-2 text-xs text-ink-3">
            Three sections (Packaging / Production / Freight) plus
            Bulk Raw, all feeding one cost stack. Drill into each
            section to edit; the stack updates live.
          </p>
        </div>
      </Section>

      <div className="mt-4">
        <CostingSummary quoteId={quote.id} editable={editable} />
      </div>
    </main>
  );
}

async function CostingSummary({
  quoteId,
  editable,
}: {
  quoteId: string;
  editable: boolean;
}) {
  const bundle = await getCostingBundle(quoteId);
  if (!bundle.ok) {
    return (
      <div className="rounded-md border border-bad/40 bg-bad-soft p-4 text-sm text-bad">
        Costing summary unavailable: {bundle.error.message}
      </div>
    );
  }
  return (
    <CostingStoreProvider snapshot={bundle.data}>
      <QuoteSummaryCard variant="compact" editable={editable} />
    </CostingStoreProvider>
  );
}

// Slice RI.8 step 1 — CostInputLink helper removed. F-4 absorbed
// the three-column Cost inputs nav strip into a single
// "Continue to Cost build →" affordance.

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
    <section className="mb-4 rounded-md border border-rule bg-paper">
      <header className="flex items-center justify-between border-b border-rule px-4 py-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action}
      </header>
      {children}
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
