"use server";

import { randomUUID } from "node:crypto";
import { renderToBuffer } from "@react-pdf/renderer";

import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { resolveCustomerView } from "@/lib/customer-view-resolver";
import { buildQuoteDocument } from "@/lib/quote-pdf-document";
import { addDaysToIsoDate, toLocalIsoDate } from "@/lib/local-date";
import {
  QUOTE_PDFS_BUCKET,
  buildQuotePdfStoragePath,
  getSupabaseServer,
} from "@/lib/supabase-server";
import {
  assemblies,
  assemblyLeafInputs,
  assemblyLeafOverrides,
  assemblyLeafTargets,
  assemblyLeaves,
  assemblyProductionInputs,
  auditLog,
  firmSettings,
  freightCustomerArrangesMeta,
  freightLegGroups,
  freightLegs,
  freightLegTiers,
  projects,
  quotes,
  quoteTiers,
  users,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  findHubspotOwnerById,
  searchProducts,
  type ProductSummary,
} from "@/lib/hubspot";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  ActionGuardError,
  ERR,
  quoteNotDraftMessage,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  loadCopySourceProjects,
  loadScenarioCopyPicker,
  type CopySourceProject,
  type CopySourceProjectsFilters,
  type ScenarioCopyPickerFilters,
  type ScenarioCopyPickerRow,
} from "@/lib/scenario-copy-loader";

// ---------- tier presets (internal — "use server" disallows non-async exports) ----------

type TierPresetKey =
  // R7b §3.5 empty-state picker presets (§6.b Step 6).
  | "pst_3step"
  | "pst_4step"
  | "pst_first"
  | "pst_volume"
  // Legacy presets (pre-§6.b TierPresetSelect dropdown). Retained
  // for backward compat with any external bookmarks / saved URLs.
  | "single_volume"
  | "reorder"
  | "packaging_domestic"
  | "packaging_overseas"
  | "soft_goods"
  | "custom";

type TierPresetRow = {
  label: string;
  qty: number | null;
  recommended?: boolean;
};

const TIER_PRESETS: Record<
  TierPresetKey,
  { label: string; tiers: Array<TierPresetRow> }
> = {
  // R7b §3.5 — 4 empty-state picker presets. Each marks one tier
  // as recommended per the brief / 7bsetup.jsx fixture (lines
  // 442-457). Action layer's "one recommended per quote" invariant
  // is satisfied by-construction since the picker only fires on
  // an empty tier set.
  pst_3step: {
    label: "3-tier step",
    tiers: [
      { label: "Tier 1", qty: 5000 },
      { label: "Tier 2", qty: 10000, recommended: true },
      { label: "Tier 3", qty: 25000 },
    ],
  },
  pst_4step: {
    label: "4-tier step",
    tiers: [
      { label: "Tier 1", qty: 5000 },
      { label: "Tier 2", qty: 10000, recommended: true },
      { label: "Tier 3", qty: 25000 },
      { label: "Tier 4", qty: 50000 },
    ],
  },
  pst_first: {
    label: "First-PO",
    tiers: [{ label: "Tier 1", qty: 10000, recommended: true }],
  },
  pst_volume: {
    label: "Volume break",
    tiers: [
      { label: "Tier 1", qty: 10000 },
      { label: "Tier 2", qty: 50000, recommended: true },
      { label: "Tier 3", qty: 100000 },
    ],
  },
  single_volume: {
    label: "Single Volume",
    tiers: [{ label: "Tier 1", qty: null }],
  },
  reorder: {
    label: "Reorder",
    tiers: [{ label: "Reorder", qty: null }],
  },
  packaging_domestic: {
    label: "Packaging — Domestic",
    tiers: [
      { label: "Tier 1", qty: 5000 },
      { label: "Tier 2", qty: 10000 },
      { label: "Tier 3", qty: 25000 },
      { label: "Tier 4", qty: 50000 },
    ],
  },
  packaging_overseas: {
    label: "Packaging — Overseas",
    tiers: [
      { label: "Tier 1", qty: 25000 },
      { label: "Tier 2", qty: 50000 },
      { label: "Tier 3", qty: 100000 },
      { label: "Tier 4", qty: 250000 },
    ],
  },
  soft_goods: {
    label: "Soft Goods",
    tiers: [
      { label: "Tier 1", qty: 1000 },
      { label: "Tier 2", qty: 5000 },
      { label: "Tier 3", qty: 10000 },
    ],
  },
  custom: {
    label: "Custom (start blank)",
    tiers: [],
  },
};

// ---------- helpers ----------

type Diff = Record<string, { from: unknown; to: unknown }>;

function diffOf<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Diff {
  const d: Diff = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (before[k] !== after[k]) {
      d[String(k)] = { from: before[k], to: after[k] };
    }
  }
  return d;
}

async function logAudit(args: {
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  diffJson?: object;
}) {
  await db.insert(auditLog).values({
    userId: args.userId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    diffJson: args.diffJson ?? {},
  });
}

async function loadQuoteOrThrow(quoteId: string) {
  const rows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.QUOTE_NOT_FOUND, "Quote not found");
  return rows[0];
}

function assertDraft(quote: { status: string }) {
  if (quote.status !== "draft") {
    throw new ActionGuardError(ERR.QUOTE_NOT_DRAFT, quoteNotDraftMessage(quote.status));
  }
}

function parseInt0(v: FormDataEntryValue | null, fallback: number): number {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function parseIntOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function trimOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

// ---------- quote-level actions ----------

// Initial-quote creator. Used by NextActionCard's "Open Setup →"
// button on just-created projects (no scenarios yet). Always
// creates the "Primary" scenario at versionNumber=1; if invoked
// when Primary already exists, increments versionNumber within
// Primary — historical behavior preserved so the "Open Setup"
// affordance stays idempotent for repeat clicks. PMs creating a
// distinct scenario family use `createScenario` (button position
// + label make the distinction; see below).
export async function createQuote(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) throw new Error("projectId required");

  const user = await ensureUser();

  const maxRow = await db
    .select({ max: max(quotes.versionNumber) })
    .from(quotes)
    .where(
      and(
        eq(quotes.projectId, projectId),
        eq(quotes.scenarioLabel, "Primary"),
      ),
    );
  const versionNumber = (maxRow[0]?.max ?? 0) + 1;

  const [quote] = await db
    .insert(quotes)
    .values({
      projectId,
      scenarioLabel: "Primary",
      scenarioStatus: "active",
      versionNumber,
      status: "draft",
      globalPriceAdjPct: "0",
      createdByUserId: user.id,
    })
    .returning({ id: quotes.id });

  await db.insert(quoteTiers).values({
    quoteId: quote.id,
    label: "Tier 1",
    qty: null,
    sortOrder: 0,
  });

  await logAudit({
    userId: user.id,
    entityType: "quote",
    entityId: quote.id,
    action: "created",
    diffJson: {
      project_id: projectId,
      scenario_label: "Primary",
      version_number: versionNumber,
    },
  });

  redirect(`/projects/${projectId}/quotes/${quote.id}`);
}

// canonical-scenario-create-flow — refactored from form-action
// signature to object-input + ActionResult shape per CC brief.
// Modal-driven create captures intent_note,
// customer_target_tier_label, is_recommended, drop choice; legacy
// auto-name "Alt N" path preserved when scenarioLabel is null.
//
// Returns ActionResult<{newQuoteId}>; client uses for router.push
// (vs prior redirect() inside the action, which is incompatible
// with the modal close → navigate UX).
export async function createScenario(input: {
  projectId: string;
  scenarioLabel?: string;
  intentNote?: string;
  customerTargetTierLabel?: string;
  scenarioRecommended: boolean;
  dropCurrentScenario: boolean;
  currentScenarioId?: string;
}): Promise<ActionResult<{ newQuoteId: string }>> {
  return runAction(async () => {
    const { projectId, scenarioRecommended, dropCurrentScenario } = input;
    if (!projectId)
      throw new ActionGuardError(ERR.VALIDATION, "projectId required");
    if (dropCurrentScenario && !input.currentScenarioId)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "currentScenarioId required when dropCurrentScenario is true",
      );

    const user = await ensureUser();

    // Resolve scenario label: PM-provided OR auto "Alt N" (next
    // integer not in use within project).
    let scenarioLabel = (input.scenarioLabel ?? "").trim();
    if (scenarioLabel.length === 0) {
      const existingScenarios = await db
        .selectDistinct({ scenarioLabel: quotes.scenarioLabel })
        .from(quotes)
        .where(eq(quotes.projectId, projectId));
      const existingLabels = new Set(
        existingScenarios.map((r) => r.scenarioLabel),
      );
      let n = 1;
      while (existingLabels.has(`Alt ${n}`)) n++;
      scenarioLabel = `Alt ${n}`;
    }

    const intentNote = (input.intentNote ?? "").trim() || null;
    const customerTargetTierLabel =
      (input.customerTargetTierLabel ?? "").trim() || null;

    // Transactional: handle the recommended-pin flip + new-row
    // insert + drop-current together. The partial unique index on
    // quotes(project_id) WHERE is_recommended = true requires the
    // siblings flip to land before the new row inserts (else two
    // rows would briefly hold the pin).
    let newQuoteId: string;
    await db.transaction(async (tx) => {
      if (scenarioRecommended) {
        await tx
          .update(quotes)
          .set({ isRecommended: false, updatedAt: new Date() })
          .where(eq(quotes.projectId, projectId));
      }

      const [row] = await tx
        .insert(quotes)
        .values({
          projectId,
          scenarioLabel,
          scenarioStatus: "active",
          versionNumber: 1,
          status: "draft",
          globalPriceAdjPct: "0",
          createdByUserId: user.id,
          intentNote,
          customerTargetTierLabel,
          isRecommended: scenarioRecommended,
        })
        .returning({ id: quotes.id });
      newQuoteId = row.id;

      await tx.insert(quoteTiers).values({
        quoteId: row.id,
        label: "Tier 1",
        qty: null,
        sortOrder: 0,
      });

      if (dropCurrentScenario && input.currentScenarioId) {
        // Family-level drop. The PM's "Drop the current scenario"
        // intent is to retire the scenario identity (e.g., "Primary"),
        // not just the one version row. Schema stores N rows per
        // scenario_label (one per version_number bump); the project
        // detail card groups by scenario_label, so a single-row drop
        // would leave the card showing the family as ACTIVE while
        // exactly one sibling row is dropped — discovered Bug CSF-3-A
        // on PR #49 CB smoke.
        //
        // Look up scenario_label from currentScenarioId, then update
        // ALL active rows in (project_id, scenario_label) to dropped.
        // Audit row emits at project level with dropped_quote_ids
        // array for forensic reconstruction.
        const [currentRow] = await tx
          .select({ scenarioLabel: quotes.scenarioLabel })
          .from(quotes)
          .where(eq(quotes.id, input.currentScenarioId))
          .limit(1);

        if (currentRow) {
          const dropped = await tx
            .update(quotes)
            .set({
              scenarioStatus: "dropped",
              dropReason: "manual",
              droppedByUserId: user.id,
              droppedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(quotes.projectId, projectId),
                eq(quotes.scenarioLabel, currentRow.scenarioLabel),
                eq(quotes.scenarioStatus, "active"),
              ),
            )
            .returning({ id: quotes.id });

          if (dropped.length > 0) {
            await tx.insert(auditLog).values({
              userId: user.id,
              entityType: "project",
              entityId: projectId,
              action: "scenario_dropped",
              diffJson: {
                drop_reason: "manual",
                triggered_by_new_scenario_id: row.id,
                scenario_label: currentRow.scenarioLabel,
                dropped_quote_ids: dropped.map((d) => d.id),
                audit_source: "canonical_modal",
              },
            });
          }
        }
      }

      // Audit: enhanced quote.created shape per CLAUDE.md namespace
      // (canonical-modal source tag).
      await tx.insert(auditLog).values({
        userId: user.id,
        entityType: "quote",
        entityId: row.id,
        action: "created",
        diffJson: {
          project_id: projectId,
          scenario_label: scenarioLabel,
          version_number: 1,
          intent_note: intentNote,
          customer_target_tier_label: customerTargetTierLabel,
          is_recommended: scenarioRecommended,
          drop_current_scenario_choice: dropCurrentScenario,
          audit_source: "canonical_modal",
        },
      });

      // setScenarioRecommended audit row for the flip event (when
      // applicable). Captures the from/to pair for cross-quote
      // forensic reconstruction.
      if (scenarioRecommended) {
        await tx.insert(auditLog).values({
          userId: user.id,
          entityType: "project",
          entityId: projectId,
          action: "scenario_recommended_changed",
          diffJson: {
            to_quote_id: row.id,
            project_id: projectId,
            audit_source: "canonical_modal",
          },
        });
      }
    });

    revalidatePath(`/projects/${projectId}`);

    return { newQuoteId: newQuoteId! };
  });
}

// canonical-scenario-create-flow — atomic recommendation pin flip
// (used by future post-creation surface affordances; createScenario
// embeds the same logic inline for the create-time path).
//
// Audit: `scenario_recommended_changed` with from/to/project_id
// shape per CLAUDE.md namespace.
export async function setScenarioRecommended(input: {
  quoteId: string;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { quoteId } = input;
    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

    const user = await ensureUser();

    const [target] = await db
      .select({ id: quotes.id, projectId: quotes.projectId })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (!target)
      throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found");

    // Capture the prior recommended quote (if any) for audit
    // from/to linkage.
    const [prior] = await db
      .select({ id: quotes.id })
      .from(quotes)
      .where(
        and(
          eq(quotes.projectId, target.projectId),
          eq(quotes.isRecommended, true),
        ),
      )
      .limit(1);

    await db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({ isRecommended: false, updatedAt: new Date() })
        .where(eq(quotes.projectId, target.projectId));

      await tx
        .update(quotes)
        .set({ isRecommended: true, updatedAt: new Date() })
        .where(eq(quotes.id, quoteId));

      await tx.insert(auditLog).values({
        userId: user.id,
        entityType: "project",
        entityId: target.projectId,
        action: "scenario_recommended_changed",
        diffJson: {
          from_quote_id: prior?.id ?? null,
          to_quote_id: quoteId,
          project_id: target.projectId,
        },
      });
    });

    revalidatePath(`/projects/${target.projectId}`);
  });
}

// canonical-scenario-create-flow Step 6 — `createScenarioLegacy`
// removed. Step 5's modal trigger fully replaces the form-action
// callsite per CA disposition "no backward-compat shim". Comment
// retained as forensic marker; the function lived in commits
// fce49e4 (Step 4) through e20722a (Step 5).

export type QuoteNotesSnapshot = {
  quoteId: string;
  internalNotes: string | null;
  customerFacingNotes: string | null;
};

export async function updateQuoteNotes(
  formData: FormData,
): Promise<ActionResult<QuoteNotesSnapshot>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

    const user = await ensureUser();
    const quote = await loadQuoteOrThrow(quoteId);
    assertDraft(quote);

    const internal = trimOrNull(formData.get("internalNotes"));
    const customer = trimOrNull(formData.get("customerFacingNotes"));

    const diff = diffOf(
      {
        internal_notes: quote.internalNotes,
        customer_facing_notes: quote.customerFacingNotes,
      },
      {
        internal_notes: internal,
        customer_facing_notes: customer,
      },
    );
    if (Object.keys(diff).length === 0) {
      return {
        quoteId,
        internalNotes: quote.internalNotes,
        customerFacingNotes: quote.customerFacingNotes,
      };
    }

    await db
      .update(quotes)
      .set({
        internalNotes: internal,
        customerFacingNotes: customer,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quoteId));

    await logAudit({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "notes_updated",
      diffJson: diff,
    });

    revalidateQuoteTree(quote.projectId, quoteId);

    return { quoteId, internalNotes: internal, customerFacingNotes: customer };
  });
}

// ---------- SKU actions ----------

/**
 * Search HubSpot Products from the client. Returns a small typed list
 * the SkuSearchPanel renders. Read-only — does not write to the DB.
 */
export async function searchHubspotProductsAction(
  query: string,
): Promise<ProductSummary[]> {
  await ensureUser();
  return searchProducts(query, 20);
}


// ---------- tier actions ----------

export async function addTier(formData: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

  const user = await ensureUser();
  const quote = await loadQuoteOrThrow(quoteId);
  assertDraft(quote);

  const maxRow = await db
    .select({ max: max(quoteTiers.sortOrder) })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quoteId));
  const sortOrder = (maxRow[0]?.max ?? -1) + 1;

  const [tier] = await db
    .insert(quoteTiers)
    .values({
      quoteId,
      label: `Tier ${sortOrder + 1}`,
      qty: null,
      sortOrder,
    })
    .returning({ id: quoteTiers.id });

  // Slice 11.5.1 — migrated to NEW-model. Auto-create empty
  // assembly_leaf_inputs rows for this new tier across every existing
  // line group (one row per line × the new tier). Keeps the
  // (line × tier) grid contiguous so the UI doesn't have to render
  // holes. Dedupe by line_group_id at the action layer; the unique
  // constraint on (assembly_leaf, line_group, tier) catches any
  // accidental dupes.
  const existingLines = await db
    .select({
      lineGroupId: assemblyLeafInputs.lineGroupId,
      assemblyLeafId: assemblyLeafInputs.assemblyLeafId,
      sortOrder: assemblyLeafInputs.sortOrder,
      supplier: assemblyLeafInputs.supplier,
      qtyPerSellableUnit: assemblyLeafInputs.qtyPerSellableUnit,
      category: assemblyLeafInputs.category,
      markupPct: assemblyLeafInputs.markupPct,
      markupPctSource: assemblyLeafInputs.markupPctSource,
      inventoryEligible: assemblyLeafInputs.inventoryEligible,
      notes: assemblyLeafInputs.notes,
    })
    .from(assemblyLeafInputs)
    .innerJoin(
      assemblyLeaves,
      eq(assemblyLeaves.id, assemblyLeafInputs.assemblyLeafId),
    )
    .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
    .where(eq(assemblies.quoteId, quoteId));

  const seen = new Set<string>();
  const newRows: (typeof assemblyLeafInputs.$inferInsert)[] = [];
  for (const l of existingLines) {
    if (seen.has(l.lineGroupId)) continue;
    seen.add(l.lineGroupId);
    newRows.push({
      assemblyLeafId: l.assemblyLeafId,
      tierId: tier.id,
      lineGroupId: l.lineGroupId,
      sortOrder: l.sortOrder,
      supplier: l.supplier,
      qtyPerSellableUnit: l.qtyPerSellableUnit,
      category: l.category,
      markupPct: l.markupPct,
      markupPctSource: l.markupPctSource,
      inventoryEligible: l.inventoryEligible,
      notes: l.notes,
      // unit_cost and purchase_qty start null on the new tier — PM fills in.
    });
  }
  if (newRows.length > 0) {
    await db.insert(assemblyLeafInputs).values(newRows);
  }

  // Slice 11.5.1 — migrated to NEW-model. assembly_production_inputs
  // rows auto-create per (assembly × tier) instead of per (leaf SKU ×
  // tier) — production policy lives at assembly level in NEW model.
  // Walk every assembly in the quote, inherit policy from any existing
  // production row for that assembly (so the new tier gets the
  // assembly's current customer_ships_raws / allocate_service_fees_to_cost
  // / notes), insert one row per assembly at the new tier.
  const quoteAssemblies = await db
    .select({ id: assemblies.id })
    .from(assemblies)
    .where(eq(assemblies.quoteId, quoteId));
  let productionRowsSeeded = 0;
  if (quoteAssemblies.length > 0) {
    const assemblyIds = quoteAssemblies.map((a) => a.id);
    const existingPolicy = await db
      .selectDistinctOn([assemblyProductionInputs.assemblyId], {
        assemblyId: assemblyProductionInputs.assemblyId,
        customerShipsRaws: assemblyProductionInputs.customerShipsRaws,
        allocateServiceFeesToCost:
          assemblyProductionInputs.allocateServiceFeesToCost,
        notes: assemblyProductionInputs.notes,
      })
      .from(assemblyProductionInputs)
      .where(inArray(assemblyProductionInputs.assemblyId, assemblyIds));
    const policyByAssembly = new Map(
      existingPolicy.map((p) => [p.assemblyId, p]),
    );
    const newProdRows: (typeof assemblyProductionInputs.$inferInsert)[] =
      quoteAssemblies.map((a) => {
        const p = policyByAssembly.get(a.id);
        return {
          assemblyId: a.id,
          tierId: tier.id,
          customerShipsRaws: p?.customerShipsRaws ?? false,
          allocateServiceFeesToCost: p?.allocateServiceFeesToCost ?? true,
          notes: p?.notes ?? null,
          // per-tier costs intentionally null — PM fills in.
        };
      });
    await db.insert(assemblyProductionInputs).values(newProdRows);
    productionRowsSeeded = newProdRows.length;
  }

  // Slice R6.2 — seed `freight_leg_tiers` rows for the new tier
  // across every existing leg in the quote. Per-(leg, tier) rate
  // data starts null; PM enters totals after the tier lands. Replaces
  // the legacy `freight_inputs` per-line tier fanout (which encoded
  // freight as per-(SKU, line)).
  const existingLegs = await db
    .select({ id: freightLegs.id })
    .from(freightLegs)
    .innerJoin(
      freightLegGroups,
      eq(freightLegGroups.id, freightLegs.legGroupId),
    )
    .where(eq(freightLegGroups.quoteId, quoteId));
  let freightRowsSeeded = 0;
  if (existingLegs.length > 0) {
    await db.insert(freightLegTiers).values(
      existingLegs.map((leg) => ({
        freightLegId: leg.id,
        tierId: tier.id,
        totalFreight: null,
        unitsInShipment: null,
      })),
    );
    freightRowsSeeded = existingLegs.length;
  }

  await logAudit({
    userId: user.id,
    entityType: "quote_tier",
    entityId: tier.id,
    action: "created",
    diffJson: {
      quote_id: quoteId,
      sort_order: sortOrder,
      packaging_rows_seeded: newRows.length,
      production_rows_seeded: productionRowsSeeded,
      freight_rows_seeded: freightRowsSeeded,
    },
  });

  revalidateQuoteTree(quote.projectId, quoteId);
  });
}

export type TierEditableSnapshot = {
  tierId: string;
  label: string;
  qty: number | null;
};

export async function updateTier(
  formData: FormData,
): Promise<ActionResult<TierEditableSnapshot>> {
  return runAction(async () => {
  const tierId = String(formData.get("tierId") ?? "").trim();
  if (!tierId) throw new ActionGuardError(ERR.VALIDATION, "tierId required");

  const user = await ensureUser();
  const tierRows = await db
    .select()
    .from(quoteTiers)
    .where(eq(quoteTiers.id, tierId))
    .limit(1);
  if (tierRows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found");
  const tier = tierRows[0];

  const quote = await loadQuoteOrThrow(tier.quoteId);
  assertDraft(quote);

  const newLabel = String(formData.get("label") ?? "").trim() || tier.label;
  const newQty = parseIntOrNull(formData.get("qty"));

  const before = { label: tier.label, qty: tier.qty };
  const after = { label: newLabel, qty: newQty };
  const diff = diffOf(before, after);
  if (Object.keys(diff).length === 0) {
    return { tierId, label: tier.label, qty: tier.qty };
  }

  await db
    .update(quoteTiers)
    .set({ label: newLabel, qty: newQty, updatedAt: new Date() })
    .where(eq(quoteTiers.id, tierId));

  await logAudit({
    userId: user.id,
    entityType: "quote_tier",
    entityId: tierId,
    action: "updated",
    diffJson: diff,
  });

  revalidateQuoteTree(quote.projectId, tier.quoteId);

  return { tierId, label: newLabel, qty: newQty };
  });
}

// §6.b Step 5 prep — set/clear the per-quote ★ Recommended tier flag.
//
// One tier per quote can be recommended. Setting recommended=true on
// tier T clears recommended on all siblings in the same quote atomically.
// Setting recommended=false on T just clears T (no sibling fan-out).
//
// Invariant enforced at the action layer; no DB constraint v1. Single-user
// concurrency at Nexus scale makes the race-condition risk negligible.
export async function setTierRecommended(
  formData: FormData,
): Promise<ActionResult<{ tierId: string; recommended: boolean }>> {
  return runAction(async () => {
    const tierId = String(formData.get("tierId") ?? "").trim();
    if (!tierId) throw new ActionGuardError(ERR.VALIDATION, "tierId required");
    const recommended =
      String(formData.get("recommended") ?? "").toLowerCase() === "true";

    const user = await ensureUser();
    const tierRows = await db
      .select()
      .from(quoteTiers)
      .where(eq(quoteTiers.id, tierId))
      .limit(1);
    if (tierRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found");
    const tier = tierRows[0];

    const quote = await loadQuoteOrThrow(tier.quoteId);
    assertDraft(quote);

    if (tier.recommended === recommended) {
      return { tierId, recommended };
    }

    if (recommended) {
      // Clear sibling rows first (one-per-quote invariant), then set this row.
      await db
        .update(quoteTiers)
        .set({ recommended: false, updatedAt: new Date() })
        .where(
          and(
            eq(quoteTiers.quoteId, tier.quoteId),
            eq(quoteTiers.recommended, true),
          ),
        );
    }
    await db
      .update(quoteTiers)
      .set({ recommended, updatedAt: new Date() })
      .where(eq(quoteTiers.id, tierId));

    await logAudit({
      userId: user.id,
      entityType: "quote_tier",
      entityId: tierId,
      action: "recommended_updated",
      diffJson: { recommended: { from: tier.recommended, to: recommended } },
    });

    revalidateQuoteTree(quote.projectId, tier.quoteId);

    return { tierId, recommended };
  });
}

export async function deleteTier(formData: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
  const tierId = String(formData.get("tierId") ?? "").trim();
  if (!tierId) throw new ActionGuardError(ERR.VALIDATION, "tierId required");

  const user = await ensureUser();
  const tierRows = await db
    .select()
    .from(quoteTiers)
    .where(eq(quoteTiers.id, tierId))
    .limit(1);
  if (tierRows.length === 0) return;
  const tier = tierRows[0];

  const quote = await loadQuoteOrThrow(tier.quoteId);
  assertDraft(quote);

  await db.delete(quoteTiers).where(eq(quoteTiers.id, tierId));

  await logAudit({
    userId: user.id,
    entityType: "quote_tier",
    entityId: tierId,
    action: "deleted",
    diffJson: { label: tier.label, qty: tier.qty },
  });

  revalidateQuoteTree(quote.projectId, tier.quoteId);
  });
}

export async function moveTier(formData: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
  const tierId = String(formData.get("tierId") ?? "").trim();
  const direction = String(formData.get("direction") ?? "") as "up" | "down";
  if (!tierId) throw new ActionGuardError(ERR.VALIDATION, "tierId required");
  if (direction !== "up" && direction !== "down")
    throw new ActionGuardError(ERR.VALIDATION, "direction must be up or down");

  const user = await ensureUser();
  const tierRows = await db
    .select()
    .from(quoteTiers)
    .where(eq(quoteTiers.id, tierId))
    .limit(1);
  if (tierRows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found");
  const tier = tierRows[0];

  const quote = await loadQuoteOrThrow(tier.quoteId);
  assertDraft(quote);

  const siblings = await db
    .select()
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, tier.quoteId))
    .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt));

  const idx = siblings.findIndex((s) => s.id === tierId);
  const swapWith = direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
  if (!swapWith) return;

  await db.transaction(async (tx) => {
    await tx
      .update(quoteTiers)
      .set({ sortOrder: swapWith.sortOrder, updatedAt: new Date() })
      .where(eq(quoteTiers.id, tier.id));
    await tx
      .update(quoteTiers)
      .set({ sortOrder: tier.sortOrder, updatedAt: new Date() })
      .where(eq(quoteTiers.id, swapWith.id));
  });

  await logAudit({
    userId: user.id,
    entityType: "quote_tier",
    entityId: tierId,
    action: "reordered",
    diffJson: { sort_order: { from: tier.sortOrder, to: swapWith.sortOrder } },
  });

  revalidateQuoteTree(quote.projectId, tier.quoteId);
  });
}

// Wholesale tier-replace: deletes all current tiers (cascading
// through assembly_leaf_inputs + assembly_production_inputs +
// freight_leg_tiers), inserts the preset's new tier set, then
// reseeds the cascaded rows from snapshots taken before the delete.
//
// Slice 11.5.1 — migrated to NEW model. Three snapshot+reseed
// loops:
// - `preservedLines` (assembly_leaf_inputs lines, deduped by
//   line_group_id): preserves supplier/category/markup metadata;
//   unit_cost/purchase_qty reset because per-tier values depend
//   on volume.
// - `preservedProductionPolicy` (assembly_production_inputs
//   denormalized policy per assembly, NOT per leaf — production
//   policy lives at assembly level in NEW model): preserves
//   customer_ships_raws/allocate_service_fees_to_cost/notes;
//   per-tier costs reset.
// - `preservedFreightLegs` (legs survive tier wipe via leg-quote
//   FK; only per-(leg, tier) rate rows cascade-delete): freight
//   per-tier rates reset.
//
// Forensic snapshots (`productionDataLost`, `freightDataLost`)
// capture non-null cost data in audit_log diff_json before the
// cascade wipes them, so PM-relevant losses are reconstructable
// from audit history if needed post-merge.
export async function applyTierPreset(formData: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  const presetKey = String(formData.get("preset") ?? "").trim() as TierPresetKey;
  if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
  if (!(presetKey in TIER_PRESETS))
    throw new ActionGuardError(ERR.VALIDATION, `Unknown preset: ${presetKey}`);

  const user = await ensureUser();
  const quote = await loadQuoteOrThrow(quoteId);
  assertDraft(quote);

  const preset = TIER_PRESETS[presetKey];

  const before = await db
    .select({ id: quoteTiers.id, label: quoteTiers.label, qty: quoteTiers.qty })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quoteId))
    .orderBy(asc(quoteTiers.sortOrder));

  // Slice 11.5.1 — migrated to NEW-model. Snapshot existing packaging
  // line metadata BEFORE deleting tiers (the delete cascades through
  // assembly_leaf_inputs and would otherwise wipe the line work the
  // PM did). After re-creating tiers, we reseed assembly_leaf_inputs
  // with empty unit_cost / purchase_qty for each preserved line ×
  // each new tier. Same shape applies to assembly_production_inputs
  // and freight_leg_tiers.
  const preservedLines = await db
    .selectDistinctOn([assemblyLeafInputs.lineGroupId], {
      lineGroupId: assemblyLeafInputs.lineGroupId,
      assemblyLeafId: assemblyLeafInputs.assemblyLeafId,
      sortOrder: assemblyLeafInputs.sortOrder,
      supplier: assemblyLeafInputs.supplier,
      qtyPerSellableUnit: assemblyLeafInputs.qtyPerSellableUnit,
      category: assemblyLeafInputs.category,
      markupPct: assemblyLeafInputs.markupPct,
      markupPctSource: assemblyLeafInputs.markupPctSource,
      inventoryEligible: assemblyLeafInputs.inventoryEligible,
      notes: assemblyLeafInputs.notes,
    })
    .from(assemblyLeafInputs)
    .innerJoin(
      assemblyLeaves,
      eq(assemblyLeaves.id, assemblyLeafInputs.assemblyLeafId),
    )
    .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
    .where(eq(assemblies.quoteId, quoteId))
    .orderBy(
      asc(assemblyLeafInputs.lineGroupId),
      asc(assemblyLeafInputs.createdAt),
    );

  // Slice 11.5.1 — production policy snapshot now keyed by assembly_id
  // (NEW-model: production policy attaches per-assembly, not per-leaf).
  // One row per assembly; values come from any existing
  // assembly_production_inputs row for that assembly (denormalized,
  // so any row carries the policy).
  const preservedProductionPolicy = await db
    .selectDistinctOn([assemblyProductionInputs.assemblyId], {
      assemblyId: assemblyProductionInputs.assemblyId,
      customerShipsRaws: assemblyProductionInputs.customerShipsRaws,
      allocateServiceFeesToCost:
        assemblyProductionInputs.allocateServiceFeesToCost,
      notes: assemblyProductionInputs.notes,
    })
    .from(assemblyProductionInputs)
    .innerJoin(
      assemblies,
      eq(assemblies.id, assemblyProductionInputs.assemblyId),
    )
    .where(eq(assemblies.quoteId, quoteId));

  // Forensic snapshot — capture every (assembly, tier) row with
  // non-null cost data or actual_units_produced before the cascade
  // wipes them. Filter out empty bookkeeping rows (no data lost =
  // no audit value).
  const allProductionRows = await db
    .select()
    .from(assemblyProductionInputs)
    .innerJoin(
      assemblies,
      eq(assemblies.id, assemblyProductionInputs.assemblyId),
    )
    .where(eq(assemblies.quoteId, quoteId));
  const productionDataLost = allProductionRows
    .map((r) => r.assembly_production_inputs)
    .filter(
      (r) =>
        r.actualUnitsProduced !== null ||
        r.fillingBlendingCost !== null ||
        r.cmAssemblyTotal !== null ||
        r.setupFeeTotal !== null ||
        r.toolingArtworkTotal !== null ||
        r.rdTotal !== null ||
        r.otherServiceTotal !== null ||
        r.bulkRawCost !== null,
    )
    .map((r) => ({
      assembly_id: r.assemblyId,
      tier_id: r.tierId,
      actual_units_produced: r.actualUnitsProduced,
      filling_blending_cost: r.fillingBlendingCost,
      cm_assembly_total: r.cmAssemblyTotal,
      setup_fee_total: r.setupFeeTotal,
      tooling_artwork_total: r.toolingArtworkTotal,
      rd_total: r.rdTotal,
      other_service_total: r.otherServiceTotal,
      bulk_raw_cost: r.bulkRawCost,
    }));

  // Slice R6.2 — freight legs survive the tier-replace (legs FK to
  // quote, not to tier). Only per-(leg, tier) rate rows cascade-delete
  // with the tier wipe. We re-seed them after the new tiers land.
  const preservedFreightLegs = await db
    .select({ id: freightLegs.id })
    .from(freightLegs)
    .innerJoin(
      freightLegGroups,
      eq(freightLegGroups.id, freightLegs.legGroupId),
    )
    .where(eq(freightLegGroups.quoteId, quoteId));

  // Forensic snapshot — capture every (leg, tier) row with non-null
  // total_freight or units_in_shipment before cascade wipes them.
  const allLegTierRows = await db
    .select({ row: freightLegTiers })
    .from(freightLegTiers)
    .innerJoin(freightLegs, eq(freightLegs.id, freightLegTiers.freightLegId))
    .innerJoin(
      freightLegGroups,
      eq(freightLegGroups.id, freightLegs.legGroupId),
    )
    .where(eq(freightLegGroups.quoteId, quoteId));
  const freightDataLost = allLegTierRows
    .map((r) => r.row)
    .filter((r) => r.totalFreight !== null || r.unitsInShipment !== null)
    .map((r) => ({
      freight_leg_id: r.freightLegId,
      tier_id: r.tierId,
      total_freight: r.totalFreight,
      units_in_shipment: r.unitsInShipment,
    }));

  let cellsSeeded = 0;
  let productionCellsSeeded = 0;
  let freightCellsSeeded = 0;
  await db.transaction(async (tx) => {
    // Delete all existing tiers — cascade kills all packaging_inputs rows.
    // (Per-tier cost values are intentionally lost; different volumes
    // mean different costs anyway.)
    await tx.delete(quoteTiers).where(eq(quoteTiers.quoteId, quoteId));

    if (preset.tiers.length === 0) return;

    const newTiers = await tx
      .insert(quoteTiers)
      .values(
        preset.tiers.map((t, i) => ({
          quoteId,
          label: t.label,
          qty: t.qty,
          sortOrder: i,
          // §6.b Step 6 — R7b §3.5 presets mark one tier as
          // recommended. "One per quote" invariant satisfied by
          // construction (picker only fires on empty tier set).
          recommended: t.recommended ?? false,
        })),
      )
      .returning({ id: quoteTiers.id });

    // Slice 11.5.1 — reseed assembly_leaf_inputs: each preserved
    // line × each new tier.
    if (preservedLines.length > 0) {
      const seedRows: (typeof assemblyLeafInputs.$inferInsert)[] = [];
      for (const line of preservedLines) {
        for (const tier of newTiers) {
          seedRows.push({
            assemblyLeafId: line.assemblyLeafId,
            tierId: tier.id,
            lineGroupId: line.lineGroupId,
            sortOrder: line.sortOrder,
            supplier: line.supplier,
            qtyPerSellableUnit: line.qtyPerSellableUnit,
            category: line.category,
            markupPct: line.markupPct,
            markupPctSource: line.markupPctSource,
            inventoryEligible: line.inventoryEligible,
            notes: line.notes,
            // unit_cost and purchase_qty intentionally null — costs
            // reset because they depend on the tier volume.
          });
        }
      }
      await tx.insert(assemblyLeafInputs).values(seedRows);
      cellsSeeded = seedRows.length;
    }

    // Slice 11.5.1 — reseed assembly_production_inputs: each
    // assembly's preserved policy × each new tier. Per-tier costs
    // and actual_units_produced intentionally null — already
    // snapshotted into productionDataLost for the audit row.
    if (preservedProductionPolicy.length > 0) {
      const seedRows: (typeof assemblyProductionInputs.$inferInsert)[] = [];
      for (const policy of preservedProductionPolicy) {
        for (const tier of newTiers) {
          seedRows.push({
            assemblyId: policy.assemblyId,
            tierId: tier.id,
            customerShipsRaws: policy.customerShipsRaws,
            allocateServiceFeesToCost: policy.allocateServiceFeesToCost,
            notes: policy.notes,
          });
        }
      }
      await tx.insert(assemblyProductionInputs).values(seedRows);
      productionCellsSeeded = seedRows.length;
    }

    // Slice R6.2 — reseed `freight_leg_tiers`: each preserved leg ×
    // each new tier. Per-tier costs intentionally null; PM re-enters
    // (different tier volumes typically mean different freight $
    // totals anyway, mirroring the packaging/production policy).
    if (preservedFreightLegs.length > 0) {
      const seedRows: (typeof freightLegTiers.$inferInsert)[] = [];
      for (const leg of preservedFreightLegs) {
        for (const tier of newTiers) {
          seedRows.push({
            freightLegId: leg.id,
            tierId: tier.id,
            totalFreight: null,
            unitsInShipment: null,
          });
        }
      }
      await tx.insert(freightLegTiers).values(seedRows);
      freightCellsSeeded = seedRows.length;
    }
  });

  await logAudit({
    userId: user.id,
    entityType: "quote",
    entityId: quoteId,
    action: "tier_preset_applied",
    diffJson: {
      preset: presetKey,
      replaced: {
        from: before.map((t) => ({ label: t.label, qty: t.qty })),
        to: preset.tiers.map((t) => ({ label: t.label, qty: t.qty })),
      },
      packaging_lines_preserved: preservedLines.length,
      packaging_cells_seeded: cellsSeeded,
      production_skus_preserved: preservedProductionPolicy.length,
      production_cells_seeded: productionCellsSeeded,
      production_data_lost: productionDataLost,
      freight_legs_preserved: preservedFreightLegs.length,
      freight_cells_seeded: freightCellsSeeded,
      freight_data_lost: freightDataLost,
    },
  });

  revalidateQuoteTree(quote.projectId, quoteId);
  });
}

// ---------- Slice RI.7 — state-machine actions ----------
// Per docs/ri7-state-machine.md (CR-SM, decisions DEC-1..DEC-8).

// DEC-4 + DEC-7 + DEC-8: sendQuote transitions a draft to sent.
//   - Assigns customer-facing quote_number from quote_number_seq
//     (prefixed with firm_settings.quote_number_prefix).
//   - Snapshots commercial defaults onto the quote row (DEC-7).
//   - Snapshots PreparedBy contact (name/email/phone) onto the quote
//     row (DEC-8). Resolution chain: projects.salesRepUserId → users
//     first; HubSpot one-shot fetch by hubspot_owner_id as fallback
//     for un-signed-in-rep. Phone is always null from HubSpot path
//     (Owners API has no phone — manual users.phone entry only).
//   - Computes valid_until = today + firm_settings.days_valid_default
//     days (NULL if days_valid_default not configured; PdfTerms shows
//     "—" in that case).
//
// All writes happen in one transaction with two audit_log rows:
//   - quote_sent: { quote_number, valid_until, snapshots }
//   - prepared_by_snapshotted: { name, email, phone, derived_from }
//
// UI affordance for RI.7: the customer-view preview-toolbar Download
// buttons trigger this (stubbed PDF generation; Slice 11 wires real
// PDF render + email). Costs / Pricing status banners
// pick up the new 'sent' state via existing requireDraft guards.
export async function sendQuote(
  formData: FormData,
): Promise<ActionResult<{ quoteNumber: string; sentAt: Date }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    if (!quoteId) {
      throw new ActionGuardError(ERR.VALIDATION, "quoteId is required.");
    }

    const quote = await loadQuoteOrThrow(quoteId);
    assertDraft(quote);

    // At-least-one-tier-with-qty + at-least-one-SKU sanity gates.
    const [tierCount, skuCount] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(quoteTiers)
        .where(
          and(
            eq(quoteTiers.quoteId, quoteId),
            sql`${quoteTiers.qty} IS NOT NULL`,
          ),
        ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(assemblies)
        .where(eq(assemblies.quoteId, quoteId)),
    ]);
    if ((tierCount[0]?.n ?? 0) === 0) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Quote needs at least one tier with a quantity before it can be sent.",
      );
    }
    if ((skuCount[0]?.n ?? 0) === 0) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Quote needs at least one SKU before it can be sent.",
      );
    }

    // Load project + firm_settings (current) in parallel.
    const [projectRows, firmRows] = await Promise.all([
      db
        .select()
        .from(projects)
        .where(eq(projects.id, quote.projectId))
        .limit(1),
      db
        .select()
        .from(firmSettings)
        .where(isNull(firmSettings.effectiveUntil))
        .orderBy(desc(firmSettings.effectiveFrom))
        .limit(1),
    ]);
    if (projectRows.length === 0) {
      throw new ActionGuardError(ERR.NOT_FOUND, "Project not found.");
    }
    if (firmRows.length === 0) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "No active firm settings row; configure firm settings before sending quotes.",
      );
    }
    const project = projectRows[0];
    const firm = firmRows[0];

    if (!firm.quoteNumberPrefix) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Quote-number prefix is not configured in firm settings.",
      );
    }

    // PreparedBy resolution (DEC-8).
    type PreparedBy = {
      name: string;
      email: string;
      phone: string | null;
      derivedFrom: "users.id" | "hubspot_owner_id";
    };
    let preparedBy: PreparedBy | null = null;

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
          phone: rep.phone ?? null,
          derivedFrom: "users.id",
        };
      }
    }
    if (!preparedBy && project.hubspotOwnerId) {
      const owner = await findHubspotOwnerById(project.hubspotOwnerId);
      if (owner && owner.email) {
        preparedBy = {
          name: owner.name ?? owner.email,
          email: owner.email,
          phone: null, // HubSpot Owners API has no phone — verified.
          derivedFrom: "hubspot_owner_id",
        };
      }
    }
    if (!preparedBy) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Deal owner could not be resolved. Refresh deal context and retry, or assign a sales rep in HubSpot.",
      );
    }

    const sentAt = new Date();
    const daysValid = firm.daysValidDefault ?? null;

    // Slice 11 Step 6 FU — timezone-safe valid_until derivation.
    // Was: `CURRENT_DATE + N days` (Postgres, session-tz-dependent
    // — Supabase server tz = UTC, so 30 days from UTC date not
    // from PDT date). Now: compute in JS from sentAt in Nexus
    // operational tz. sendAtDate = 2026-07-14 for a send at
    // 9:44 PM PDT (was 2026-07-15 under UTC).
    const sentAtIso = toLocalIsoDate(sentAt);
    const validUntilIso =
      daysValid !== null ? addDaysToIsoDate(sentAtIso, daysValid) : null;

    // Slice 11 Step 6.6 — render + upload BEFORE the transaction
    // (per brief §4 disposition — "render+upload before marking
    // sent, so a sent quote always has its artifact").
    //
    // The resolver reads quote.status === 'draft' (still true at
    // this point) → draft branch → live firm defaults + live
    // prepared-by. These are exactly the values the tx below is
    // about to snapshot. Consistency by ordering: the render
    // uses the same values that become the immutable snapshot.
    //
    // Failure semantics: render or upload error → the send does
    // not proceed (throw propagates out of runAction). Tx never
    // runs; quote remains draft. If tx fails AFTER upload
    // succeeds, orphan file remains in storage — acceptable cost
    // per brief lean.
    const sendUuid = randomUUID();
    const resolved = await resolveCustomerView({ quoteId });
    if (!resolved.ok) {
      throw new ActionGuardError(
        resolved.kind === "not_found" ? ERR.NOT_FOUND : ERR.VALIDATION,
        resolved.kind === "not_found"
          ? "Quote not found during send-time render."
          : `Costing bundle error during send-time render: ${resolved.message}`,
      );
    }

    const todayIso = sentAt.toISOString().slice(0, 10);
    const doc = buildQuoteDocument({
      view: resolved.view,
      addendumData: resolved.addendumData,
      todayIso,
    });
    const buffer = await renderToBuffer(doc);

    const supabase = getSupabaseServer();
    const storagePath = buildQuotePdfStoragePath(quoteId, sendUuid);
    const upload = await supabase.storage
      .from(QUOTE_PDFS_BUCKET)
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (upload.error) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `PDF upload failed: ${upload.error.message}`,
      );
    }

    // 30-day signed URL for internal PM re-download convenience
    // (D2 — internal-only; never handed to customer). Refresh on
    // demand by re-signing; the file itself lives forever.
    const signed = await supabase.storage
      .from(QUOTE_PDFS_BUCKET)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30);
    if (signed.error || !signed.data?.signedUrl) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `PDF signed URL generation failed: ${signed.error?.message ?? "no url"}`,
      );
    }
    const pdfUrl = signed.data.signedUrl;

    const result = await db.transaction(async (tx) => {
      // Pull next quote number from the sequence inside the transaction
      // so the audit + UPDATE see the same value.
      const seqResult = (await tx.execute(
        sql`SELECT nextval('quote_number_seq') AS next`,
      )) as unknown as Array<{ next: string | number }>;
      const next = String(seqResult[0].next);
      const quoteNumber = `${firm.quoteNumberPrefix}-${next}`;

      // Slice 11 Step 4 — customer-PDF snapshot fleet. Read current
      // draft-column values; fall back to canonical defaults for
      // legacy quotes that never toggled. sendQuote writes them
      // back explicitly so the audit `diff_json.snapshots` marks
      // the send-time state even when the columns were already
      // populated from earlier PM toggles. Retrofits pdf_layout
      // into the snapshot fleet (pre-Slice-11 it was render-time-
      // only).
      const pdfLayoutSnapshot = quote.pdfLayoutSnapshot ?? "tier_table";
      const detailLevelSnapshot = quote.detailLevelSnapshot ?? "itemized";
      const includeSpecAddendumSnapshot =
        quote.includeSpecAddendumSnapshot ?? false;

      const [updated] = await tx
        .update(quotes)
        .set({
          status: "sent",
          sentAt,
          quoteNumber,
          validUntil: validUntilIso,
          // DEC-7: commercial snapshots
          tcsSnapshot: firm.tcsDefault ?? null,
          paymentTermsSnapshot: firm.paymentTermsDefault ?? null,
          leadTimeSnapshot: firm.leadTimeDefault ?? null,
          incotermsSnapshot: firm.incotermsDefault ?? null,
          daysValidSnapshot: daysValid,
          // DEC-8: PreparedBy snapshots
          preparedByNameSnapshot: preparedBy.name,
          preparedByEmailSnapshot: preparedBy.email,
          preparedByPhoneSnapshot: preparedBy.phone,
          // Slice 11 Step 4: customer-PDF render axes snapshots
          pdfLayoutSnapshot,
          detailLevelSnapshot,
          includeSpecAddendumSnapshot,
          // Slice 11 Step 6.6: persisted PDF signed URL
          // (internal-only per D2; regenerable via signed URL
          // refresh — storage file itself is the artifact).
          pdfUrl,
          updatedAt: sentAt,
        })
        .where(eq(quotes.id, quoteId))
        .returning();

      // Single audit row per send. PreparedBy snapshot lives in the
      // diff_json sub-object — no independent emit path (snapshots are
      // immutable for sent quotes per DEC-8; no other action writes
      // these fields). Folding avoids audit row duplication.
      await tx.insert(auditLog).values({
        userId: user.id,
        entityType: "quote",
        entityId: quoteId,
        action: "quote_sent",
        diffJson: {
          quoteNumber,
          validUntil: updated.validUntil,
          snapshots: {
            tcs: firm.tcsDefault ?? null,
            paymentTerms: firm.paymentTermsDefault ?? null,
            leadTime: firm.leadTimeDefault ?? null,
            incoterms: firm.incotermsDefault ?? null,
            daysValid,
            // Slice 11 Step 4 — customer-PDF render axes
            pdfLayout: pdfLayoutSnapshot,
            detailLevel: detailLevelSnapshot,
            includeSpecAddendum: includeSpecAddendumSnapshot,
          },
          // Slice 11 Step 6.6 — persisted PDF forensic markers.
          // sendUuid ties to the storage-path file for audit
          // reconstruction; pdfUrl captured for point-in-time
          // record (signed URLs expire; storage path + bucket
          // are permanent).
          pdf: {
            bucket: QUOTE_PDFS_BUCKET,
            storagePath,
            sendUuid,
          },
          preparedBy: {
            name: preparedBy.name,
            email: preparedBy.email,
            phone: preparedBy.phone,
            derived_from: preparedBy.derivedFrom,
          },
        },
      });

      return { quoteNumber, sentAt };
    });

    revalidateQuoteTree(quote.projectId, quoteId);
    return result;
  });
}

// DEC-1 + DEC-2: record the customer signal as a timestamped event,
// distinct from PM finalization via Mark-Accepted. PM clicks
// "Customer responded · Tier N" on Pricing adjacent to the
// Mark-Accepted cluster. The quote stays at status='sent'; the
// `customer_accepted_at IS NOT NULL` tuple is the awaiting-mark
// sub-state (Mark-Accepted page renders affirmation chip).
export async function recordCustomerAcceptance(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    const emailRef = String(formData.get("emailRef") ?? "").trim() || null;
    if (!quoteId || !tierId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "quoteId and tierId are required.",
      );
    }

    const quote = await loadQuoteOrThrow(quoteId);
    if (quote.status !== "sent") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Cannot record customer acceptance on a ${quote.status} quote — only sent quotes.`,
      );
    }

    // Verify the tier belongs to this quote.
    const [tier] = await db
      .select()
      .from(quoteTiers)
      .where(and(eq(quoteTiers.id, tierId), eq(quoteTiers.quoteId, quoteId)))
      .limit(1);
    if (!tier) {
      throw new ActionGuardError(
        ERR.NOT_FOUND,
        "Tier not found on this quote.",
      );
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({
          customerAcceptedAt: now,
          customerAcceptedTierId: tierId,
          customerAcceptedRecordedByUserId: user.id,
          updatedAt: now,
        })
        .where(eq(quotes.id, quoteId));

      await tx.insert(auditLog).values({
        userId: user.id,
        entityType: "quote",
        entityId: quoteId,
        action: "customer_acceptance_recorded",
        diffJson: {
          customer_accepted_tier_id: tierId,
          recorded_by_user_id: user.id,
          email_ref: emailRef,
        },
      });
    });

    revalidateQuoteTree(quote.projectId, quoteId);
  });
}

// Companion to recordCustomerAcceptance — clear the customer signal
// without affecting the quote's primary status. Captures the prior
// tier_id in diff_json as `{from, to: null}` per CR-SM §6.1.
export async function clearCustomerAcceptance(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    if (!quoteId) {
      throw new ActionGuardError(ERR.VALIDATION, "quoteId is required.");
    }

    const quote = await loadQuoteOrThrow(quoteId);
    if (quote.status !== "sent" || !quote.customerAcceptedAt) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "No customer acceptance to clear on this quote.",
      );
    }

    const priorTierId = quote.customerAcceptedTierId;

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({
          customerAcceptedAt: null,
          customerAcceptedTierId: null,
          customerAcceptedRecordedByUserId: null,
          updatedAt: now,
        })
        .where(eq(quotes.id, quoteId));

      await tx.insert(auditLog).values({
        userId: user.id,
        entityType: "quote",
        entityId: quoteId,
        action: "customer_acceptance_cleared",
        diffJson: { from: priorTierId, to: null },
      });
    });

    revalidateQuoteTree(quote.projectId, quoteId);
  });
}

// slice-fr12-copy-operations Step 3 — shared transactional clone
// helper consumed by both copyScenarioWithinProject (Step 3) and
// copyQuoteFromProject (Step 4). Encapsulates the ASY/LEAF +
// freight clone graph per the locked Cloneable bucket
// (docs/cc-fr12-copy-operations-kickoff.md §3).
//
// Cloneable:  assemblies, assembly_leaves (point at SAME library
//             leaves), quote_tiers (qty RESET), freight_leg_groups,
//             freight_legs (POLICY columns + customs JSONB)
// Inherited:  project_id (from `targetProjectId` arg — different
//             from source.projectId on cross-project; same on
//             within-project)
// Reset:      id, version_number=1, status='draft', sent_at,
//             accepted_at, pdf_url, hubspot_quote_id, notes,
//             valid_until, retail_benchmark, all quote_tiers.qty,
//             freight leg shipment dates, scenario_status='active',
//             copied_from_quote_id=source.id
// Dropped per Pattern 32: packaging_inputs, production_inputs,
//             quote_sku_tiers, quote_sku_tier_targets — all FK to
//             legacy quoteSkus.id chain; orphan for v1 quotes.
//
// All inserts run inside the caller's transaction `tx`. Returns
// the new quote id. Does NOT emit the scenario_copied audit row —
// caller does that with their source_type discriminator.
async function cloneQuoteGraph(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  args: {
    sourceQuoteId: string;
    targetProjectId: string;
    newScenarioLabel: string;
    intentNote: string | null;
    customerTargetTierLabel: string | null;
    createdByUserId: string;
  },
): Promise<{ newQuoteId: string }> {
  // Fetch the source quote (Cloneable + carry-forward columns).
  const [source] = await tx
    .select()
    .from(quotes)
    .where(eq(quotes.id, args.sourceQuoteId))
    .limit(1);
  if (!source) {
    throw new ActionGuardError(ERR.NOT_FOUND, "Source quote not found.");
  }

  // Insert the new quote — Cloneable fields from source +
  // Inherited fields from target project + Reset fields cleared +
  // copied_from_quote_id = source.id.
  const [newQuote] = await tx
    .insert(quotes)
    .values({
      // Inherited (from target project)
      projectId: args.targetProjectId,
      // Cloneable (from source)
      globalPriceAdjPct: source.globalPriceAdjPct,
      targetMarginPct: source.targetMarginPct,
      // PM-provided label (defaults to "Alt N" upstream of caller)
      scenarioLabel: args.newScenarioLabel,
      intentNote: args.intentNote,
      customerTargetTierLabel: args.customerTargetTierLabel,
      // Reset (explicit per FR-12 bucket)
      scenarioStatus: "active",
      versionNumber: 1,
      status: "draft",
      isRecommended: false,
      // Lineage
      copiedFromQuoteId: args.sourceQuoteId,
      createdByUserId: args.createdByUserId,
      // Rest of Reset fields rely on column defaults (NULL or false)
    })
    .returning({ id: quotes.id });
  const newQuoteId = newQuote.id;

  // Clone tiers — label + sort_order + tier_price_adj_pct +
  // recommended + qty carry.
  //
  // Post-Slice-11 revision (2026-07-15): qty now CLONES (was in
  // FR-12 Reset bucket per Beija Flor cross-project rationale).
  // Edward's within-project workflow surfaced the mismatch — copies
  // are typically "iterate on the same quote" (same customer, same
  // volumes; new pricing/cost structure), not "different customer
  // template reuse." Preserved qty means cost stack renders on the
  // fresh copy without PM re-entering the volume ask.
  //
  // PMs who legitimately want new qty (rare cross-project case)
  // still edit tier qty inline on the new draft. Trade-off favors
  // the common within-project case.
  const sourceTiers = await tx
    .select()
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, args.sourceQuoteId))
    .orderBy(asc(quoteTiers.sortOrder));
  const tierIdMap = new Map<string, string>(); // sourceTierId → newTierId
  if (sourceTiers.length > 0) {
    const insertedTiers = await tx
      .insert(quoteTiers)
      .values(
        sourceTiers.map((t) => ({
          quoteId: newQuoteId,
          label: t.label,
          qty: t.qty,
          sortOrder: t.sortOrder,
          tierPriceAdjPct: t.tierPriceAdjPct,
          recommended: t.recommended,
        })),
      )
      .returning({ id: quoteTiers.id, sortOrder: quoteTiers.sortOrder });
    // Pair by sort_order (stable within a quote post-insert).
    for (const src of sourceTiers) {
      const match = insertedTiers.find((i) => i.sortOrder === src.sortOrder);
      if (match) tierIdMap.set(src.id, match.id);
    }
  }

  // Clone assemblies (commercial fields per locked Cloneable graph).
  const sourceAssemblies = await tx
    .select()
    .from(assemblies)
    .where(eq(assemblies.quoteId, args.sourceQuoteId))
    .orderBy(asc(assemblies.position));
  const assemblyIdMap = new Map<string, string>(); // sourceAssemblyId → newAssemblyId
  if (sourceAssemblies.length > 0) {
    const insertedAssemblies = await tx
      .insert(assemblies)
      .values(
        sourceAssemblies.map((a) => ({
          quoteId: newQuoteId,
          sku: a.sku,
          name: a.name,
          packLabel: a.packLabel,
          productTypeId: a.productTypeId,
          description: a.description,
          url: a.url,
          imageUrl: a.imageUrl,
          unitPrice: a.unitPrice,
          unitCost: a.unitCost,
          marginPct: a.marginPct,
          markupPct: a.markupPct,
          taxScheduleId: a.taxScheduleId,
          ownerId: a.ownerId,
          fscClaim: a.fscClaim,
          fscStatus: a.fscStatus,
          supplierVerified: a.supplierVerified,
          internalNotes: a.internalNotes,
          position: a.position,
        })),
      )
      .returning({ id: assemblies.id, position: assemblies.position });
    for (const src of sourceAssemblies) {
      const match = insertedAssemblies.find((i) => i.position === src.position);
      if (match) assemblyIdMap.set(src.id, match.id);
    }

    // Clone assembly_leaves (junctions) — new IDs, SAME library
    // leaf_id references. Single-level v1 invariant: parent_assembly_leaf_id
    // is always NULL.
    //
    // Copy-scenario extension (2026-07-15): capture returning IDs +
    // build assemblyLeafIdMap so downstream cost-input clones
    // (assembly_leaf_inputs, assembly_leaf_overrides,
    // assembly_leaf_targets) can resolve source → new leaf refs.
    const assemblyLeafIdMap = new Map<string, string>();
    const sourceAssemblyIds = sourceAssemblies.map((a) => a.id);
    const sourceJunctions = await tx
      .select()
      .from(assemblyLeaves)
      .where(inArray(assemblyLeaves.assemblyId, sourceAssemblyIds))
      .orderBy(asc(assemblyLeaves.position));
    if (sourceJunctions.length > 0) {
      const insertedJunctions = await tx
        .insert(assemblyLeaves)
        .values(
          sourceJunctions.map((j) => {
            const newAsyId = assemblyIdMap.get(j.assemblyId);
            if (!newAsyId) {
              throw new Error(
                `clone: assembly_leaves row referenced unmapped assembly ${j.assemblyId}`,
              );
            }
            return {
              assemblyId: newAsyId,
              leafId: j.leafId, // SAME library leaf reference per Cloneable bucket
              quantity: j.quantity,
              position: j.position,
              parentAssemblyLeafId: null, // single-level v1 invariant
            };
          }),
        )
        .returning({
          id: assemblyLeaves.id,
          assemblyId: assemblyLeaves.assemblyId,
          position: assemblyLeaves.position,
        });
      // Pair source → new by (new_assembly_id, position). Both are
      // unique within a source assembly + position is preserved 1:1.
      for (const src of sourceJunctions) {
        const newAsyId = assemblyIdMap.get(src.assemblyId);
        const match = insertedJunctions.find(
          (i) => i.assemblyId === newAsyId && i.position === src.position,
        );
        if (match) assemblyLeafIdMap.set(src.id, match.id);
      }
    }

    // Copy-scenario extension (2026-07-15) — Clone cost data
    // that FR-12 spec missed. Slice 11.5 migrated cost data from
    // legacy quote_skus-based tables (packaging_inputs /
    // production_inputs / quote_sku_tiers) to NEW-model
    // assembly_leaf_inputs / assembly_production_inputs /
    // assembly_leaf_overrides / assembly_leaf_targets. The FR-12
    // Cloneable bucket was authored against the OLD model and never
    // updated post-11.5 migration. Result: clones had structure
    // (assemblies + leaves + tiers) but zero cost data → useless
    // draft (PM had to re-enter every cost input).
    //
    // These are copied under the Cloneable bucket (same posture as
    // assemblies.unit_price / .unit_cost — commercial data survives
    // the clone). PMs can still edit any cell on the new draft.

    // 1. assembly_leaf_inputs — packaging cost rows (per-leaf per-tier)
    if (sourceJunctions.length > 0) {
      const sourceLeafInputs = await tx
        .select()
        .from(assemblyLeafInputs)
        .where(
          inArray(
            assemblyLeafInputs.assemblyLeafId,
            sourceJunctions.map((j) => j.id),
          ),
        );
      if (sourceLeafInputs.length > 0) {
        // line_group_id is a synthetic UUID grouping rows across
        // tiers for the same "packaging line." Generate new ids to
        // avoid confusing forensic queries between source and new
        // (both refs to same line_group_id would read as "same line"
        // when they're not).
        const lineGroupIdMap = new Map<string, string>();
        for (const r of sourceLeafInputs) {
          if (!lineGroupIdMap.has(r.lineGroupId)) {
            lineGroupIdMap.set(r.lineGroupId, randomUUID());
          }
        }
        await tx.insert(assemblyLeafInputs).values(
          sourceLeafInputs.map((r) => {
            const newLeafId = assemblyLeafIdMap.get(r.assemblyLeafId);
            const newTierId = tierIdMap.get(r.tierId);
            const newLineGroupId = lineGroupIdMap.get(r.lineGroupId);
            if (!newLeafId || !newTierId || !newLineGroupId) {
              throw new Error(
                `clone: assembly_leaf_inputs unmapped ref (leaf=${r.assemblyLeafId}, tier=${r.tierId}, lineGroup=${r.lineGroupId})`,
              );
            }
            return {
              assemblyLeafId: newLeafId,
              tierId: newTierId,
              lineGroupId: newLineGroupId,
              sortOrder: r.sortOrder,
              supplier: r.supplier,
              qtyPerSellableUnit: r.qtyPerSellableUnit,
              category: r.category,
              markupPct: r.markupPct,
              markupPctSource: r.markupPctSource,
              inventoryEligible: r.inventoryEligible,
              notes: r.notes,
              unitCost: r.unitCost,
              purchaseQty: r.purchaseQty,
            };
          }),
        );
      }

      // 2. assembly_leaf_overrides — per-cell sell-price overrides
      const sourceOverrides = await tx
        .select()
        .from(assemblyLeafOverrides)
        .where(
          inArray(
            assemblyLeafOverrides.assemblyLeafId,
            sourceJunctions.map((j) => j.id),
          ),
        );
      if (sourceOverrides.length > 0) {
        await tx.insert(assemblyLeafOverrides).values(
          sourceOverrides.map((r) => {
            const newLeafId = assemblyLeafIdMap.get(r.assemblyLeafId);
            const newTierId = tierIdMap.get(r.tierId);
            if (!newLeafId || !newTierId) {
              throw new Error(
                `clone: assembly_leaf_overrides unmapped ref (leaf=${r.assemblyLeafId}, tier=${r.tierId})`,
              );
            }
            return {
              assemblyLeafId: newLeafId,
              tierId: newTierId,
              sellPriceOverride: r.sellPriceOverride,
            };
          }),
        );
      }

      // 3. assembly_leaf_targets — per-cell client benchmarks
      const sourceTargets = await tx
        .select()
        .from(assemblyLeafTargets)
        .where(
          inArray(
            assemblyLeafTargets.assemblyLeafId,
            sourceJunctions.map((j) => j.id),
          ),
        );
      if (sourceTargets.length > 0) {
        await tx.insert(assemblyLeafTargets).values(
          sourceTargets.map((r) => {
            const newLeafId = assemblyLeafIdMap.get(r.assemblyLeafId);
            const newTierId = tierIdMap.get(r.tierId);
            if (!newLeafId || !newTierId) {
              throw new Error(
                `clone: assembly_leaf_targets unmapped ref (leaf=${r.assemblyLeafId}, tier=${r.tierId})`,
              );
            }
            return {
              assemblyLeafId: newLeafId,
              tierId: newTierId,
              clientTargetPricePerUnit: r.clientTargetPricePerUnit,
            };
          }),
        );
      }
    }

    // 4. assembly_production_inputs — production cost rows (per-assembly per-tier)
    const sourceProductionInputs = await tx
      .select()
      .from(assemblyProductionInputs)
      .where(inArray(assemblyProductionInputs.assemblyId, sourceAssemblyIds));
    if (sourceProductionInputs.length > 0) {
      await tx.insert(assemblyProductionInputs).values(
        sourceProductionInputs.map((r) => {
          const newAsyId = assemblyIdMap.get(r.assemblyId);
          const newTierId = tierIdMap.get(r.tierId);
          if (!newAsyId || !newTierId) {
            throw new Error(
              `clone: assembly_production_inputs unmapped ref (asy=${r.assemblyId}, tier=${r.tierId})`,
            );
          }
          return {
            assemblyId: newAsyId,
            tierId: newTierId,
            customerShipsRaws: r.customerShipsRaws,
            allocateServiceFeesToCost: r.allocateServiceFeesToCost,
            notes: r.notes,
            fillingBlendingCost: r.fillingBlendingCost,
            cmAssemblyTotal: r.cmAssemblyTotal,
            setupFeeTotal: r.setupFeeTotal,
            toolingArtworkTotal: r.toolingArtworkTotal,
            rdTotal: r.rdTotal,
            otherServiceTotal: r.otherServiceTotal,
            bulkRawCost: r.bulkRawCost,
            actualUnitsProduced: r.actualUnitsProduced,
          };
        }),
      );
    }
  }

  // Clone freight_leg_groups + freight_legs (R6.2 leg-based model).
  // Quote-keyed (FK to quotes.id directly per schema.ts:862).
  const sourceLegGroups = await tx
    .select()
    .from(freightLegGroups)
    .where(eq(freightLegGroups.quoteId, args.sourceQuoteId))
    .orderBy(asc(freightLegGroups.displayOrder));
  const legGroupIdMap = new Map<string, string>();
  if (sourceLegGroups.length > 0) {
    const insertedLegGroups = await tx
      .insert(freightLegGroups)
      .values(
        sourceLegGroups.map((g) => ({
          quoteId: newQuoteId,
          label: g.label,
          displayOrder: g.displayOrder,
        })),
      )
      .returning({
        id: freightLegGroups.id,
        displayOrder: freightLegGroups.displayOrder,
      });
    for (const src of sourceLegGroups) {
      const match = insertedLegGroups.find(
        (i) => i.displayOrder === src.displayOrder,
      );
      if (match) legGroupIdMap.set(src.id, match.id);
    }

    // Clone freight_legs — POLICY columns + customs JSONB cloneable;
    // shipment dates (cargo_ready_date, vessel_etd, vessel_eta,
    // actual_delivery_date) RESET to null per FR-12 Reset bucket.
    //
    // Copy-scenario extension (2026-07-15): capture returning IDs +
    // build freightLegIdMap so downstream freight_leg_tiers +
    // freight_customer_arranges_meta clones can resolve refs.
    const freightLegIdMap = new Map<string, string>();
    const sourceLegGroupIds = sourceLegGroups.map((g) => g.id);
    const sourceLegs = await tx
      .select()
      .from(freightLegs)
      .where(inArray(freightLegs.legGroupId, sourceLegGroupIds))
      .orderBy(asc(freightLegs.displayOrder));
    if (sourceLegs.length > 0) {
      const insertedLegs = await tx
        .insert(freightLegs)
        .values(
          sourceLegs.map((l) => {
            const newGroupId = legGroupIdMap.get(l.legGroupId);
            if (!newGroupId) {
              throw new Error(
                `clone: freight_legs row referenced unmapped leg_group ${l.legGroupId}`,
              );
            }
            return {
              legGroupId: newGroupId,
              // Cloneable POLICY columns
              direction: l.direction,
              label: l.label,
              origin: l.origin,
              destination: l.destination,
              crossesInternationalBorder: l.crossesInternationalBorder,
              treatment: l.treatment,
              mode: l.mode,
              carrier: l.carrier,
              incoterm: l.incoterm,
              freightMarkupPct: l.freightMarkupPct,
              dutyMarkupPct: l.dutyMarkupPct,
              tariffMarkupPct: l.tariffMarkupPct,
              customs: l.customs,
              displayOrder: l.displayOrder,
              // Reset bucket — shipment dates explicitly NULL
              cargoReadyDate: null,
              vesselEtd: null,
              vesselEta: null,
              actualDeliveryDate: null,
            };
          }),
        )
        .returning({
          id: freightLegs.id,
          legGroupId: freightLegs.legGroupId,
          displayOrder: freightLegs.displayOrder,
        });
      // Pair source → new by (new_leg_group_id, display_order).
      for (const src of sourceLegs) {
        const newGroupId = legGroupIdMap.get(src.legGroupId);
        const match = insertedLegs.find(
          (i) =>
            i.legGroupId === newGroupId && i.displayOrder === src.displayOrder,
        );
        if (match) freightLegIdMap.set(src.id, match.id);
      }

      // 5. freight_leg_tiers — per-tier freight amounts (total +
      //    units_in_shipment). Copy-scenario extension.
      const sourceLegIds = sourceLegs.map((l) => l.id);
      const sourceLegTiers = await tx
        .select()
        .from(freightLegTiers)
        .where(inArray(freightLegTiers.freightLegId, sourceLegIds));
      if (sourceLegTiers.length > 0) {
        await tx.insert(freightLegTiers).values(
          sourceLegTiers.map((r) => {
            const newLegId = freightLegIdMap.get(r.freightLegId);
            const newTierId = tierIdMap.get(r.tierId);
            if (!newLegId || !newTierId) {
              throw new Error(
                `clone: freight_leg_tiers unmapped ref (leg=${r.freightLegId}, tier=${r.tierId})`,
              );
            }
            return {
              freightLegId: newLegId,
              tierId: newTierId,
              totalFreight: r.totalFreight,
              unitsInShipment: r.unitsInShipment,
            };
          }),
        );
      }

      // 6. freight_customer_arranges_meta — per-leg customer-arranges
      //    metadata (customer_contact + audit_note). Copy-scenario
      //    extension.
      const sourceMeta = await tx
        .select()
        .from(freightCustomerArrangesMeta)
        .where(
          inArray(freightCustomerArrangesMeta.freightLegId, sourceLegIds),
        );
      if (sourceMeta.length > 0) {
        await tx.insert(freightCustomerArrangesMeta).values(
          sourceMeta.map((r) => {
            const newLegId = freightLegIdMap.get(r.freightLegId);
            if (!newLegId) {
              throw new Error(
                `clone: freight_customer_arranges_meta unmapped ref (leg=${r.freightLegId})`,
              );
            }
            return {
              freightLegId: newLegId,
              customerContact: r.customerContact,
              auditNote: r.auditNote,
            };
          }),
        );
      }
    }
  }

  return { newQuoteId };
}

// slice-fr12-copy-operations Step 3 — within-project copy. Branch
// off a scenario in the same project. Per Q10: emits one
// scenario_copied audit row with source_type='within_project'.
// Optional dropCurrentScenarioId triggers a family-level
// scenario_dropped write with audit_source='fr12_copy_supersede'.
export async function copyScenarioWithinProject(input: {
  sourceQuoteId: string;
  projectId: string;
  newScenarioLabel?: string;
  intentNote?: string;
  customerTargetTierLabel?: string;
  dropCurrentScenarioId?: string;
}): Promise<ActionResult<{ newQuoteId: string }>> {
  return runAction(async () => {
    const { sourceQuoteId, projectId } = input;
    if (!sourceQuoteId)
      throw new ActionGuardError(ERR.VALIDATION, "sourceQuoteId required");
    if (!projectId)
      throw new ActionGuardError(ERR.VALIDATION, "projectId required");

    const user = await ensureUser();

    // Verify source quote belongs to this project (within-project
    // invariant; cross-project copies use the dedicated action).
    const [sourceMeta] = await db
      .select({ projectId: quotes.projectId })
      .from(quotes)
      .where(eq(quotes.id, sourceQuoteId))
      .limit(1);
    if (!sourceMeta) {
      throw new ActionGuardError(ERR.NOT_FOUND, "Source quote not found.");
    }
    if (sourceMeta.projectId !== projectId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Source quote belongs to a different project. Use copyQuoteFromProject for cross-project copies.",
      );
    }

    // Resolve scenario label: PM-provided OR auto "Alt N" per Q11.
    let scenarioLabel = (input.newScenarioLabel ?? "").trim();
    if (scenarioLabel.length === 0) {
      const existing = await db
        .selectDistinct({ scenarioLabel: quotes.scenarioLabel })
        .from(quotes)
        .where(eq(quotes.projectId, projectId));
      const taken = new Set(existing.map((r) => r.scenarioLabel));
      let n = 1;
      while (taken.has(`Alt ${n}`)) n++;
      scenarioLabel = `Alt ${n}`;
    }

    const intentNote = (input.intentNote ?? "").trim() || null;
    const customerTargetTierLabel =
      (input.customerTargetTierLabel ?? "").trim() || null;

    let newQuoteId: string;
    let droppedSourceQuoteIds: string[] = [];
    let droppedScenarioLabel: string | null = null;

    await db.transaction(async (tx) => {
      const cloned = await cloneQuoteGraph(tx, {
        sourceQuoteId,
        targetProjectId: projectId,
        newScenarioLabel: scenarioLabel,
        intentNote,
        customerTargetTierLabel,
        createdByUserId: user.id,
      });
      newQuoteId = cloned.newQuoteId;

      // Optional family-level drop of the "current" scenario per
      // CSF Bug CSF-3-A precedent (family-level write, not per-quote).
      if (input.dropCurrentScenarioId) {
        const [currentRow] = await tx
          .select({ scenarioLabel: quotes.scenarioLabel })
          .from(quotes)
          .where(eq(quotes.id, input.dropCurrentScenarioId))
          .limit(1);
        if (currentRow) {
          droppedScenarioLabel = currentRow.scenarioLabel;
          const dropped = await tx
            .update(quotes)
            .set({
              scenarioStatus: "dropped",
              dropReason: "superseded_by_copy",
              droppedByUserId: user.id,
              droppedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(quotes.projectId, projectId),
                eq(quotes.scenarioLabel, currentRow.scenarioLabel),
                eq(quotes.scenarioStatus, "active"),
              ),
            )
            .returning({ id: quotes.id });
          droppedSourceQuoteIds = dropped.map((d) => d.id);
          if (droppedSourceQuoteIds.length > 0) {
            await tx.insert(auditLog).values({
              userId: user.id,
              entityType: "project",
              entityId: projectId,
              action: "scenario_dropped",
              diffJson: {
                drop_reason: "superseded_by_copy",
                triggered_by_new_scenario_id: newQuoteId,
                scenario_label: currentRow.scenarioLabel,
                dropped_quote_ids: droppedSourceQuoteIds,
                audit_source: "fr12_copy_supersede",
              },
            });
          }
        }
      }

      // scenario_copied audit row per Q10. source_type discriminator
      // disambiguates within-project from cross-project; source +
      // target project ids identical here.
      await tx.insert(auditLog).values({
        userId: user.id,
        entityType: "quote",
        entityId: newQuoteId,
        action: "scenario_copied",
        diffJson: {
          source_quote_id: sourceQuoteId,
          source_type: "within_project",
          target_project_id: projectId,
          scenario_label: scenarioLabel,
          intent_note: intentNote,
          customer_target_tier_label: customerTargetTierLabel,
          dropped_source_quote_id: droppedSourceQuoteIds[0] ?? null,
          dropped_scenario_label: droppedScenarioLabel,
        },
      });
    });

    revalidatePath(`/projects/${projectId}`);
    return { newQuoteId: newQuoteId! };
  });
}

// slice-fr12-copy-operations Step 4 — cross-project copy. Beija
// Flor reorder template clone per SPEC v1 success criterion. Per
// Q10: emits one scenario_copied audit row with
// source_type='cross_project'. No drop-current option (cross-
// project copies don't auto-drop source scenarios in the target
// project — the target may be a fresh project with no scenarios
// to drop).
//
// Behavior shape mirrors copyScenarioWithinProject:
//   1. Validate input + auth (no permission gate per Catch #6)
//   2. Verify source quote exists + belongs to a DIFFERENT project
//      than targetProjectId (cross-project invariant)
//   3. Resolve scenario label: PM-provided OR auto "Alt N" within
//      target project (collision avoidance scoped to target)
//   4. Transaction: cloneQuoteGraph(tx, ...) + scenario_copied
//      audit row with source_type='cross_project', source_project_id
//      populated for forensic continuity
export async function copyQuoteFromProject(input: {
  sourceQuoteId: string;
  targetProjectId: string;
  newScenarioLabel?: string;
  intentNote?: string;
  customerTargetTierLabel?: string;
}): Promise<ActionResult<{ newQuoteId: string }>> {
  return runAction(async () => {
    const { sourceQuoteId, targetProjectId } = input;
    if (!sourceQuoteId)
      throw new ActionGuardError(ERR.VALIDATION, "sourceQuoteId required");
    if (!targetProjectId)
      throw new ActionGuardError(ERR.VALIDATION, "targetProjectId required");

    const user = await ensureUser();

    // Verify source quote exists + verify cross-project invariant
    // (source.projectId !== targetProjectId).
    const [sourceMeta] = await db
      .select({ projectId: quotes.projectId })
      .from(quotes)
      .where(eq(quotes.id, sourceQuoteId))
      .limit(1);
    if (!sourceMeta) {
      throw new ActionGuardError(ERR.NOT_FOUND, "Source quote not found.");
    }
    if (sourceMeta.projectId === targetProjectId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Source quote belongs to the target project. Use copyScenarioWithinProject for within-project copies.",
      );
    }
    const sourceProjectId = sourceMeta.projectId;

    // Verify target project exists (FK would catch this on insert
    // but a friendly NOT_FOUND surfaces a cleaner error UI-side).
    const [targetProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, targetProjectId))
      .limit(1);
    if (!targetProject) {
      throw new ActionGuardError(ERR.NOT_FOUND, "Target project not found.");
    }

    // Resolve scenario label: PM-provided OR auto "Alt N" within
    // target project. Collision-avoidance scoped to the target
    // (source's existing labels don't conflict with the target's).
    let scenarioLabel = (input.newScenarioLabel ?? "").trim();
    if (scenarioLabel.length === 0) {
      const existing = await db
        .selectDistinct({ scenarioLabel: quotes.scenarioLabel })
        .from(quotes)
        .where(eq(quotes.projectId, targetProjectId));
      const taken = new Set(existing.map((r) => r.scenarioLabel));
      let n = 1;
      while (taken.has(`Alt ${n}`)) n++;
      scenarioLabel = `Alt ${n}`;
    }

    const intentNote = (input.intentNote ?? "").trim() || null;
    const customerTargetTierLabel =
      (input.customerTargetTierLabel ?? "").trim() || null;

    let newQuoteId: string;

    await db.transaction(async (tx) => {
      const cloned = await cloneQuoteGraph(tx, {
        sourceQuoteId,
        targetProjectId,
        newScenarioLabel: scenarioLabel,
        intentNote,
        customerTargetTierLabel,
        createdByUserId: user.id,
      });
      newQuoteId = cloned.newQuoteId;

      // scenario_copied audit row per Q10. source_project_id
      // populated (not inferable from source_quote at audit-read
      // time without a join; persist for forensic continuity).
      await tx.insert(auditLog).values({
        userId: user.id,
        entityType: "quote",
        entityId: newQuoteId,
        action: "scenario_copied",
        diffJson: {
          source_quote_id: sourceQuoteId,
          source_type: "cross_project",
          source_project_id: sourceProjectId,
          target_project_id: targetProjectId,
          scenario_label: scenarioLabel,
          intent_note: intentNote,
          customer_target_tier_label: customerTargetTierLabel,
        },
      });
    });

    revalidatePath(`/projects/${targetProjectId}`);
    return { newQuoteId: newQuoteId! };
  });
}

// slice-fr12-copy-operations Step 5 — server action wrappers for
// the picker loaders. Mirror the fetchLibraryBrowse pattern from
// PR #51 (auth-checked wrapper around a server-only loader so the
// client can call via useTransition without server-only imports
// leaking into the modal component).

export async function fetchScenarioCopyPicker(
  filters: ScenarioCopyPickerFilters,
): Promise<ActionResult<{ scenarios: ScenarioCopyPickerRow[] }>> {
  return runAction(async () => {
    await ensureUser();
    return loadScenarioCopyPicker(filters);
  });
}

export async function fetchCopySourceProjects(
  filters: CopySourceProjectsFilters,
): Promise<ActionResult<{ projects: CopySourceProject[] }>> {
  return runAction(async () => {
    await ensureUser();
    return loadCopySourceProjects(filters);
  });
}

// ──────────────────────────────────────────────────────────────────
// dropScenario — standalone family drop (scenario actions menu)
// ──────────────────────────────────────────────────────────────────
//
// Marks all rows in the (project_id, scenario_label) family with
// scenarioStatus='dropped'. Mirrors the existing drop-family logic
// in createScenario/copyScenarioWithinProject but as a standalone
// action wired from the per-scenario kebab menu on project detail.
//
// **Draft-only per PM disposition (2026-07-15).** Sent + accepted
// quotes are considered committed history and can't be dropped
// from the menu. If any row in the family is not draft, the action
// rejects with VALIDATION error. Guard runs inside the tx so
// concurrent state changes are seen consistently.
//
// Emits scenario_dropped audit with audit_source='scenario_actions_menu'
// per Slice 9.2 source-namespace convention.
export async function dropScenario(input: {
  projectId: string;
  scenarioLabel: string;
}): Promise<ActionResult<{ droppedQuoteIds: string[] }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const { projectId, scenarioLabel } = input;
    if (!projectId || !scenarioLabel) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "projectId and scenarioLabel are required.",
      );
    }

    return await db.transaction(async (tx) => {
      // Load all active rows in the family. Guard: any non-draft
      // row makes the whole drop refuse (sent/accepted are locked
      // per Edward's disposition; PM can only drop draft-only
      // families via the menu).
      const familyRows = await tx
        .select({
          id: quotes.id,
          status: quotes.status,
        })
        .from(quotes)
        .where(
          and(
            eq(quotes.projectId, projectId),
            eq(quotes.scenarioLabel, scenarioLabel),
            eq(quotes.scenarioStatus, "active"),
          ),
        );

      if (familyRows.length === 0) {
        throw new ActionGuardError(
          ERR.NOT_FOUND,
          "Scenario not found or already dropped.",
        );
      }

      const nonDraft = familyRows.filter((r) => r.status !== "draft");
      if (nonDraft.length > 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `Scenario has ${nonDraft.length} non-draft version${nonDraft.length === 1 ? "" : "s"} (${nonDraft.map((r) => r.status).join(", ")}). Sent + accepted quotes can't be dropped from the menu — that requires admin override.`,
        );
      }

      const now = new Date();
      const dropped = await tx
        .update(quotes)
        .set({
          scenarioStatus: "dropped",
          dropReason: "manual",
          droppedByUserId: user.id,
          droppedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(quotes.projectId, projectId),
            eq(quotes.scenarioLabel, scenarioLabel),
            eq(quotes.scenarioStatus, "active"),
          ),
        )
        .returning({ id: quotes.id });

      await tx.insert(auditLog).values({
        userId: user.id,
        entityType: "project",
        entityId: projectId,
        action: "scenario_dropped",
        diffJson: {
          drop_reason: "manual",
          scenario_label: scenarioLabel,
          dropped_quote_ids: dropped.map((d) => d.id),
          audit_source: "scenario_actions_menu",
        },
      });

      revalidatePath(`/projects/${projectId}`);

      return { droppedQuoteIds: dropped.map((d) => d.id) };
    });
  });
}

// ──────────────────────────────────────────────────────────────────
// renameScenarioLabel — in-place scenario title edit
// ──────────────────────────────────────────────────────────────────
//
// Updates all rows in the family (project_id, oldScenarioLabel) to
// the new label. Scenario label is a family identifier — all
// versions share it, so we rewrite the family together.
//
// Validation:
//   - New label non-empty (trimmed)
//   - New label != old label (no-op rejected to keep audit clean)
//   - No collision with another scenario_label in the same project
//     (partial uniqueness — check all statuses, since a dropped
//     scenario's label reuse would confuse forensic queries)
//   - Family exists (at least one row matches old label)
//
// Emits scenario_renamed audit at project scope; diff_json carries
// {from, to, affected_quote_ids}.
export async function renameScenarioLabel(input: {
  projectId: string;
  oldScenarioLabel: string;
  newScenarioLabel: string;
}): Promise<ActionResult<{ renamedQuoteIds: string[] }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const { projectId } = input;
    const oldLabel = input.oldScenarioLabel.trim();
    const newLabel = input.newScenarioLabel.trim();

    if (!projectId || !oldLabel) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "projectId and oldScenarioLabel are required.",
      );
    }
    if (!newLabel) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "New scenario label cannot be empty.",
      );
    }
    if (newLabel === oldLabel) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "New label is the same as the current label.",
      );
    }
    if (newLabel.length > 200) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Scenario label exceeds 200 characters.",
      );
    }

    return await db.transaction(async (tx) => {
      // Guard: no collision with any other scenario_label in this
      // project (any status — dropped scenarios' labels stay
      // reserved for forensic clarity).
      const collision = await tx
        .select({ id: quotes.id })
        .from(quotes)
        .where(
          and(
            eq(quotes.projectId, projectId),
            eq(quotes.scenarioLabel, newLabel),
          ),
        )
        .limit(1);
      if (collision.length > 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `Another scenario in this project already uses the label "${newLabel}". Pick a different label.`,
        );
      }

      const now = new Date();
      const renamed = await tx
        .update(quotes)
        .set({
          scenarioLabel: newLabel,
          updatedAt: now,
        })
        .where(
          and(
            eq(quotes.projectId, projectId),
            eq(quotes.scenarioLabel, oldLabel),
          ),
        )
        .returning({ id: quotes.id });

      if (renamed.length === 0) {
        throw new ActionGuardError(
          ERR.NOT_FOUND,
          `No scenario found with label "${oldLabel}" in this project.`,
        );
      }

      await tx.insert(auditLog).values({
        userId: user.id,
        entityType: "project",
        entityId: projectId,
        action: "scenario_renamed",
        diffJson: {
          from: oldLabel,
          to: newLabel,
          affected_quote_ids: renamed.map((r) => r.id),
          audit_source: "scenario_actions_menu",
        },
      });

      revalidatePath(`/projects/${projectId}`);

      return { renamedQuoteIds: renamed.map((r) => r.id) };
    });
  });
}
