import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  quoteClientTargets,
  quotes,
  quoteTiers,
} from "@/db/schema";
// canonical-scenario-create-flow Step 3 — legacy SKU table imports
// removed: quoteSkus, packagingInputs, productionInputs (data
// sources), buildTreeRenderOrder, getEligibleParents (helpers),
// SkuRowList, SkuRowListItem, SkuFooter (components). All used by
// the legacy quote_skus render path which this slice drops. New
// path uses <AssemblyTreeView> exclusively.
import { loadAssemblyTree } from "@/lib/assembly-tree";
import { readExistingComponentCharges } from "@/lib/component-charges/read";
import {
  indexProductTypeChargeDefaults,
  listProductTypeChargeDefaults,
} from "@/lib/product-type-charge-defaults";
import { AssemblyTreeView } from "@/components/assembly-tree/assembly-tree-view";
import { loadProductTypeOptions } from "@/lib/product-type-options";
import { ensureUser } from "@/lib/auth/ensure-user";
import { loadQuoteAttachments } from "@/lib/quote-attachments-loader";
import { AttachmentListTrigger } from "@/components/quote-attachments/attachment-list-trigger";
// §6.b path-B migration commit 2 — Eyebrow + ActionCluster imports
// dropped: Setup now uses canonical .r7b-head inline structure
// (no Eyebrow/ActionCluster components). The primitives stay shipped
// for Costs / Pricing / Quote / Mark-Accepted (RI.9 work intact).
import { NavShell } from "@/components/nav/nav-shell";
import { recordSurfaceVisit } from "@/app/actions/surface-visits";
import { AddTierButton } from "./add-tier-button";
import { TierRow } from "./tier-row";
import { TierPresetPicker } from "./tier-preset-picker";
import { NotesEditor } from "./notes-editor";
import { FreightIntentControl } from "./freight-intent-control";
import { canEditLibraryProduct } from "@/lib/permissions/library-product";
import { COSTS_M3_PREVIEW_VALUE } from "@/lib/costs/m2-preview-switch";

export default async function QuoteBuilderPage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id: projectId, quoteId } = await params;

  // slice-library-first-creation-flow Step 3 — fetch signed-in
  // user so we can thread `permissions.canCreateLeaves` into
  // AssemblyTreeView for the library modal's "+ Create new
  // product" gate (locked Q6 disposition). Same call pattern as
  // /leaves/[leafId]/specs/page.tsx and quote/page.tsx.
  const user = await ensureUser();

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
    })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);

  if (quoteRows.length === 0) notFound();
  const { quote, project } = quoteRows[0];
  if (project.id !== projectId) notFound(); // URL tampering
  const costsUrl = `/projects/${project.id}/quotes/${quote.id}/costs?preview=${COSTS_M3_PREVIEW_VALUE}`;

  // canonical-scenario-create-flow — read-path branching dropped.
  // Every quote routes to the new ASY/LEAF tree; loadAssemblyTree
  // always returns non-null (empty tree on zero-assembly state,
  // which AssemblyTreeView's empty-state affordance renders).
  // The legacy quote_skus render path is removed in this slice.
  //
  // Lineage acknowledgment (per CA disposition 4): the legacy
  // `<SkuRowList>` + `add-product-modal.tsx` chain was the ONLY
  // remaining surface firing the HubSpot-first `addProductSku`
  // write path (CC's prior investigation, May 19). Removing it
  // widens the HubSpot writeback regression (originally bypassed
  // in the Phase A.1 v2 refactor) to all scenarios. Pre-launch
  // tolerance per Edward disposition (all current data is test
  // data; no production at risk). The bundled HubSpot
  // bidirectional micro-slice (queued next-but-one after this)
  // restores the write path before pre-launch review.
  const assemblyTree = await loadAssemblyTree(quoteId);
  const productTypeChargeDefaults = await listProductTypeChargeDefaults();

  // Phase A.1 v2 impl-4 — product-type options for the Add Product
  // modal's ASY/LEAF type selectors. Loaded unconditionally (cheap
  // single-table read; 17 rows) so the legacy render path can also
  // consume them in the future when migration lands.
  const productTypeOptions = await loadProductTypeOptions();

  // Phase A.1 v2 impl-5 — leaf-type options for the library browse
  // modal's type filter dropdown. Shape (id + name + placeholder)
  // differs from productTypeOptions.leafTypes (which carries full
  // fieldSchema); kept separate to avoid coupling unrelated UIs.

  // canonical-scenario-create-flow Step 7 — quote attachments for
  // the Setup-header attachment-list affordance. Loaded
  // unconditionally (single small query); rendered as a trigger
  // chip in the .r7b-head .actions cluster.
  const attachments = await loadQuoteAttachments(quoteId);

  // canonical-scenario-create-flow Step 3 — Promise.all slimmed to
  // tiers query only. SKU + packagingInputs + productionInputs
  // queries removed alongside the legacy SKU table render path.
  // `skuIdsWithCostData` computation also removed (only consumed
  // by the legacy SkuRowList's per-row Detach modal gate).
  const tiers = await db
    .select()
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quote.id))
    .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt));

  // Client Target rows for the whole quote — raw, and resolved where they are
  // read. One query rather than one per sellable unit; the table carries
  // `quote_id` so no join is needed to scope it.
  const clientTargetRows = await db
    .select()
    .from(quoteClientTargets)
    .where(eq(quoteClientTargets.quoteId, quote.id));

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

      {/* The delivered wizard hero sits above the two-step workflow frame;
          the attachment action remains available beside the quote context. */}
      <div className="r7b-head setup-wizard-hero" id="setup-attachments">
        <div className="lhs">
          <div className="eyebrow">
            {project.clientName ?? project.dealName}
            <span className="sep">·</span>
            {quote.scenarioLabel}
            <span className="sep">·</span>
            v{quote.versionNumber} draft
          </div>
          <h1 className="setup-wizard-title">Products and services, bottom-up.</h1>
          <p className="sub">
            <span className="setup-wizard-head-copy">
            No finished-good question, no derived quote type. A product is
            whatever DPS supplies — a bag, a box, a gummy, an eyeliner, a packed
            unit. Grouping is optional and explicit: a product becomes a
            component by being put in an item group, not by what it is.
            </span>
          </p>
        </div>
        {/* canonical-scenario-create-flow Step 7 — page-head actions
            cluster now hosts the attachment-list trigger. PMs see
            "📎 N attachments" when the scenario has briefs/RFQs
            attached, or "📎 Add attachment" when none yet. */}
        <div className="actions">
          <AttachmentListTrigger
            quoteId={quoteId}
            attachments={attachments}
          />
        </div>
      </div>

      {!editable ? (
        <div
          role="alert"
          className="mb-4 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm text-warn"
        >
          This quote is <span className="font-mono">{quote.status}</span> and not
          editable.
        </div>
      ) : null}

      <div className="setup-wizard-frame">
        <div className="setup-wizard-topbar">
          <span className="brand">Nexus</span>
          <span className="slash">/</span>
          <span className="frame-title">New quote</span>
          <span className="spacer" />
        </div>
        <div className="setup-wizard-context">
          <label><span>Customer</span><input value={project.clientName ?? ""} placeholder="Customer name" readOnly /></label>
          <label><span>Project</span><input value={project.dealName} placeholder="Project or programme" readOnly /></label>
          <label><span>Quote</span><input value={`${quote.scenarioLabel} · v${quote.versionNumber}`} placeholder="Quote name · draft" readOnly /></label>
        </div>
        <div className="setup-wizard-body">
          <header className="setup-wizard-step-heading">
            <h2>What products and services are we quoting?</h2>
            <p>Add whatever DPS is supplying. Services can stand alone, products can stand alone, and a quote can mix both.</p>
          </header>

      {/* Existing quote editors remain the source of truth for product,
          service, grouping and tier changes inside the Setup wizard step. */}
      <div className="r7b-grid r-a1v2-stack">

      {/* canonical-scenario-create-flow Step 3 — every quote
          renders the new ASY/LEAF tree. Legacy `<div className=
          "r7b-card">` SKU table + SkuRowList + SkuFooter chain
          removed alongside the read-path branching. AssemblyTreeView
          handles empty state internally ("No assemblies yet"). */}
      <div id="setup-products">
      {assemblyTree ? (
        <AssemblyTreeView
          tree={assemblyTree}
          editable={editable}
          tiers={tiers.map((t) => ({ id: t.id, label: t.label, qty: t.qty }))}
          clientTargets={clientTargetRows.map((r) => ({
            assemblyId: r.assemblyId,
            quoteLeafId: r.quoteLeafId,
            tierId: r.tierId,
            clientTargetPricePerUnit: Number(r.clientTargetPricePerUnit),
          }))}
          projectId={projectId}
          quoteId={quoteId}
          itemGroupCategories={productTypeOptions.itemGroupCategories}
          leafTypes={productTypeOptions.leafTypes}
          // Both capabilities come from the SAME functions the server guards
          // call, so the affordance and the action cannot disagree about who
          // may do what. Computing either one inline here is how they drifted.
          permissions={{
            canCreateLeaves: user.canCreateLeaves,
            canEditProduct: canEditLibraryProduct(user),
          }}
          // OD-032 · what each component ALREADY owns, with full identity.
          // Without this the sheet believed every component owned nothing, so
          // a second charge of a type submitted with no label and silently
          // resolved to the first.
          existingComponentCharges={await readExistingComponentCharges(quoteId)}
          suggestedChargesByProductType={indexProductTypeChargeDefaults(
            productTypeChargeDefaults,
          )}
        />
      ) : null}
      </div>

      <section id="setup-tiers" aria-labelledby="setup-quantities-title">
        <h3 className="setup-wizard-section-title" id="setup-quantities-title">Quantities</h3>
        <p className="setup-wizard-section-lede">Alternative quantities for the whole quote. They are priced separately and never added together. A quantity is in units; what a unit means for each product is not settled here.</p>

        {tiers.length === 0 ? (
          // §6.b Step 6 — R7b §3.5 preset picker (empty state).
          // Renders only when count === 0; mounts/unmounts on tier
          // population. Brief: adding a 4th tier to a 3-tier preset
          // does NOT re-show the picker — guaranteed by the count
          // gate (any tier exists → picker unmounted).
          <div className="setup-wizard-indent">
            <TierPresetPicker quoteId={quote.id} disabled={!editable} />
          </div>
        ) : (
          <div className="setup-wizard-indent">
            <div className="setup-wizard-quantity-grid">
              {tiers.map((t) => (
                <TierRow
                  key={t.id}
                  tier={{
                    id: t.id,
                    label: t.label,
                    qty: t.qty,
                    recommended: t.recommended,
                  }}
                  disabled={!editable}
                />
              ))}
              {editable ? (
                <div className="setup-wizard-add-tier"><AddTierButton quoteId={quote.id} /></div>
              ) : null}
            </div>
          </div>
        )}
      </section>
      </div>
      {/* end .r1-setup-grid */}

          <div>
        <h2 className="setup-wizard-section-title">Freight</h2>
        <div className="mt-[9px] border-l-2 border-rule pl-4">
          <div id="setup-freight">
            <FreightIntentControl
              quoteId={quoteId}
              initialValue={quote.freightIntent}
              disabled={!editable}
            />
          </div>
        </div>
      </div>

      {/* §6.b Step 7 — Notes split per R7b designer notes §3.6.
          Two side-by-side audience-distinct cards (internal purple
          / customer-facing green). No wrapping Section card — the
          NotesEditor renders its own card chrome per zone. */}
      <div id="setup-notes">
        <NotesEditor
          quoteId={quote.id}
          projectId={projectId}
          internalNotes={quote.internalNotes}
          customerFacingNotes={quote.customerFacingNotes}
          disabled={!editable}
        />
      </div>

          <footer className="setup-wizard-footer">
            <span>Setup changes are saved as you go.</span>
            {editable ? (
              <Link
                className="setup-wizard-continue"
                href={costsUrl}
              >
                Continue to Costs <span aria-hidden="true">→</span>
              </Link>
            ) : null}
          </footer>
        </div>
      </div>

      {/* The wizard saves its draft as the operator works, then hands directly
          to the Costs surface. Review remains available only for old links. */}
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
