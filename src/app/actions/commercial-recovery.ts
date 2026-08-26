"use server";

/**
 * Commercial recovery elections — the only writer.
 *
 * ── WHAT THIS ACTION IS ALLOWED TO CHANGE ────────────────────────────────
 *
 * One row in `quote_charge_recovery`, and nothing else. In particular it does
 * NOT write `allocate_service_fees_to_cost`, does not touch any cost input,
 * and does not re-amortise a unit rate. An election overrides PROJECTION only,
 * which is what makes it non-destructive: clearing it restores the preserved
 * per-assembly legacy behaviour rather than resurrecting nothing.
 *
 * ── PATTERN 52 ───────────────────────────────────────────────────────────
 *
 * These rows are a Pattern 52 freeze-list entry (see
 * docs/pattern-52-freeze-list.md): they change what the customer document says
 * and are mirrored into `quote_snapshot_charge_recovery` inside the send
 * transaction. So the guard is `quoteByIdDraft` — STRICTER than
 * `assertNotFrozen`, because an election is a quote-authoring decision and a
 * sent revision must not have its economics moved underneath it.
 *
 * `assertNotFrozen` is ALSO called, deliberately and redundantly. The Slice 13
 * §0.5 protocol is a grep for that symbol; a writer that satisfies the rule by
 * a stronger-but-differently-named guard is invisible to the check that exists
 * to find it. The cost is one call; the benefit is that this file answers the
 * protocol's question by being findable.
 *
 * ── REFUSAL IS ENFORCED HERE TOO, AND FROM THE SAME SOURCE ───────────────
 *
 * The surface refuses as well, but the surface is not the boundary. This asks
 * `refusalFor` — the same function resolution asks — so a mode cannot be
 * refused at one boundary and quietly accepted at another.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyProductionInputs,
  quoteChargeRecovery,
  quoteLeaves,
} from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  assertNotFrozen,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  OTC_COLUMN_TO_CHARGE,
  RECOVERY_MODES,
  chargePolicy,
  type RecoveryChargeKey,
  type RecoveryMode,
} from "@/lib/commercial-recovery/registry";
import { refusalFor } from "@/lib/commercial-recovery/resolve";
import {
  measureRecoveryImpact,
  type RecoveryImpact,
} from "@/lib/commercial-recovery/impact";
import { loadQuoteCostingInput } from "@/app/actions/costing";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { resolveCustomerView } from "@/lib/customer-view-resolver";
import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { CustomerView } from "@/types/quote";
import { revalidateQuoteTree } from "@/lib/revalidate";

function parseChargeKey(raw: FormDataEntryValue | null): RecoveryChargeKey {
  const v = String(raw ?? "").trim();
  // `chargePolicy` throws on an unknown key, which is the validation.
  chargePolicy(v as RecoveryChargeKey);
  return v as RecoveryChargeKey;
}

function parseMode(raw: FormDataEntryValue | null): RecoveryMode | null {
  const v = String(raw ?? "").trim();
  // Empty CLEARS the election. That is a real operation, not a no-op: it
  // returns the charge to legacy per-assembly resolution.
  if (v === "") return null;
  if (!(RECOVERY_MODES as readonly string[]).includes(v)) {
    throw new ActionGuardError(ERR.VALIDATION, `Unknown recovery mode: ${v}`);
  }
  return v as RecoveryMode;
}

/**
 * Every distinct `allocate_service_fees_to_cost` value present in the quote.
 *
 * An election is stored PER QUOTE while the allocation state it can conflict
 * with is PER ASSEMBLY, and three real quotes carry both values at once. So a
 * mode that is refused for ANY assembly in the quote is refused for the quote:
 * accepting it would leave that assembly mis-priced while the election looked
 * settled. Conservative in the only direction that cannot produce a wrong
 * number.
 */
/**
 * Charge keys with any contribution owned by a Direct Service leaf.
 *
 * A Direct Service's production row is the one keyed by `quoteLeafId` rather
 * than `assemblyId` — the same discriminator `costing-adapter.ts` uses to set
 * `ownerKind`. Read here rather than inferred from the constructed state so the
 * writer does not have to run the engine to validate an election.
 *
 * A column is a contribution when it is non-zero. A $0 column is not a charge,
 * and refusing an election on account of one would deny a placement over money
 * that does not exist.
 */
async function directServiceChargeKeys(quoteId: string): Promise<Set<RecoveryChargeKey>> {
  const leafIds = (
    await db.select({ id: quoteLeaves.id }).from(quoteLeaves).where(eq(quoteLeaves.quoteId, quoteId))
  ).map((r) => r.id);
  if (leafIds.length === 0) return new Set();

  const rows = await db
    .select()
    .from(assemblyProductionInputs)
    .where(inArray(assemblyProductionInputs.quoteLeafId, leafIds));

  const keys = new Set<RecoveryChargeKey>();
  for (const row of rows) {
    for (const [column, chargeKey] of Object.entries(OTC_COLUMN_TO_CHARGE) as Array<
      [string, RecoveryChargeKey]
    >) {
      const raw = (row as Record<string, unknown>)[column];
      if (raw === null || raw === undefined) continue;
      if (Math.abs(Number(raw)) > 0) keys.add(chargeKey);
    }
  }
  return keys;
}

async function allocationStatesInQuote(quoteId: string): Promise<boolean[]> {
  const assemblyIds = (
    await db.select({ id: assemblies.id }).from(assemblies).where(eq(assemblies.quoteId, quoteId))
  ).map((r) => r.id);
  const leafIds = (
    await db.select({ id: quoteLeaves.id }).from(quoteLeaves).where(eq(quoteLeaves.quoteId, quoteId))
  ).map((r) => r.id);

  const rows = [
    ...(assemblyIds.length
      ? await db
          .select({ v: assemblyProductionInputs.allocateServiceFeesToCost })
          .from(assemblyProductionInputs)
          .where(inArray(assemblyProductionInputs.assemblyId, assemblyIds))
      : []),
    ...(leafIds.length
      ? await db
          .select({ v: assemblyProductionInputs.allocateServiceFeesToCost })
          .from(assemblyProductionInputs)
          .where(inArray(assemblyProductionInputs.quoteLeafId, leafIds))
      : []),
  ];

  const seen = new Set<boolean>();
  for (const r of rows) seen.add(r.v);
  // No production rows at all: the projection's `?? true` default is what
  // would apply, so that is the state to judge against — not "unconstrained".
  return seen.size === 0 ? [true] : [...seen];
}

/**
 * Elect a recovery mode for one governed charge, or clear the election.
 *
 * Returns the stored mode, or `null` when the charge has been returned to
 * legacy resolution.
 */
/**
 * `setChargeRecovery` was REMOVED here.
 *
 * It persisted one election and then re-resolved, which made the operator wait
 * on a database round trip to learn what their own click had done — measured at
 * 1994-4041ms on production, during which the control looked like it had not
 * worked.
 *
 * The order is now inverted. `evaluateChargeRecovery` runs the governed engine
 * over a PROPOSED election set and writes nothing; `persistChargeRecoverySet`
 * stores the exact set behind that and reads it back to confirm. Deleted rather
 * than left in place: a persist-first writer sitting beside an evaluate-first
 * one is an invitation to wire the wrong one.
 */

/**
 * What would this contract do to the customer's total?
 *
 * A READ. It writes nothing, and it is deliberately a separate action from
 * `setChargeRecovery` rather than a field on it: the operator sees the figure
 * and then decides, so the measurement and the commitment are two acts.
 *
 * It runs the real engine on the real input with the candidate election
 * substituted. There is no closed form for the delta — a surgical lift, a tier
 * adjustment and a terminal cell override each change what the ladder does to a
 * legacy-placed charge, and a formula for it would be a second authority for
 * the pricing ladder. See `@/lib/commercial-recovery/impact`.
 *
 * The refusal is asked FIRST, from the same `refusalFor` the writer asks, so a
 * preview is never offered for a contract the boundary would reject.
 */
export async function previewChargeRecovery(
  formData: FormData,
): Promise<ActionResult<RecoveryImpact | null>> {
  return runAction(async () => {
    await ensureUser();

    const quoteId = String(formData.get("quoteId") ?? "");
    const chargeKey = String(formData.get("chargeKey") ?? "") as RecoveryChargeKey;
    const raw = String(formData.get("mode") ?? "");
    const mode = raw === "" ? null : (raw as RecoveryMode);

    if (!quoteId || !chargeKey) {
      throw new ActionGuardError(ERR.VALIDATION, "quoteId and chargeKey are required.");
    }
    if (mode !== null && !RECOVERY_MODES.includes(mode)) {
      throw new ActionGuardError(ERR.VALIDATION, `Unknown recovery mode: ${raw}`);
    }
    // Preview only what could actually be committed. A figure for a refused
    // contract invites the operator to plan around it.
    if (mode !== null) {
      const directService = await directServiceChargeKeys(quoteId);
      for (const perAssemblyAllocate of await allocationStatesInQuote(quoteId)) {
        const reason = refusalFor(chargeKey, mode, {
          perAssemblyAllocate,
          hasDirectServiceContribution: directService.has(chargeKey),
        });
        if (reason) throw new ActionGuardError(ERR.VALIDATION, reason);
      }
    }

    const built = await loadQuoteCostingInput(quoteId);
    if (!built.ok) throw new ActionGuardError(built.error.code, built.error.message);

    return measureRecoveryImpact(built.data, chargeKey, mode);
  });
}
