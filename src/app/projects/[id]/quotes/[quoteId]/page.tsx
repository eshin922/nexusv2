import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  packagingInputs,
  productionInputs,
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
import { loadAssemblyTree } from "@/lib/assembly-tree";
import { AssemblyTreeView } from "@/components/assembly-tree/assembly-tree-view";
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
import { TierPresetPicker } from "./tier-preset-picker";
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

  // Phase A.1 v2 impl-2 — read-path branching (brief §4.2 Step 6).
  // loadAssemblyTree returns null when the quote has zero `assemblies`
  // rows; non-null means the new ASY/LEAF schema is in use and the
  // legacy quote_skus render path should be skipped. Existing quotes
  // (created pre-Phase-A.1-v2) keep working unchanged via the null
  // branch. New quotes that go through the impl-2 write path render
  // via the assembly tree.
  const assemblyTree = await loadAssemblyTree(quoteId);
  const usesNewSchema = assemblyTree !== null;

  const [skus, tiers, pkgSkuIds, prodSkuIds] = await Promise.all([
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
    // Leaf-detach micro-slice Sub-item 3 — pre-compute per-SKU
    // `hasCostData` flag for the smart-migrate confirmation modal
    // gate (Sub-item 3 scenario A vs B). Two queries — packaging +
    // production. Slice R6.2 retired the per-SKU freight binding
    // (Gap 22: freight is per-quote, not per-SKU); leaf-to-assembly
    // conversion never orphans freight data so it's excluded from
    // the per-SKU cost-data check.
    db
      .selectDistinct({ skuId: packagingInputs.quoteSkuId })
      .from(packagingInputs)
      .innerJoin(quoteSkus, eq(quoteSkus.id, packagingInputs.quoteSkuId))
      .where(eq(quoteSkus.quoteId, quote.id)),
    db
      .selectDistinct({ skuId: productionInputs.quoteSkuId })
      .from(productionInputs)
      .innerJoin(quoteSkus, eq(quoteSkus.id, productionInputs.quoteSkuId))
      .where(eq(quoteSkus.quoteId, quote.id)),
  ]);

  const skuIdsWithCostData = new Set([
    ...pkgSkuIds.map((r) => r.skuId),
    ...prodSkuIds.map((r) => r.skuId),
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
        {/* Rest-of-app sweep (post-§6.b Designer audit Finding 01
            promoted to v1 blocker per Edward smoke 2026-05-13):
            page-head action cluster intentionally empty. Removed:
            (1) `+ Add SKU` — duplicative of `+ Add Product` in SKU
            table footer (single canonical addition affordance lives
            near the table). (2) `Save draft` — non-functional
            placeholder; autosave is wired on field-blur (Slice 5
            form-state pattern) so an explicit Save button just
            implies functionality that doesn't exist. Empty `.actions`
            div preserves canonical .r7b-head structure for the
            future case where genuine page-head actions are needed. */}
        <div className="actions" />
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
            SURFACE_META.setup.nextMove?.label ?? "Continue to Costs →"
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
        on Costs. The SKU and Tier tables are a{" "}
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
          name vocabulary now matches CD source).

          Phase A.1 v2 impl-2 Step 3 — Setup IA shift per brief §5.2:
          SKUs to top, Tiers below. Conditional `.r-a1v2-stack`
          modifier converts the grid to a single full-width column
          when the quote uses the new ASY/LEAF schema. Legacy quotes
          (usesNewSchema=false) keep the 2fr 1fr §6.b composition. */}
      <div className={`r7b-grid${usesNewSchema ? " r-a1v2-stack" : ""}`}>

      {/* §6.b Step 1 amendment — R7b SKUs section:
          • Section header carries count caption "{N} SKUs · {M} assemblies"
          • Table header + rows at top of card
          • Footer affordances ("+ Add Product" + "↗ Pull from HubSpot")
            relocated from top placement to below the table per R7b
            grammar
          Existing components retained (AddAssemblyButton + SkuSearchPanel)
          with label/position adjustments. Step 8 replaces "+ Add Product"
          with the full add-product modal. */}
      {/* Phase A.1 v2 impl-2 Step 4 — when the quote uses the new
          ASY/LEAF schema (usesNewSchema=true), render the new tree
          view via <AssemblyTreeView>. Otherwise fall through to the
          legacy quote_skus card below (no change for existing quotes). */}
      {usesNewSchema && assemblyTree ? (
        <AssemblyTreeView tree={assemblyTree} editable={editable} />
      ) : (
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
          // Sweep Step 1 — migrated to canonical .r7b-empty-state
          // primitive (Designer audit Finding 22). Inline-styled
          // earlier; primitive consolidates this with the assembly
          // drawer's child-list empty state and future SKU-table-
          // empty cases.
          <p className="r7b-empty-state">
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
                  // Leaf-detach micro-slice Sub-item 1b — server-
                  // computed flag for the drawer's per-row Detach
                  // confirmation modal gate. True when the child has
                  // notes OR retailBenchmark to preserve; false for
                  // clean detach (silent path).
                  hasPreservableData:
                    (c.notes !== null && c.notes.trim() !== "") ||
                    (c.retailBenchmark !== null &&
                      String(c.retailBenchmark).trim() !== ""),
                }));
                // Leaf-detach micro-slice Sub-item 1 — current parent
                // label threaded into the row so the overflow menu can
                // render "Detach from {parent name}" (Q3 LOCKED copy)
                // and the detach confirmation modal can name the
                // parent in its prompt copy. Null when SKU has no
                // parent (the detach affordance is conditionally
                // hidden upstream).
                const parent = s.parentSkuId
                  ? skus.find((x) => x.id === s.parentSkuId)
                  : null;
                const currentParentLabel = parent?.skuLabel ?? null;
                // Leaf-detach micro-slice Sub-item 3 — drives the
                // smart-migrate modal gate. True when this SKU has
                // any per-SKU cost-input row (packaging / production
                // / freight). Threaded to SkuRow's handleConvertRole
                // so clicking the Type badge on a leaf with cost
                // data opens the modal instead of silently flipping
                // to assembly + orphaning the cost rows.
                const hasCostData = skuIdsWithCostData.has(s.id);
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
                  currentParentLabel,
                  hasCostData,
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

      )}

      {/* §6.b Step 5 — Tier table parallel register per R7b §3.4 /
          Decision 5. Same card chrome + footer pill grammar as the
          SKU table. 5-column layout: Label · ★ · Qty · Price adj % ·
          ×. Tier preset picker lives in Step 6 (empty-state). */}
      {/* §6.b path-B migration commit 4 — Tier table → canonical
          r7b-card / r7b-tier-* structure (7bsetup.jsx TierRail
          lines 250-309 + 7bstyles.css .r7b-tier-* rules at line
          329). Drops Section wrapper; canonical .r7b-card-head
          with .meta count caption + .r7b-tier-thead + .r7b-tier-row
          + .r7b-tier-footer. Preset picker (.r7b-presets +
          .r7b-presets-grid) deferred to Step 6 empty-state. */}
      <div className="r7b-card">
        <div className="r7b-card-head">
          <h3>Tiers</h3>
          <div className="actions">
            <span className="meta" aria-label="Tier count caption">
              {tiers.length} tier{tiers.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {tiers.length === 0 ? (
          // §6.b Step 6 — R7b §3.5 preset picker (empty state).
          // Renders only when count === 0; mounts/unmounts on tier
          // population. Brief: adding a 4th tier to a 3-tier preset
          // does NOT re-show the picker — guaranteed by the count
          // gate (any tier exists → picker unmounted).
          <TierPresetPicker quoteId={quote.id} disabled={!editable} />
        ) : (
          <>
            {/* Canonical .r7b-tier-thead — 4 columns:
                1fr · 100px · 90px · 28px (label · qty · adj · actions) */}
            <div className="r7b-tier-thead">
              <span>Tier</span>
              <span className="num">Qty</span>
              <span className="num">Price adj</span>
              <span></span>
            </div>
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
          </>
        )}
        {editable && (
          <div className="r7b-tier-footer">
            <AddTierButton quoteId={quote.id} />
            {/* Step 6 adds "+ Add preset" sibling here per R7b's
                paired action vocabulary (designer notes §3.4 line
                98: "+ Add product / + Add preset"). */}
          </div>
        )}
      </div>
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
// §6.b path-B migration commit 4 — TierHeader inline function
// removed. Tier table header now uses canonical .r7b-tier-thead
// markup inline in the JSX (7bsetup.jsx lines 277-282).


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
