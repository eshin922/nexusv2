"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  productTypeChargeDefaults,
  productTypeChargeProfile,
  users,
} from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { ActionGuardError, ERR, runAction, type ActionResult } from "@/lib/action-result";
import { requireAdminAction } from "@/lib/admin-guard";
import { COMPONENT_CHARGE_KEYS, type ComponentChargeKey } from "@/lib/commercial-recovery/registry";
import {
  resolveChargeDefaults,
  type ChargeDefaultRow,
  type ChargeDefaultsResolution,
  type ChargeProfileRow,
} from "@/lib/commercial-recovery/charge-defaults";
import { revalidatePath } from "next/cache";

/**
 * Product Type → charge defaults. Admin maintenance.
 *
 * ── THE INVARIANT, AND WHY A TRANSACTION IS NOT ENOUGH ───────────────────
 *
 * `verdict = 'none_expected'` must imply no rules. That spans two tables, so
 * no CHECK can hold it — and a transaction alone does not either. Two admins
 * acting on the same Product Type can both read a consistent state, both pass
 * their own check, and both commit: READ COMMITTED does not serialize
 * check-then-write, which is the same shape as the SKU registry defect where
 * one customer briefly held two approved codes.
 *
 * Every writer here therefore takes an ADVISORY LOCK keyed on the Product Type
 * before reading, so the check and the write are one critical section. The
 * lock is per-type rather than global: two admins editing different types do
 * not queue behind each other.
 *
 * Whether the database should ALSO enforce this with a constraint trigger is a
 * question about the writer set, not about this file — see
 * `docs/proposals/product-type-charge-defaults.md` §6. The premise the advisory
 * lock rests on is that these are the only writers, and
 * `charge-defaults-writers.test.ts` is what keeps that premise true.
 *
 * ── WHAT THESE ACTIONS MAY NEVER WRITE ───────────────────────────────────
 *
 * A tooling classification or a NetSuite item. Neither column exists, and
 * neither should: both would make an accounting decision from a product
 * category, and `componentChargeDestination` refuses an unclassified tooling
 * charge rather than defaulting.
 */

/**
 * Serializes check-and-write per Product Type.
 *
 * Scoped to the transaction, so it releases on commit AND on rollback --
 * including a crash -- which is the property that makes it safe to take before
 * a read. Same construction as `leaves.ts` and `sku-registry.ts`.
 */
const lockFor = (value: string) =>
  sql`select pg_advisory_xact_lock(hashtextextended(${`product_type_charge_defaults:${value}`}, 0))`;

function requireChargeKey(raw: string): ComponentChargeKey {
  if (!(COMPONENT_CHARGE_KEYS as readonly string[]).includes(raw)) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `${raw} is not a supported component charge.`,
    );
  }
  return raw as ComponentChargeKey;
}

function requireProductType(raw: string): string {
  const value = raw.trim();
  if (!value) {
    throw new ActionGuardError(ERR.VALIDATION, "A product type is required.");
  }
  return value;
}

export type ChargeDefaultsAdminRow = {
  productTypeValue: string;
  resolution: ChargeDefaultsResolution;
};

/**
 * Every Product Type that has been reviewed, with its resolution.
 *
 * Types with NO profile are absent here by design — the Settings surface joins
 * this against the live HubSpot vocabulary so an unreviewed type appears as
 * `needs_review` rather than not appearing at all.
 */
export async function listChargeDefaults(): Promise<
  ActionResult<ChargeDefaultsAdminRow[]>
> {
  return runAction(async () => {
    await requireAdminAction();

    const profiles = await db
      .select({
        productTypeValue: productTypeChargeProfile.productTypeValue,
        verdict: productTypeChargeProfile.verdict,
        reviewedAt: productTypeChargeProfile.reviewedAt,
        note: productTypeChargeProfile.note,
        reviewedByEmail: users.email,
      })
      .from(productTypeChargeProfile)
      .leftJoin(users, eq(users.id, productTypeChargeProfile.reviewedByUserId))
      .orderBy(asc(productTypeChargeProfile.productTypeValue));

    const rules = await db
      .select()
      .from(productTypeChargeDefaults)
      .orderBy(asc(productTypeChargeDefaults.productTypeValue), asc(productTypeChargeDefaults.chargeKey));

    return profiles.map((p) => {
      const profile: ChargeProfileRow = {
        productTypeValue: p.productTypeValue,
        verdict: p.verdict as ChargeProfileRow["verdict"],
        reviewedByEmail: p.reviewedByEmail ?? null,
        reviewedAt: p.reviewedAt,
        note: p.note,
      };
      const mine: ChargeDefaultRow[] = rules
        .filter((r) => r.productTypeValue === p.productTypeValue)
        .map((r) => ({
          productTypeValue: r.productTypeValue,
          chargeKey: r.chargeKey as ComponentChargeKey,
          preselected: r.preselected,
          note: r.note,
        }));
      return {
        productTypeValue: p.productTypeValue,
        // Resolved through the SAME function the authoring path will use, so a
        // contradiction is reported identically in both places rather than
        // being smoothed over by whichever surface read it.
        resolution: resolveChargeDefaults({
          productTypeValue: p.productTypeValue,
          profile,
          rules: mine,
        }),
      };
    });
  });
}

/**
 * Record that a Product Type has been reviewed and no charges are expected.
 *
 * REFUSES while rules exist. Silently deleting them would turn "I reviewed
 * this" into "I discarded somebody's rules", which is a different act and not
 * the one the admin asked for — they are told, and remove them deliberately.
 */
export async function setNoneExpected(
  formData: FormData,
): Promise<ActionResult<{ productTypeValue: string }>> {
  return runAction(async () => {
    const admin = await requireAdminAction();
    const value = requireProductType(String(formData.get("productTypeValue") ?? ""));
    const note = String(formData.get("note") ?? "").trim() || null;

    await db.transaction(async (tx) => {
      await tx.execute(lockFor(value));

      const existing = await tx
        .select({ id: productTypeChargeDefaults.id })
        .from(productTypeChargeDefaults)
        .where(eq(productTypeChargeDefaults.productTypeValue, value));
      if (existing.length > 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `${value} still has ${existing.length} suggested charge(s). Remove them first — ` +
            `recording "none expected" will not discard rules somebody added.`,
        );
      }

      const [prior] = await tx
        .select()
        .from(productTypeChargeProfile)
        .where(eq(productTypeChargeProfile.productTypeValue, value))
        .limit(1);

      await tx
        .insert(productTypeChargeProfile)
        .values({
          productTypeValue: value,
          verdict: "none_expected",
          reviewedByUserId: admin.id,
          note,
          updatedByUserId: admin.id,
        })
        .onConflictDoUpdate({
          target: productTypeChargeProfile.productTypeValue,
          set: {
            verdict: "none_expected",
            reviewedByUserId: admin.id,
            reviewedAt: new Date(),
            note,
            updatedAt: new Date(),
            updatedByUserId: admin.id,
          },
        });

      await writeAuditEntry(
        {
          userId: admin.id,
          entityType: "product_type_charge_profile",
          entityId: value,
          action: "product_type_charge_profile_reviewed",
          diffJson: {
            product_type_value: value,
            from: prior ? { verdict: prior.verdict, note: prior.note } : null,
            to: { verdict: "none_expected", note },
          },
        },
        tx,
      );
    });

    revalidatePath("/admin/charge-defaults");
    return { productTypeValue: value };
  });
}

/**
 * Add or update one suggested charge.
 *
 * Creates the profile at `defaults` if the type had none, in the SAME
 * transaction — a rule with no verdict is unrepresentable through the foreign
 * key, and asking an admin to record a verdict before adding their first rule
 * would be ceremony over a decision they have obviously made.
 */
export async function upsertChargeDefault(
  formData: FormData,
): Promise<ActionResult<{ productTypeValue: string; chargeKey: ComponentChargeKey }>> {
  return runAction(async () => {
    const admin = await requireAdminAction();
    const value = requireProductType(String(formData.get("productTypeValue") ?? ""));
    const chargeKey = requireChargeKey(String(formData.get("chargeKey") ?? "").trim());
    const preselected = formData.get("preselected") === "on";
    const note = String(formData.get("note") ?? "").trim() || null;

    await db.transaction(async (tx) => {
      await tx.execute(lockFor(value));

      const [prior] = await tx
        .select()
        .from(productTypeChargeProfile)
        .where(eq(productTypeChargeProfile.productTypeValue, value))
        .limit(1);

      // A rule implies the verdict. Recording `none_expected` and then adding a
      // rule is a change of mind, not a contradiction to refuse — so the
      // verdict moves with it, and the audit says it did.
      await tx
        .insert(productTypeChargeProfile)
        .values({
          productTypeValue: value,
          verdict: "defaults",
          reviewedByUserId: admin.id,
          updatedByUserId: admin.id,
        })
        .onConflictDoUpdate({
          target: productTypeChargeProfile.productTypeValue,
          set: {
            verdict: "defaults",
            reviewedByUserId: admin.id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
            updatedByUserId: admin.id,
          },
        });

      const [priorRule] = await tx
        .select()
        .from(productTypeChargeDefaults)
        .where(
          and(
            eq(productTypeChargeDefaults.productTypeValue, value),
            eq(productTypeChargeDefaults.chargeKey, chargeKey),
          ),
        )
        .limit(1);

      await tx
        .insert(productTypeChargeDefaults)
        .values({
          productTypeValue: value,
          chargeKey,
          preselected,
          note,
          createdByUserId: admin.id,
          updatedByUserId: admin.id,
        })
        .onConflictDoUpdate({
          target: [
            productTypeChargeDefaults.productTypeValue,
            productTypeChargeDefaults.chargeKey,
          ],
          set: {
            preselected,
            note,
            updatedAt: new Date(),
            updatedByUserId: admin.id,
          },
        });

      await writeAuditEntry(
        {
          userId: admin.id,
          entityType: "product_type_charge_default",
          entityId: `${value}:${chargeKey}`,
          action: "product_type_charge_default_updated",
          diffJson: {
            product_type_value: value,
            charge_key: chargeKey,
            from: priorRule
              ? { preselected: priorRule.preselected, note: priorRule.note }
              : null,
            to: { preselected, note },
            verdict_from: prior?.verdict ?? null,
            verdict_to: "defaults",
          },
        },
        tx,
      );
    });

    revalidatePath("/admin/charge-defaults");
    return { productTypeValue: value, chargeKey };
  });
}

/**
 * Remove one suggested charge.
 *
 * ── REMOVING THE LAST ONE IS REFUSED, AND THAT IS THE WHOLE POINT ────────
 *
 * An earlier version allowed it and let the type land at `defaults` with no
 * rules -- a contradiction, reported honestly. Reporting it honestly did not
 * make it acceptable: an ORDINARY SUPPORTED ACTION must not be able to leave a
 * valid state machine in an invalid state. A surface that tells an admin their
 * data is inconsistent, immediately after they used the only control available
 * to them, is describing its own defect.
 *
 * The alternative considered was to return the type to `needs_review`
 * automatically. Rejected: removing one charge would then silently withdraw
 * somebody's review, which is a larger act than the one the control names --
 * the mirror image of inferring `none_expected`, and wrong for the same reason.
 * Every action's effect should equal its name.
 *
 * So the refusal names the two real intents and the action for each:
 *
 *   replace it        -> add the replacement FIRST, then remove this one
 *   no charges here   -> Clear review, then None expected
 *
 * Both already exist, both are explicit, and neither puts words in a
 * reviewer's mouth.
 *
 * `contradiction` survives in the resolver because state written AROUND these
 * actions can still reach it -- the database cannot hold this invariant. What
 * changed is that no supported action can produce it.
 */
export async function removeChargeDefault(
  formData: FormData,
): Promise<ActionResult<{ productTypeValue: string; chargeKey: string; remaining: number }>> {
  return runAction(async () => {
    const admin = await requireAdminAction();
    const value = requireProductType(String(formData.get("productTypeValue") ?? ""));
    const chargeKey = requireChargeKey(String(formData.get("chargeKey") ?? "").trim());

    const remaining = await db.transaction(async (tx) => {
      await tx.execute(lockFor(value));

      // Counted UNDER the lock and before the delete, so a concurrent remove
      // cannot let two callers each believe they are not the last.
      const existing = await tx
        .select({ chargeKey: productTypeChargeDefaults.chargeKey })
        .from(productTypeChargeDefaults)
        .where(eq(productTypeChargeDefaults.productTypeValue, value));

      const [verdictRow] = await tx
        .select({ verdict: productTypeChargeProfile.verdict })
        .from(productTypeChargeProfile)
        .where(eq(productTypeChargeProfile.productTypeValue, value))
        .limit(1);

      // ONLY when the verdict says there are defaults. Against a stored
      // `none_expected` carrying rules -- a contradiction the database permits
      // and these actions never create -- removing the last rule is the REPAIR,
      // and refusing it would trap an admin in the invalid state with no exit
      // but a cascade that discards the review as well.
      const lastOfDefaults =
        verdictRow?.verdict === "defaults" &&
        existing.length === 1 &&
        existing[0].chargeKey === chargeKey;

      if (lastOfDefaults) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `${chargeKey} is the only suggested charge for ${value}, and removing it ` +
            `would leave the type reviewed with nothing to suggest — which is not ` +
            `one of the three answers. To swap it, add the replacement first. To ` +
            `record that no charges are expected, use “Clear review”, then “None ` +
            `expected” — those are different decisions and each is recorded as one.`,
        );
      }

      const removed = await tx
        .delete(productTypeChargeDefaults)
        .where(
          and(
            eq(productTypeChargeDefaults.productTypeValue, value),
            eq(productTypeChargeDefaults.chargeKey, chargeKey),
          ),
        )
        .returning({ preselected: productTypeChargeDefaults.preselected });

      if (removed.length === 0) {
        throw new ActionGuardError(
          ERR.NOT_FOUND,
          `${value} has no ${chargeKey} rule to remove.`,
        );
      }

      const left = await tx
        .select({ id: productTypeChargeDefaults.id })
        .from(productTypeChargeDefaults)
        .where(eq(productTypeChargeDefaults.productTypeValue, value));

      await writeAuditEntry(
        {
          userId: admin.id,
          entityType: "product_type_charge_default",
          entityId: `${value}:${chargeKey}`,
          action: "product_type_charge_default_removed",
          diffJson: {
            product_type_value: value,
            charge_key: chargeKey,
            from: { preselected: removed[0].preselected },
            to: null,
            rules_remaining: left.length,
          },
        },
        tx,
      );

      return left.length;
    });

    revalidatePath("/admin/charge-defaults");
    return { productTypeValue: value, chargeKey, remaining };
  });
}

/**
 * Drop the review entirely, returning the type to `needs_review`.
 *
 * Cascades the rules, which is why it is a separate, explicit action rather
 * than a side effect of removing the last one.
 */
export async function clearChargeProfile(
  formData: FormData,
): Promise<ActionResult<{ productTypeValue: string }>> {
  return runAction(async () => {
    const admin = await requireAdminAction();
    const value = requireProductType(String(formData.get("productTypeValue") ?? ""));

    await db.transaction(async (tx) => {
      await tx.execute(lockFor(value));

      const rules = await tx
        .select({ chargeKey: productTypeChargeDefaults.chargeKey })
        .from(productTypeChargeDefaults)
        .where(eq(productTypeChargeDefaults.productTypeValue, value));

      const gone = await tx
        .delete(productTypeChargeProfile)
        .where(eq(productTypeChargeProfile.productTypeValue, value))
        .returning({ verdict: productTypeChargeProfile.verdict });

      if (gone.length === 0) {
        throw new ActionGuardError(
          ERR.NOT_FOUND,
          `${value} has not been reviewed, so there is nothing to clear.`,
        );
      }

      await writeAuditEntry(
        {
          userId: admin.id,
          entityType: "product_type_charge_profile",
          entityId: value,
          action: "product_type_charge_profile_cleared",
          diffJson: {
            product_type_value: value,
            from: { verdict: gone[0].verdict, rules: rules.map((r) => r.chargeKey) },
            to: null,
          },
        },
        tx,
      );
    });

    revalidatePath("/admin/charge-defaults");
    return { productTypeValue: value };
  });
}
