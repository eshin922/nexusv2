"use server";

import { asc, count, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, markupDefaults, packagingInputs } from "@/db/schema";
import { requireAdminAction } from "@/lib/admin-guard";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { validatePercentDecimal } from "@/lib/percent-validation";

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

      await tx.insert(auditLog).values({
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
      });

      return created;
    });

    revalidatePath("/admin/markup-defaults");
    return row;
  });
}

// Reference count for a category — used by the admin UI to render
// "(N referenced)" inline and to surface in the delete confirmation
// modal. Soft reference: packaging_inputs.category is text with no FK,
// so the join is logical, not enforced.
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
      category: packagingInputs.category,
      n: count(),
    })
    .from(packagingInputs)
    .where(isNotNull(packagingInputs.category))
    .groupBy(packagingInputs.category);
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.category !== null) map.set(r.category, Number(r.n));
  }
  return map;
}

// Delete a category. Existing packaging_inputs rows that reference it
// are unaffected — they keep their saved markup_pct value (which is
// stored on the row, not derived at read time). Only the dropdown's
// list of categories changes; old rows stay valid.
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
        .from(packagingInputs)
        .where(eq(packagingInputs.category, category));

      await tx
        .delete(markupDefaults)
        .where(eq(markupDefaults.category, category));

      await tx.insert(auditLog).values({
        userId: admin.id,
        entityType: "markup_defaults",
        entityId: category,
        action: "delete",
        diffJson: {
          from: {
            category: prior.category,
            defaultMarkupPct: prior.defaultMarkupPct,
          },
          orphaned_packaging_input_rows: n,
        },
      });

      return n;
    });

    revalidatePath("/admin/markup-defaults");
    return { category, referenceCount: refCount };
  });
}
