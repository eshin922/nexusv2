"use server";

import { asc, count, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  assemblyLeafInputs,
  assemblyProductionInputs,
  auditLog,
  markupDefaults,
} from "@/db/schema";
import { writeAuditEntry, writeAuditEntryReturningId } from "@/lib/audit";
import { requireAdminAction } from "@/lib/admin-guard";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { validatePercentDecimal } from "@/lib/percent-validation";
import { PRODUCTION_MARKUP_CATEGORY } from "@/lib/costing";

/** A production row the Production rate actually marks up — one with money on
 *  it. An all-null row is structure, not an economic the rate touches. */
const PRODUCTION_VALUE_PRESENT = sql`
  COALESCE(${assemblyProductionInputs.fillingBlendingCost}, 0)
+ COALESCE(${assemblyProductionInputs.cmAssemblyTotal}, 0)
+ COALESCE(${assemblyProductionInputs.setupFeeTotal}, 0)
+ COALESCE(${assemblyProductionInputs.toolingArtworkTotal}, 0)
+ COALESCE(${assemblyProductionInputs.rdTotal}, 0)
+ COALESCE(${assemblyProductionInputs.otherServiceTotal}, 0)
+ COALESCE(${assemblyProductionInputs.bulkRawCost}, 0)
+ COALESCE(${assemblyProductionInputs.testingMicrosTotal}, 0) <> 0`;

// Markup-defaults admin actions. listMarkupDefaults moved here from
// packaging.ts for hygiene (markup-defaults is the owning concern;
// packaging just consumes the lookup).

export type MarkupDefaultRow = {
  category: string;
  defaultMarkupPct: string;
  updatedByUserId: string | null;
  updatedAt: Date;
};

// Read-only; no admin gate (consumed by packaging line UI for category
// dropdown). Public to any authenticated user.
export async function listMarkupDefaults(): Promise<MarkupDefaultRow[]> {
  return db
    .select()
    .from(markupDefaults)
    .orderBy(asc(markupDefaults.category));
}

// Parse percent display ("30" → "0.3000") for DB write. Returns null on
// empty/invalid; caller treats null as user error.
function pctDisplayToDecimalString(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return (n / 100).toString();
}

function validateMarkupPct(decimal: number): void {
  const r = validatePercentDecimal(decimal, "markup");
  if (!r.valid) throw new ActionGuardError(ERR.VALIDATION, r.message);
}

// Insert or update a category's markup default. Used both by "Add new
// category" (insert) and "Edit existing" (update); upsert path keeps
// the action simple and idempotent.
export async function upsertMarkupDefault(
  formData: FormData,
): Promise<ActionResult<MarkupDefaultRow>> {
  return runAction(async () => {
    const admin = await requireAdminAction();

    const category = String(formData.get("category") ?? "").trim();
    const pctDecimal = pctDisplayToDecimalString(
      formData.get("defaultMarkupPct"),
    );

    if (category === "") {
      throw new ActionGuardError(ERR.VALIDATION, "Category name is required.");
    }
    if (pctDecimal === null) {
      throw new ActionGuardError(ERR.VALIDATION, "Markup % is required.");
    }
    validateMarkupPct(Number(pctDecimal));

    // Wrap upsert + audit in a transaction so we never persist a
    // mutation without its audit row (matches firm-settings pattern).
    const row = await db.transaction(async (tx) => {
      const [prior] = await tx
        .select()
        .from(markupDefaults)
        .where(eq(markupDefaults.category, category))
        .limit(1);

      const [created] = await tx
        .insert(markupDefaults)
        .values({
          category,
          defaultMarkupPct: pctDecimal,
          updatedByUserId: admin.id,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: markupDefaults.category,
          set: {
            defaultMarkupPct: pctDecimal,
            updatedByUserId: admin.id,
            updatedAt: new Date(),
          },
        })
        .returning();

      await writeAuditEntry({
        userId: admin.id,
        entityType: "markup_defaults",
        entityId: category,
        action: prior ? "update" : "create",
        diffJson: prior
          ? {
              from: { defaultMarkupPct: prior.defaultMarkupPct },
              to: { defaultMarkupPct: pctDecimal },
            }
          : {
              // Self-contained audit row: include category in the
              // diff payload (entityId already carries it, but a
              // future reader scanning audit_log shouldn't have to
              // join entity_id back to make sense of the shape).
              to: { category, defaultMarkupPct: pctDecimal },
            },
      }, tx);

      return created;
    });

    revalidatePath("/admin/markup-defaults");
    return row;
  });
}

// Reference count for a category — used by the admin UI to render
// "(N referenced)" inline and to surface in the delete confirmation
// modal. Soft reference: assembly_leaf_inputs.category is text with
// no FK, so the join is logical, not enforced.
//
// Slice 11.5.1 — migrated from packaging_inputs → assembly_leaf_inputs
// (NEW model). Same column name + semantics.
//
// Admin-gated: this is admin UI bookkeeping. PMs don't need it
// (their packaging dropdown only sees categories + defaults via
// listMarkupDefaults, which is intentionally public to authenticated
// users). Defense in depth — every "use server" export is a
// POST-able endpoint.
export async function listMarkupDefaultReferenceCounts(): Promise<
  Map<string, number>
> {
  await requireAdminAction();
  const rows = await db
    .select({
      category: assemblyLeafInputs.category,
      n: count(),
    })
    .from(assemblyLeafInputs)
    .where(isNotNull(assemblyLeafInputs.category))
    .groupBy(assemblyLeafInputs.category);
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.category !== null) map.set(r.category, Number(r.n));
  }

  // BV-013 · Production is consumed at SECTION level, not per line.
  //
  // This count reads `assembly_leaf_inputs.category`, which is packaging's
  // per-line authority. `assembly_production_inputs` has no category column —
  // the engine marks the whole section at one rate — so Production could never
  // appear here and was badged UNUSED · never used while pricing every
  // production economic in the estate.
  //
  // That is not cosmetic. An admin reading "unused" may reasonably delete the
  // row, and since BV-013 made the ladder fail-visible, deleting it prices
  // every draft's production AT COST and makes those quotes unsendable. The
  // surface would have invited exactly the action it is least safe to take.
  const productionRows = await db
    .select({ n: count() })
    .from(assemblyProductionInputs)
    .where(PRODUCTION_VALUE_PRESENT);
  map.set(PRODUCTION_MARKUP_CATEGORY, Number(productionRows[0]?.n ?? 0));

  return map;
}

// Slice RI.8 step 2 — recompute preview engine for the Round 5
// markup-defaults inline-edit live disclosure (per brief §3.11).
// Edward's §1.2 disposition: APPROXIMATE ranges, not exact recompute
// simulation. Brief spec language ("Estimated blended-margin shift
// on those drafts: +0.6 to +1.4 pts") authorizes approximation.
//
// What we compute (real data):
//   - affectedLineItems: count of assembly_leaf_inputs rows in this
//     category (across ALL quote statuses; the actually-affected
//     subset is drafts only, but the line-count is meaningful as
//     "how many rows have this category").
//   - affectedDraftQuotes: count of distinct draft quotes that have
//     at least one assembly_leaf_inputs line in this category.
//
// What we estimate (approximate):
//   - shiftLowPct / shiftHighPct: bounded heuristic. Packaging
//     contributes typically 20-40% of CDM cost-stack; a delta of
//     N pp on markup ≈ N × (0.20 to 0.40) pp shift in blended margin.
//     Honest about being approximate; documented inline.
//
// Schema note: only `assembly_leaf_inputs` carries a `category`
// column (markup_defaults vocabulary spans concerns but is actually
// referenced from packaging-line rows only). Production / freight
// markup is per-row without category lookup. Preview reflects this
// — drafts + lines from packaging-side cost cells exclusively.
//
// Read-only; admin-gated (consumed by /admin/markup-defaults edit
// disclosure). Safe to call repeatedly as PM tunes the input.
export type RecomputePreview = {
  category: string;
  oldPct: string; // decimal e.g. "0.3000"
  newPct: string; // decimal e.g. "0.4200"
  deltaPctPp: number; // pp difference, signed (+12.0 means +12pp)
  affectedLineItems: number;
  affectedDraftQuotes: number;
  shiftLowPp: number; // estimated blended-margin shift, low bound, signed pp
  shiftHighPp: number; // estimated blended-margin shift, high bound, signed pp
};

export async function previewMarkupDefaultRecompute(
  category: string,
  newPctDecimal: string,
): Promise<ActionResult<RecomputePreview>> {
  return runAction(async () => {
    await requireAdminAction();

    if (!category) {
      throw new ActionGuardError(ERR.VALIDATION, "category is required.");
    }
    const newDec = Number(newPctDecimal);
    if (!Number.isFinite(newDec)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "new pct must be a finite decimal.",
      );
    }

    // Lookup current default for old → new framing.
    const [current] = await db
      .select()
      .from(markupDefaults)
      .where(eq(markupDefaults.category, category))
      .limit(1);
    const oldDec = current ? Number(current.defaultMarkupPct) : 0;
    const deltaPp = (newDec - oldDec) * 100; // signed pp

    // Count affected line items + distinct draft quotes via JOIN
    // through assembly_leaves → assemblies → quotes (status='draft'
    // filter). Slice 11.5.1 — migrated from packaging_inputs +
    // quote_skus join chain to NEW model (assembly_leaf_inputs +
    // assembly_leaves + assemblies).
    //
    // Note on counts: line-item count is across ALL statuses because
    // PMs benefit from knowing the total category usage. Draft count
    // is the specifically-affected subset (sent+ quotes are frozen
    // per the propagation rule — only drafts recompute).
    // BV-013 · Production counts production rows, not packaging lines.
    //
    // Before this the preview told an admin that changing Production would
    // "recompute markup on 0 line items across 0 draft quotes — no draft
    // quotes affected, this change is forward-only", and then repriced six
    // drafts. A confident, wrong statement about a commercial change, which
    // is the exact class of defect BV-013 exists to remove.
    const isProduction = category === PRODUCTION_MARKUP_CATEGORY;

    const lineCountRow = isProduction
      ? await db
          .select({ n: count() })
          .from(assemblyProductionInputs)
          .where(PRODUCTION_VALUE_PRESENT)
      : await db
          .select({ n: count() })
          .from(assemblyLeafInputs)
          .where(eq(assemblyLeafInputs.category, category));
    const affectedLineItems = Number(lineCountRow[0]?.n ?? 0);

    // Both owner branches for Production — an Item Group's section and a
    // Direct Service's — because the one rate prices both.
    const draftCountResult = (
      isProduction
        ? await db.execute(sql`
            SELECT COUNT(DISTINCT q.id) AS n
            FROM "assembly_production_inputs" api
            LEFT JOIN "assemblies" a ON a.id = api.assembly_id
            LEFT JOIN "quote_leaves" ql ON ql.id = api.quote_leaf_id
            JOIN "quotes" q ON q.id = COALESCE(a.quote_id, ql.quote_id)
            WHERE q.status = 'draft'
              AND (COALESCE(api.filling_blending_cost,0) + COALESCE(api.cm_assembly_total,0)
                 + COALESCE(api.setup_fee_total,0) + COALESCE(api.tooling_artwork_total,0)
                 + COALESCE(api.rd_total,0) + COALESCE(api.other_service_total,0)
                 + COALESCE(api.bulk_raw_cost,0) + COALESCE(api.testing_micros_total,0)) <> 0
          `)
        : await db.execute(sql`
            SELECT COUNT(DISTINCT q.id) AS n
            FROM "assembly_leaf_inputs" ali
            JOIN "assembly_leaves" al ON al.id = ali.assembly_leaf_id
            JOIN "assemblies" a ON a.id = al.assembly_id
            JOIN "quotes" q ON q.id = a.quote_id
            WHERE ali.category = ${category}
              AND q.status = 'draft'
          `)
    ) as unknown as Array<{ n: string | number }>;
    const affectedDraftQuotes = Number(draftCountResult[0]?.n ?? 0);

    // Approximate margin-shift range. Packaging typically contributes
    // 20-40% of CDM cost stack; delta of N pp markup ≈ N × (0.20 to
    // 0.40) pp blended-margin shift. The arithmetic is rough — real
    // shift depends on per-quote cost-stack composition + tier
    // weighting — but the bounded range is honest about being
    // approximate per Edward's §1.2 disposition. Refine to exact
    // recompute if future smoke reveals PMs need precision; until
    // then, brief spec language ("+0.6 to +1.4 pts") authorizes
    // approximation.
    const shiftLowPp = deltaPp * 0.2;
    const shiftHighPp = deltaPp * 0.4;

    return {
      category,
      oldPct: current?.defaultMarkupPct ?? "0",
      newPct: newPctDecimal,
      deltaPctPp: deltaPp,
      affectedLineItems,
      affectedDraftQuotes,
      shiftLowPp,
      shiftHighPp,
    };
  });
}

// Delete a category. Existing assembly_leaf_inputs rows that
// reference it are unaffected — they keep their saved markup_pct
// value (which is stored on the row, not derived at read time).
// Only the dropdown's list of categories changes; old rows stay
// valid.
//
// Per Edward's UX call: warn the user via modal copy, but don't block.
// Admins know what they're doing and re-creating the category later
// restores dropdown availability without touching existing rows.
export async function deleteMarkupDefault(
  formData: FormData,
): Promise<ActionResult<{ category: string; referenceCount: number }>> {
  return runAction(async () => {
    const admin = await requireAdminAction();

    const category = String(formData.get("category") ?? "").trim();
    if (category === "") {
      throw new ActionGuardError(ERR.VALIDATION, "Category is required.");
    }

    // Wrap select + delete + audit in a transaction so the audit row
    // captures the actual orphaned count at delete time (rather than
    // a separate post-delete query that could see different data) and
    // we never delete without auditing.
    const refCount = await db.transaction(async (tx) => {
      const [prior] = await tx
        .select()
        .from(markupDefaults)
        .where(eq(markupDefaults.category, category))
        .limit(1);
      if (!prior) {
        throw new ActionGuardError(
          ERR.NOT_FOUND,
          `Category "${category}" not found.`,
        );
      }

      const [{ n }] = await tx
        .select({ n: count() })
        .from(assemblyLeafInputs)
        .where(eq(assemblyLeafInputs.category, category));

      await tx
        .delete(markupDefaults)
        .where(eq(markupDefaults.category, category));

      await writeAuditEntry({
        userId: admin.id,
        entityType: "markup_defaults",
        entityId: category,
        action: "delete",
        diffJson: {
          from: {
            category: prior.category,
            defaultMarkupPct: prior.defaultMarkupPct,
          },
          // Slice 11.5.1 — audit field name renamed to reflect NEW
          // model entity. Pre-Slice-11.5.1 rows used key
          // `orphaned_packaging_input_rows`; forensic readers
          // looking for older rows should query both.
          orphaned_assembly_leaf_input_rows: n,
        },
      }, tx);

      return n;
    });

    revalidatePath("/admin/markup-defaults");
    return { category, referenceCount: refCount };
  });
}
