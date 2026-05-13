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
// §6.b Step 5 — preset-related count helpers (countPackagingLinesForQuote,
// countProductionCellsWithDataForQuote, countFreightCellsWithDataForQuote,
// countFreightLinesForQuote) and TierPresetSelect previously used by the
// Tier section's action slot are removed from imports. Step 6 ships the
// proper R7b preset picker as the empty-state component.
// Slice RI.8 step 1.5 — Pricing Control Summary moved off Setup
// per brief §5 + §3.5. getCostingBundle / CostingStoreProvider /
// QuoteSummaryCard imports dropped along with the CostingSummary
// helper component.
import { buildTreeRenderOrder, getEligibleParents } from "@/lib/sku-tree";
import { Eyebrow } from "@/components/nav/eyebrow";
import { YourNextMoveBanner } from "@/components/nav/your-next-move-banner";
import { ActionCluster } from "@/components/nav/action-cluster";
import { NavShell } from "@/components/nav/nav-shell";
import { resolveSurfaceHref } from "@/lib/nav/surface-routes";
import { SURFACE_META } from "@/lib/nav/surface-meta";
import { recordSurfaceVisit } from "@/app/actions/surface-visits";
import { AddTierButton } from "./add-tier-button";
import { AddAssemblyButton } from "./add-assembly-button";
import { SkuRowList, type SkuRowListItem } from "./sku-row-list";
import { SkuSearchPanel } from "./sku-search-panel";
import { TierRow } from "./tier-row";
import { NotesEditor } from "./notes-editor";

export default async function QuoteBuilderPage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id: projectId, quoteId } = await params;

  // Slice RI.9 §6 step 9 — record surface visit for Home Resume card.
  // Fire-and-forget background op; never crashes the page.
  await recordSurfaceVisit({
    projectId,
    quoteId,
    surfaceKey: "setup",
  });

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
    <NavShell
      surfaceKey="setup"
      projectId={projectId}
      quoteId={quoteId}
      activeScenarioLabel={quote.scenarioLabel}
    >
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-2 text-sm">
        <Link
          href={`/projects/${project.id}`}
          className="text-ink-3 hover:text-ink"
        >
          ← {project.dealName}
        </Link>
      </div>

      {/* §6.b Step 1 amendment — R7b page chrome canon.
          Eyebrow stays per R7a (client · scenario · vN). Title +
          sub-copy match R7b designer notes line 6-7 ("starting
          shape of the quote"). Action cluster swaps "+ New scenario"
          (RI.9 placeholder) for "+ Add SKU" (R7b canonical).
          Quote-identifier strip (IdBadge + status badge + created
          date) dropped — R7b page head doesn't carry it; status
          + ID live elsewhere (rail / non-draft warning banner). */}
      <header className="r1-setup-head">
        <div>
          <Eyebrow
            segments={[
              project.clientName ?? project.dealName,
              quote.scenarioLabel,
              `v${quote.versionNumber}`,
            ]}
          />
          <h1 className="r1-setup-title">
            Setup{" "}
            <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>
              · SKUs, tiers, notes
            </span>
          </h1>
          <p className="r1-setup-sub">
            The starting shape of the quote. What we&rsquo;re selling, in
            what quantities, with what context. Cost goes on the next
            surface.
            {pm?.name ? ` · PM ${pm.name}` : ""}
          </p>
        </div>
        <ActionCluster
          secondary={[
            // + Add SKU — R7b canonical secondary affordance. Currently
            // inert at the page-head level; the canonical write path is
            // the table footer "+ Add Product" modal (Step 8 wires the
            // modal). UX_BACKLOG: wire page-head button to focus the
            // table-footer add-product affordance once modal lands.
            <button
              key="add-sku"
              type="button"
              className="r2-btn ghost"
              disabled
              title="+ Add SKU — wires to add-product modal in §6.b Step 8"
            >
              + Add SKU
            </button>,
          ]}
          primary={
            <button
              type="button"
              className="r2-btn primary"
              title="Saved automatically as you edit."
              disabled
            >
              Save draft
            </button>
          }
        />
      </header>

      {/* Slice RI.9 § 3.3 — YOUR NEXT MOVE banner. Setup → Cost build
          is the canonical forward step. R7b subtitle ("once SKUs and
          tiers are settled") added via helpText prop per §6.b Step 1
          amendment.  When quote is non-draft, the sent-status warning
          replaces the banner. */}
      {editable ? (
        <YourNextMoveBanner
          state="default"
          label={
            SURFACE_META.setup.nextMove?.label ?? "Continue to Cost build →"
          }
          subtitle="once SKUs and tiers are settled"
          href={resolveSurfaceHref("cost_build", project.id, quote.id)}
        />
      ) : (
        <div
          role="alert"
          className="mb-4 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm text-warn"
        >
          This quote is <span className="font-mono">{quote.status}</span> and not
          editable.
        </div>
      )}

      {/* §6.b polish-amendment — R7b rationale callout per
          designer notes line 7 (verbatim). Pattern 21 §D
          investigation: "DN · R7B" prefix tag is prototype-only
          chrome (third instance — alongside STATES tab strips +
          R7a/R7b widgets); not shipped. CC's prior "ⓘ" glyph
          prefix also stripped per the same investigation — the
          callout reads cleanly as a body-only orientation note. */}
      <div
        role="note"
        aria-label="Setup orientation"
        style={{
          padding: "12px 18px",
          marginBottom: 16,
          background: "var(--warn-soft)",
          border: "1px solid oklch(from var(--warn) l c h / 0.30)",
          borderRadius: 8,
          fontSize: 13,
          color: "var(--ink-2)",
          lineHeight: 1.5,
        }}
      >
        <p style={{ margin: 0 }}>
          Setup is the <strong>starting shape</strong> of the quote: what
          we&rsquo;re selling, in what quantities, with what context. Cost goes on
          Cost build (the next surface). Pricing goes on Costing sheet. The
          customer-facing artifact lives on Customer view.
        </p>
      </div>

      {/* Slice RI.8 step 1.5 — R1 two-column setup grid. SKUs
          left (1.4fr), Volume tiers right (1fr) per R1 source.
          Notes section follows full-width below the grid. */}
      <div className="r1-setup-grid">

      {/* §6.b Step 1 amendment — R7b SKUs section:
          • Section header carries count caption "{N} SKUs · {M} assemblies"
          • Table header + rows at top of card
          • Footer affordances ("+ Add Product" + "↗ Pull from HubSpot")
            relocated from top placement to below the table per R7b
            grammar
          Existing components retained (AddAssemblyButton + SkuSearchPanel)
          with label/position adjustments. Step 8 replaces "+ Add Product"
          with the full add-product modal. */}
      <Section
        title="SKUs"
        action={
          <span
            className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3"
            aria-label="SKU count caption"
          >
            {skus.length} {skus.length === 1 ? "SKU" : "SKUs"}
            {(() => {
              const aCount = skus.filter((s) => s.skuRole === "assembly").length;
              return ` · ${aCount} ${aCount === 1 ? "assembly" : "assemblies"}`;
            })()}
          </span>
        }
      >
        {skus.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-3">
            {editable
              ? 'No SKUs yet. Use "+ Add Product" or "↗ Pull from HubSpot" below to start.'
              : "No SKUs."}
          </p>
        ) : (
          <>
            <SkuHeader />
            <SkuRowList
              rows={buildTreeRenderOrder(skus).map(({ sku: s, depth }): SkuRowListItem => {
                const eligibleParents = getEligibleParents(skus, s.id).map((p) => ({
                  id: p.id,
                  skuLabel: p.skuLabel,
                  productName: p.productName,
                  skuRole: p.skuRole,
                }));
                const directChildren = skus.filter((x) => x.parentSkuId === s.id);
                const hasChildren = directChildren.length > 0;
                const childCount = directChildren.length;
                // §6.b Step 4 — children data for the assembly drawer's
                // navigation list. Per-child component count computed
                // for the drawer's display ("→ ASY with N nested
                // children" style render in v1.1).
                const childSkus = directChildren.map((c) => ({
                  id: c.id,
                  skuLabel: c.skuLabel,
                  productName: c.productName,
                  skuRole: c.skuRole,
                  qtyPerParent: c.qtyPerParent,
                  childCount: skus.filter((x) => x.parentSkuId === c.id).length,
                }));
                return {
                  sku: {
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
                  },
                  depth,
                  hasChildren,
                  childCount,
                  childSkus,
                  eligibleParents,
                };
              })}
              hubspotPortalId={process.env.HUBSPOT_PROD_HUB_ID ?? null}
              disabled={!editable}
              projectId={projectId}
              quoteId={quote.id}
            />
          </>
        )}
        {editable && (
          <div className="border-t border-rule px-4 pt-3 pb-4">
            {/* §6.b polish-amendment (sweep #11) — drag-hint
                relocated to bottom-right of card per R7b
                screenshot. Previous placement was inline with
                "+ Add Product" button (row-1 left), competing for
                attention with the primary affordance. */}
            <div className="mb-3">
              <AddAssemblyButton
                quoteId={quote.id}
                eligibleParents={getEligibleParents(skus, null).map((p) => ({
                  id: p.id,
                  skuLabel: p.skuLabel,
                  productName: p.productName,
                  skuRole: p.skuRole as "leaf" | "assembly",
                }))}
                triggerLabel="+ Add Product"
              />
            </div>
            <div>
              <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
                ↗ Pull from HubSpot
              </p>
              <SkuSearchPanel
                quoteId={quote.id}
                eligibleParents={getEligibleParents(skus, null).map((p) => ({
                  id: p.id,
                  skuLabel: p.skuLabel,
                  productName: p.productName,
                  skuRole: p.skuRole,
                }))}
              />
            </div>
            <div className="mt-3 flex justify-end">
              <span className="text-xs italic text-ink-4">
                Drag rows to reorder
              </span>
            </div>
          </div>
        )}
      </Section>

      {/* §6.b Step 5 — Tier table parallel register per R7b §3.4 /
          Decision 5. Same card chrome + footer pill grammar as the
          SKU table. 5-column layout: Label · ★ · Qty · Price adj % ·
          ×. Tier preset picker lives in Step 6 (empty-state). */}
      <Section
        title="Tiers"
        action={
          <span
            className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3"
            aria-label="Tier count caption"
          >
            {tiers.length} {tiers.length === 1 ? "tier" : "tiers"}
          </span>
        }
      >
        {tiers.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm italic text-ink-3">
            {/* §6.b Step 6 replaces this with the preset picker per
                R7b §3.5 empty-state grammar. For Step 5: minimal
                empty-state copy + the "+ Add tier" footer below. */}
            No tiers yet. Add the first one below.
          </p>
        ) : (
          <>
            <TierHeader />
            <div className="divide-y divide-rule">
              {tiers.map((t) => (
                <TierRow
                  key={t.id}
                  tier={{
                    id: t.id,
                    label: t.label,
                    qty: t.qty,
                    recommended: t.recommended,
                    tierPriceAdjPct: t.tierPriceAdjPct,
                  }}
                  disabled={!editable}
                />
              ))}
            </div>
          </>
        )}
        {editable && (
          <div className="border-t border-rule px-4 pt-3 pb-4">
            <AddTierButton quoteId={quote.id} />
            {/* Step 6 will add the "+ Add preset" sibling here per
                R7b's paired action vocabulary (designer notes
                §3.4 line 98: "+ Add product / + Add preset"). */}
          </div>
        )}
      </Section>
      </div>
      {/* end .r1-setup-grid */}

      {/* §6.b Step 7 — Notes split per R7b designer notes §3.6.
          Two side-by-side audience-distinct cards (internal purple
          / customer-facing green). No wrapping Section card — the
          NotesEditor renders its own card chrome per zone. */}
      <NotesEditor
        quoteId={quote.id}
        projectId={projectId}
        internalNotes={quote.internalNotes}
        customerFacingNotes={quote.customerFacingNotes}
        disabled={!editable}
      />

      {/* Slice RI.8 step 1.5 — `Cost inputs` Section block removed.
          The "Continue to Costs →" CTA now lives in the
          page-head action cluster per R1 source line 16. PMs
          have a single canonical path forward, not a redundant
          mid-page section.

          CostingSummary card removed entirely. Surface separation
          per brief §5 + §3.5: Pricing Control Summary lives on
          Pricing only. Was a Slice 5/6/7-era convenience
          render; carried forward through RI.0-RI.7 unnecessarily.
          PMs reviewing margins navigate to Pricing (via
          page-head Continue button or inner-rail). */}
    </main>
    </NavShell>
  );
}

// Slice RI.8 step 1 — CostInputLink helper removed. F-4 absorbed
// the three-column Cost inputs nav strip into a single
// "Continue to Costs →" affordance.
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

// §6.b Step 1 — 6-column SKU table layout per brief §3.1.
// Columns: Grip · Type · Product · Retail bench · Components · ⋯
// Category column dropped (Slice 9 cost_category deferral, Pattern 22 #5);
// Pack sub-text renders NULL-safely inside Product cell (Slice 11 deferral,
// Pattern 22 #6).
function SkuHeader() {
  return (
    <div className="grid grid-cols-[36px_80px_2fr_120px_120px_36px] items-center gap-2 border-b border-rule bg-paper-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-3">
      <span aria-hidden></span>{/* Grip column header is intentionally blank */}
      <span>Type</span>
      <span>Product</span>
      <span>Retail bench</span>
      <span>Components</span>
      <span aria-hidden></span>{/* ⋯ overflow column header is intentionally blank */}
    </div>
  );
}

// §6.b Step 5 — Tier table header per R7b §3.4 columns:
// Label · ★ · Qty · Price adj % · ×. Grammar matches the SKU
// table header (mono uppercase ink-3 tracking 0.13em).
function TierHeader() {
  return (
    <div className="grid grid-cols-[2fr_36px_1fr_1fr_36px] items-center gap-2 border-b border-rule bg-paper-2 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
      <span>Label</span>
      <span className="text-center" aria-label="Recommended">★</span>
      <span>Qty</span>
      <span>Price adj %</span>
      <span aria-hidden></span>
    </div>
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
