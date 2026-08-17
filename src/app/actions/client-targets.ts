"use server";

/**
 * Client Target — what the client said they need to pay.
 *
 * A BENCHMARK, and the distinction is the whole design. It enters no price, no
 * margin and no total: nothing here creates or modifies a GPA, a tier
 * adjustment, a lift, a direct price or a Final Quoted Sell. It is internal —
 * never reaching the customer view, the PDF or NetSuite.
 *
 * ── THE UNIT OF ACCOUNT ───────────────────────────────────────────────────
 *
 * A target belongs to the TOP-LEVEL SELLABLE UNIT the client is buying:
 *
 *   Item Group     → `assemblies.id`
 *   Direct Product → `quote_leaves.id` where `assembly_id IS NULL`
 *
 * An INTERNAL MEMBER of an Item Group is refused. The client did not name a
 * price for the bottle inside the kit, and the previous model's inability to
 * say so is why it was replaced — a target written against a member was
 * accepted by the schema and then silently ignored by the math layer. Here it
 * is refused at the boundary, and the Setup surface offers no affordance on a
 * member row, so the refusal is a backstop rather than a thing operators meet.
 *
 * ── COMMON AND TIER-SPECIFIC ──────────────────────────────────────────────
 *
 *   effective target = tier target ?? common target
 *
 * A common target (`tier_id IS NULL`) applies to every tier. A tier-specific
 * one REPLACES it for that tier and does not stack — the same precedence as
 * `tier_price_adj_pct` over `global_price_adj_pct`, deliberately, because
 * operators have already learned that rule on this quote.
 *
 * Clearing the common target LEAVES tier-specific ones standing. A tier target
 * is its own decision and clearing a different one does not unmake it.
 * `clearAllClientTargets` is the deliberate act that removes both.
 */

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  assemblies,
  quoteClientTargets,
  quoteLeaves,
  quoteTiers,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import { writeAuditEntry } from "@/lib/audit";
import { ActionGuardError, ERR, runAction, type ActionResult } from "@/lib/action-result";
import { quoteForAssembly, quoteForQuoteLeaf } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";

/** Which kind of sellable unit a target is addressed to. */
export type SellableUnitKind = "assembly" | "leaf";

type ResolvedUnit = {
  kind: SellableUnitKind;
  /** The id of whichever column carries it. */
  id: string;
  quoteId: string;
  projectId: string;
  /** For audit + error copy. */
  label: string;
};

/**
 * Resolve and authorise the sellable unit, or refuse.
 *
 * Draft is asserted by the loaders (`requireDraft` inside each), so every entry
 * point below inherits it without repeating it.
 */
async function resolveUnit(
  kind: SellableUnitKind,
  unitId: string,
): Promise<ResolvedUnit> {
  if (kind === "assembly") {
    const { quote, assembly } = await quoteForAssembly(unitId);
    return {
      kind,
      id: assembly.id,
      quoteId: quote.id,
      projectId: quote.projectId,
      label: assembly.name ?? assembly.sku ?? "Item Group",
    };
  }

  const { quote, quoteLeaf } = await quoteForQuoteLeaf(unitId);

  // THE REFUSAL. A member leaf is not a sellable unit.
  //
  // `assembly_id` is exactly the distinction: NULL is a Direct Product, which
  // IS what the customer buys; set is a component inside an Item Group, and the
  // Item Group is what carries the target.
  if (quoteLeaf.assemblyId !== null) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "A client target belongs to the finished product, not to a component " +
        "inside it. Set it on the Item Group.",
    );
  }

  return {
    kind,
    id: quoteLeaf.id,
    quoteId: quote.id,
    projectId: quote.projectId,
    label: "Direct Product",
  };
}

/** The column pair, so every query addresses the unit the same way. */
function unitWhere(unit: ResolvedUnit) {
  return unit.kind === "assembly"
    ? eq(quoteClientTargets.assemblyId, unit.id)
    : eq(quoteClientTargets.quoteLeafId, unit.id);
}

function unitColumns(unit: ResolvedUnit) {
  return unit.kind === "assembly"
    ? { assemblyId: unit.id, quoteLeafId: null }
    : { assemblyId: null, quoteLeafId: unit.id };
}

/** `tier_id = X` or `tier_id IS NULL` — never `eq(col, null)`, which is never true. */
function tierWhere(tierId: string | null) {
  return tierId === null
    ? isNull(quoteClientTargets.tierId)
    : eq(quoteClientTargets.tierId, tierId);
}

async function assertTierBelongs(tierId: string, quoteId: string) {
  const rows = await db
    .select({ id: quoteTiers.id, quoteId: quoteTiers.quoteId })
    .from(quoteTiers)
    .where(eq(quoteTiers.id, tierId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found.");
  if (rows[0].quoteId !== quoteId)
    throw new ActionGuardError(
      ERR.VALIDATION,
      "Tier does not belong to this quote.",
    );
}

function readUnit(formData: FormData): { kind: SellableUnitKind; id: string } {
  const kind = String(formData.get("unitKind") ?? "").trim();
  const id = String(formData.get("unitId") ?? "").trim();
  if (kind !== "assembly" && kind !== "leaf")
    throw new ActionGuardError(ERR.VALIDATION, "unitKind must be assembly or leaf");
  if (!id) throw new ActionGuardError(ERR.VALIDATION, "unitId required");
  return { kind, id };
}

/** Empty string means "not supplied" — i.e. the common target. */
function readTierId(formData: FormData): string | null {
  const raw = String(formData.get("tierId") ?? "").trim();
  return raw === "" ? null : raw;
}

/**
 * Set or change one target — common when `tierId` is absent, tier-specific
 * when present.
 *
 * ZERO IS A VALUE. A client can say "we need this at cost", and `$0.00` is that
 * statement; only absence means no target. So the guard rejects negatives and
 * non-numbers, and accepts zero.
 */
export async function setClientTarget(
  formData: FormData,
): Promise<ActionResult<{ unitId: string; tierId: string | null; value: string }>> {
  return runAction(async () => {
    const { kind, id } = readUnit(formData);
    const tierId = readTierId(formData);
    const raw = String(formData.get("value") ?? "").trim();
    const parsed = Number(raw);
    if (raw === "" || !Number.isFinite(parsed))
      throw new ActionGuardError(ERR.VALIDATION, "Enter a target price.");
    if (parsed < 0)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "A client target cannot be negative.",
      );

    const user = await ensureUser();
    const unit = await resolveUnit(kind, id);
    if (tierId !== null) await assertTierBelongs(tierId, unit.quoteId);

    const value = parsed.toFixed(4);
    const existing = await db
      .select()
      .from(quoteClientTargets)
      .where(and(unitWhere(unit), tierWhere(tierId)))
      .limit(1);
    const from = existing[0]?.clientTargetPricePerUnit ?? null;

    // No-op on an unchanged value, so re-entering what is already in force
    // writes no row and logs no audit — the same discipline every other
    // numeric writer on this quote uses.
    if (from !== null && Number(from) === parsed) {
      return { unitId: unit.id, tierId, value };
    }

    // The write and its audit in ONE transaction. An audit row that can commit
    // without the mutation it describes is not evidence of anything.
    await db.transaction(async (tx) => {
      if (existing.length > 0) {
        await tx
          .update(quoteClientTargets)
          .set({ clientTargetPricePerUnit: value, updatedAt: new Date() })
          .where(eq(quoteClientTargets.id, existing[0].id));
      } else {
        await tx.insert(quoteClientTargets).values({
          quoteId: unit.quoteId,
          ...unitColumns(unit),
          tierId,
          clientTargetPricePerUnit: value,
        });
      }

      // ONE action for set / change / clear, distinguished by from→to, per the
      // Slice 9.2 audit-source convention: the same column with the same
      // semantic effect shares an action name, and the value shape says which
      // variant it was.
      await writeAuditEntry(
        {
          userId: user.id,
          entityType: unit.kind === "assembly" ? "assembly" : "quote_leaf",
          entityId: unit.id,
          action: "client_target_updated",
          diffJson: {
            client_target_price_per_unit: { from, to: value },
            scope: tierId === null ? "common" : "tier",
            tier_id: tierId,
            quote_id: unit.quoteId,
          },
        },
        tx,
      );
    });

    revalidateQuoteTree(unit.projectId, unit.quoteId);
    return { unitId: unit.id, tierId, value };
  });
}

/**
 * Clear ONE target.
 *
 * With a tier: "revert to common" — the override goes, the common target
 * stands, and that tier inherits it again.
 *
 * Without: the common target goes, and TIER-SPECIFIC TARGETS SURVIVE. A tier
 * target is its own decision; clearing a different one does not unmake it. The
 * quote is then partially targeted, which is a real state and one the surface
 * states plainly ("1 tier targeted · 3 unset") rather than a state to be
 * prevented by refusing the clear.
 */
export async function clearClientTarget(
  formData: FormData,
): Promise<ActionResult<{ unitId: string; tierId: string | null }>> {
  return runAction(async () => {
    const { kind, id } = readUnit(formData);
    const tierId = readTierId(formData);

    const user = await ensureUser();
    const unit = await resolveUnit(kind, id);

    const existing = await db
      .select()
      .from(quoteClientTargets)
      .where(and(unitWhere(unit), tierWhere(tierId)))
      .limit(1);
    // Already absent. Nothing to remove and nothing to record — clearing twice
    // is not an event.
    if (existing.length === 0) return { unitId: unit.id, tierId };

    await db.transaction(async (tx) => {
      await tx
        .delete(quoteClientTargets)
        .where(eq(quoteClientTargets.id, existing[0].id));

      await writeAuditEntry(
        {
          userId: user.id,
          entityType: unit.kind === "assembly" ? "assembly" : "quote_leaf",
          entityId: unit.id,
          action: "client_target_updated",
          diffJson: {
            client_target_price_per_unit: {
              from: existing[0].clientTargetPricePerUnit,
              to: null,
            },
            scope: tierId === null ? "common" : "tier",
            tier_id: tierId,
            quote_id: unit.quoteId,
          },
        },
        tx,
      );
    });

    revalidateQuoteTree(unit.projectId, unit.quoteId);
    return { unitId: unit.id, tierId };
  });
}

/**
 * Remove every target on one sellable unit — common and tier-specific.
 *
 * Its own action, and its own audit row, because it is its own intent: one
 * deliberate act that removes several decisions. Logging it as N separate
 * clears would describe an operator who cleared them one at a time, which is
 * not what happened.
 */
export async function clearAllClientTargets(
  formData: FormData,
): Promise<ActionResult<{ unitId: string; removed: number }>> {
  return runAction(async () => {
    const { kind, id } = readUnit(formData);

    const user = await ensureUser();
    const unit = await resolveUnit(kind, id);

    const existing = await db
      .select()
      .from(quoteClientTargets)
      .where(unitWhere(unit));
    if (existing.length === 0) return { unitId: unit.id, removed: 0 };

    await db.transaction(async (tx) => {
      await tx.delete(quoteClientTargets).where(unitWhere(unit));

      await writeAuditEntry(
        {
          userId: user.id,
          entityType: unit.kind === "assembly" ? "assembly" : "quote_leaf",
          entityId: unit.id,
          action: "client_targets_cleared",
          diffJson: {
            quote_id: unit.quoteId,
            removed: existing.map((r) => ({
              tier_id: r.tierId,
              scope: r.tierId === null ? "common" : "tier",
              value: r.clientTargetPricePerUnit,
            })),
          },
        },
        tx,
      );
    });

    revalidateQuoteTree(unit.projectId, unit.quoteId);
    return { unitId: unit.id, removed: existing.length };
  });
}
