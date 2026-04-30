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
import { buildTreeRenderOrder, getEligibleParents } from "@/lib/sku-tree";
import { IdBadge } from "@/components/id-badge";
import { AddTierButton } from "./add-tier-button";
import { AddAssemblyButton } from "./add-assembly-button";
import { SkuRow } from "./sku-row";
import { SkuSearchPanel } from "./sku-search-panel";
import { TierRow } from "./tier-row";
import { NotesEditor } from "./notes-editor";
import { TierPresetSelect } from "./tier-preset-select";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-green-100 text-green-800",
  superseded: "bg-amber-100 text-amber-800",
  lost: "bg-red-100 text-red-800",
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
          className="text-gray-500 hover:text-gray-900"
        >
          ← {project.dealName}
        </Link>
      </div>

      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {quote.scenarioLabel} · v{quote.versionNumber}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {project.clientName ?? "—"}
            {pm?.name && (
              <>
                {" · PM: "}
                <span className="text-gray-700">{pm.name}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IdBadge id={quote.id} />
          <Badge className={STATUS_STYLES[quote.status] ?? STATUS_STYLES.draft}>
            {quote.status}
          </Badge>
          <span className="text-xs text-gray-500">
            created {quote.createdAt.toLocaleDateString()}
          </span>
        </div>
      </header>

      {!editable && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          This quote is <span className="font-mono">{quote.status}</span> and not
          editable.
        </div>
      )}

      {/* SKUs — referenced from HubSpot Products */}
      <Section title="SKUs">
        {editable && (
          <div className="border-b border-gray-100">
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
          <p className="px-4 py-6 text-center text-sm text-gray-500">
            {editable
              ? "Search HubSpot Products above to add the first SKU, or create a Nexus-local assembly."
              : "No SKUs."}
          </p>
        ) : (
          <>
            <SkuHeader />
            <div className="divide-y divide-gray-100">
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
          <p className="px-4 py-6 text-center text-sm text-gray-500">
            Add at least one tier to continue.
          </p>
        ) : (
          <>
            <TierHeader />
            <div className="divide-y divide-gray-100">
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

      <Section title="Cost inputs">
        <div className="grid grid-cols-3 divide-x divide-gray-100">
          <CostInputLink
            href={`/projects/${project.id}/quotes/${quote.id}/packaging`}
            label="Packaging"
            sub="Slice 5 — active"
            active
          />
          <CostInputLink
            href={`/projects/${project.id}/quotes/${quote.id}/production`}
            label="Production"
            sub="Slice 6 — active"
            active
          />
          <CostInputLink
            href={`/projects/${project.id}/quotes/${quote.id}/freight`}
            label="Freight"
            sub="Slice 7 — active"
            active
          />
        </div>
      </Section>

      <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-white p-5">
        <div className="text-sm font-semibold text-gray-700">Costing Sheet</div>
        <p className="mt-1 text-sm text-gray-500">
          Derived view across all cost inputs lands in Slice 8.
        </p>
      </div>
    </main>
  );
}

function CostInputLink({
  href,
  label,
  sub,
  active = false,
}: {
  href: string;
  label: string;
  sub: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-4 py-3 text-sm hover:bg-gray-50 ${
        active ? "" : "text-gray-500"
      }`}
    >
      <div
        className={`font-medium ${active ? "text-gray-900" : "text-gray-700"}`}
      >
        {label} {active ? "→" : ""}
      </div>
      <div className="text-xs text-gray-500">{sub}</div>
    </Link>
  );
}

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
    <section className="mb-4 rounded-md border border-gray-200 bg-white">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function SkuHeader() {
  return (
    <div className="grid grid-cols-[1.4fr_2fr_0.9fr_0.6fr_0.7fr_1.4fr_auto] gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
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
    <div className="grid grid-cols-[2fr_1fr_auto] gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
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
        <div className="mb-0.5 text-xs font-medium text-gray-700">
          Internal notes
        </div>
        <div className="whitespace-pre-wrap text-gray-900">
          {internal ?? <span className="text-gray-400">—</span>}
        </div>
      </div>
      <div>
        <div className="mb-0.5 text-xs font-medium text-gray-700">
          Customer-facing notes
        </div>
        <div className="whitespace-pre-wrap text-gray-900">
          {customer ?? <span className="text-gray-400">—</span>}
        </div>
      </div>
    </div>
  );
}
