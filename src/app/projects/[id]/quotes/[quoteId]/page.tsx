import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, quotes, quoteTiers, users } from "@/db/schema";
// canonical-scenario-create-flow Step 3 — legacy SKU table imports
// removed: quoteSkus, packagingInputs, productionInputs (data
// sources), buildTreeRenderOrder, getEligibleParents (helpers),
// SkuRowList, SkuRowListItem, SkuFooter (components). All used by
// the legacy quote_skus render path which this slice drops. New
// path uses <AssemblyTreeView> exclusively.
import { loadAssemblyTree } from "@/lib/assembly-tree";
import { AssemblyTreeView } from "@/components/assembly-tree/assembly-tree-view";
import { loadProductTypeOptions } from "@/lib/product-type-options";
import { ensureUser } from "@/lib/auth/ensure-user";
import { loadQuoteAttachments } from "@/lib/quote-attachments-loader";
import { AttachmentListTrigger } from "@/components/quote-attachments/attachment-list-trigger";
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
import { TierRow } from "./tier-row";
import { TierPresetPicker } from "./tier-preset-picker";
import { NotesEditor } from "./notes-editor";

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

          Phase A.1 v2 impl-2 Step 3 — Setup IA shift per brief §5.2:
          SKUs to top, Tiers below. The `.r-a1v2-stack` modifier
          converts the grid to a single full-width column.

          impl-4 patch round (Bug, pre-prod-quote layout): applied
          UNCONDITIONALLY. Impl-2 originally gated this on
          usesNewSchema=true (Pattern 32 pre-prod tolerance);
          observation that every legacy quote_skus quote in v1
          retains the legacy ROOM-based renderer + thus the
          horizontal 2fr/1fr layout makes the inconsistency a
          permanent regression through v1 lifetime. Per brief intent,
          the IA shift was always meant for ALL Setup surfaces. */}
      <div className="r7b-grid r-a1v2-stack">

      {/* canonical-scenario-create-flow Step 3 — every quote
          renders the new ASY/LEAF tree. Legacy `<div className=
          "r7b-card">` SKU table + SkuRowList + SkuFooter chain
          removed alongside the read-path branching. AssemblyTreeView
          handles empty state internally ("No assemblies yet"). */}
      {assemblyTree ? (
        <AssemblyTreeView
          tree={assemblyTree}
          editable={editable}
          projectId={projectId}
          quoteId={quoteId}
          itemGroupCategories={productTypeOptions.itemGroupCategories}
          leafTypes={productTypeOptions.leafTypes}
          permissions={{ canCreateLeaves: user.canCreateLeaves }}
        />
      ) : null}

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
