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
// §6.b path-B migration commit 2 — Eyebrow + ActionCluster imports
// dropped: Setup now uses canonical .r7b-head inline structure
// (no Eyebrow/ActionCluster components). The primitives stay shipped
// for Costs / Pricing / Quote / Mark-Accepted (RI.9 work intact).
import { YourNextMoveBanner } from "@/components/nav/your-next-move-banner";
import { NavShell } from "@/components/nav/nav-shell";
import { resolveSurfaceHref } from "@/lib/nav/surface-routes";
import { SURFACE_META } from "@/lib/nav/surface-meta";
import { recordSurfaceVisit } from "@/app/actions/surface-visits";
import { AddTierButton } from "./add-tier-button";
// AddAssemblyButton import removed — now consumed by SkuFooter
// client wrapper. SkuSearchPanel similarly moved into SkuFooter.
import { SkuRowList, type SkuRowListItem } from "./sku-row-list";
import { SkuFooter } from "./sku-footer";
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
    {/* §6.b path-B migration — canonical .r7b-page class replaces
        Tailwind `mx-auto max-w-6xl p-6`. Canonical: padding: 28px
        40px 80px; max-width: 1480px (7bstyles.css line 24). Wider
        max-width than my prior 6xl (~72rem ~1152px) matches R7b's
        roomy single-screen composition. */}
    <main className="r7b-page">
      <div className="mb-2 text-sm">
        <Link
          href={`/projects/${project.id}`}
          className="text-ink-3 hover:text-ink"
        >
          ← {project.dealName}
        </Link>
      </div>

      {/* §6.b path-B migration commit 2 — page chrome restructured to
          match canonical 7bsetup.jsx PageHead (lines 86-107). Inline
          eyebrow + h1 + sub + actions per .r7b-head structure. Cross-
          surface primitives (<Eyebrow>, <ActionCluster>) stay shipped
          for Costs / Pricing / Quote / Mark-Accepted; Setup uses
          canonical R7b CSS directly.

          h1 italic 30px (canonical .r7b-head h1); em-wrapped suffix
          renders non-italic 22px ink-3 (canonical .r7b-head h1 em).
          Sub-copy preserves "we're" per Edward's earlier disposition
          (designer notes line 7 + Edward's first-person-plural call;
          canonical JSX has "you're" — Pattern 28 conflict, "we're"
          wins per Edward directive).

          ".actions" class matches the canonical CSS selector
          (.r7b-head .actions) — JSX in 7bsetup.jsx line 101 uses
          "r7b-actions" which is a CD prototype bug; the CSS rule
          uses .actions inside .r7b-head, so that's what works. */}
      <div className="r7b-head">
        <div className="lhs">
          <div className="eyebrow">
            {project.clientName ?? project.dealName}
            <span className="sep">·</span>
            {quote.scenarioLabel}
            <span className="sep">·</span>
            v{quote.versionNumber} draft
          </div>
          <h1>
            Setup <em>· SKUs, tiers, notes</em>
          </h1>
          <p className="sub">
            The starting shape of the quote. What we&rsquo;re selling, in
            what quantities, with what context. Cost goes on the next
            surface.
            {pm?.name ? ` · PM ${pm.name}` : ""}
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn ghost sm"
            disabled
            title="+ Add SKU — wires to add-product modal in §6.b Step 8"
          >
            + Add SKU
          </button>
          <button
            type="button"
            className="btn primary"
            title="Saved automatically as you edit."
            disabled
          >
            Save draft
          </button>
        </div>
      </div>

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

      {/* §6.b path-B migration — Designer Note callout per canonical
          7bsetup.jsx lines 464-467 + 7bstyles.css .r7b-dn rules.

          Pattern 21 correction: my fidelity sweep §D incorrectly
          flagged "DN · R7b" as prototype-only review chrome and
          recommended strip. Now with canonical JSX available, the
          callout IS production UI — designer-note vocabulary IS
          part of the surface grammar. Restoring canonical structure
          + copy verbatim.

          Body copy includes the full coupled-pair + notes-split
          sentences (my Step 1 amendment synthesized these from
          designer notes lines 7+12+13; canonical confirms the
          synthesis). "we're" vs canonical's "we're" — match.
          "the row drawer" (not "the drawer") per canonical line 466. */}
      <div className="r7b-dn">
        <span className="lbl">DN · R7b</span>
        Setup is the <strong>starting shape</strong> of the quote: what
        we&rsquo;re selling, in what quantities, with what context. Cost goes
        on Cost build. The SKU and Tier tables are a{" "}
        <strong>coupled pair</strong> — same inline-edit pattern, same
        register, paired action vocabularies. Notes split into{" "}
        <strong>internal</strong> (PM-only) and{" "}
        <strong>customer-facing</strong> (renders on Quote PDF); per-SKU
        notes live in the row drawer.
      </div>

      {/* §6.b path-B migration — canonical .r7b-grid replaces
          .r1-setup-grid. Canonical: grid-template-columns: 2fr 1fr;
          gap: 22px; margin-bottom: 24px (7bstyles.css line 75-79).
          Cleaner than my prior 2fr 1fr (matched anyway, but class
          name vocabulary now matches CD source). */}
      <div className="r7b-grid">

      {/* §6.b Step 1 amendment — R7b SKUs section:
          • Section header carries count caption "{N} SKUs · {M} assemblies"
          • Table header + rows at top of card
          • Footer affordances ("+ Add Product" + "↗ Pull from HubSpot")
            relocated from top placement to below the table per R7b
            grammar
          Existing components retained (AddAssemblyButton + SkuSearchPanel)
          with label/position adjustments. Step 8 replaces "+ Add Product"
          with the full add-product modal. */}
      {/* §6.b path-B migration commit 3 — SKU table → canonical
          r7b-card / r7b-sku-* structure (7bsetup.jsx SkuTable
          lines 125-195). Drops Section wrapper component; uses
          canonical .r7b-card-head with .meta count caption. */}
      <div className="r7b-card">
        <div className="r7b-card-head">
          <h3>SKUs</h3>
          <div className="actions">
            <span className="meta" aria-label="SKU count caption">
              {skus.length} {skus.length === 1 ? "SKU" : "SKUs"}
              {(() => {
                const aCount = skus.filter((s) => s.skuRole === "assembly").length;
                return ` · ${aCount} ${aCount === 1 ? "assembly" : "assemblies"}`;
              })()}
            </span>
          </div>
        </div>

        {skus.length === 0 ? (
          <p style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "var(--ink-3)", fontStyle: "italic", margin: 0 }}>
            {editable
              ? 'No SKUs yet. Use "+ Add product" or "↗ Pull from HubSpot" below to start.'
              : "No SKUs."}
          </p>
        ) : (
          <>
            {/* Canonical .r7b-sku-thead — 7 columns per 7bstyles.css
                line 107: 24px grip · 64px type · minmax(220px,1.6fr)
                product · minmax(120px,1fr) category · 90px retail
                · 80px components · 40px actions. Category column
                renders em-dash per row pending Slice 9
                (Pattern 22 #5 deferral). */}
            <div className="r7b-sku-thead">
              <span></span>
              <span>Type</span>
              <span>Product</span>
              <span>Category</span>
              <span className="num">Retail bench</span>
              <span className="num">Components</span>
              <span></span>
            </div>
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
          <SkuFooter
            quoteId={quote.id}
            eligibleParents={getEligibleParents(skus, null).map((p) => ({
              id: p.id,
              skuLabel: p.skuLabel,
              productName: p.productName,
              skuRole: p.skuRole as "leaf" | "assembly",
            }))}
          />
        )}
      </div>

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

// §6.b path-B migration commit 3 — SkuHeader inline function
// removed. SKU table header now uses canonical .r7b-sku-thead
// markup inline in the JSX (7bsetup.jsx lines 135-143). 7-column
// grid (grip · type · product · category · retail · components ·
// actions) drives layout via .r7b-sku-thead CSS rules.

// §6.b Step 5 polish-amendment — Tier table header per R7b
// Screenshot 2026-05-12 225751. 3 data columns + delete:
// TIER · QTY · PRICE ADJ · × (no separate ★ column —
// recommended state renders as inline chip BELOW the tier label
// per tier-row.tsx). Wider Qty column resolves the cut-off
// values seen in pre-amendment smoke.
function TierHeader() {
  return (
    <div className="grid grid-cols-[1.6fr_1fr_1fr_36px] items-center gap-2 border-b border-rule bg-paper-2 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3 whitespace-nowrap">
      <span>Tier</span>
      <span>Qty</span>
      <span>Price adj</span>
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
