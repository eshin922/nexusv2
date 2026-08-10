import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeafInputs,
  assemblyLeaves,
  freightLegGroups,
  freightLegs,
  quoteLeaves,
  quotes,
} from "@/db/schema";
import {
  ActionGuardError,
  ERR,
  quoteNotDraftMessage,
} from "./action-result";
import {
  CanonicalAttachmentResolutionError,
  legacyAssemblyLeafId,
  lookupCanonicalAttachmentByLegacyId,
  type CanonicalAttachmentIdentity,
} from "./product-structure/canonical-attachment-identity";

// ---------------------------------------------------------------------------
// Canonical attachment resolution at the operator write boundary
// ---------------------------------------------------------------------------
//
// `lookupCanonicalAttachmentByLegacyId` fails closed by design and MUST keep
// doing so — it is the invariant that stops a mis-resolved attachment from
// being written against the wrong quote. That hard exception is correct
// everywhere except one place: an operator action.
//
// There, an unconverted throw escapes `runAction` (which re-raises anything
// that is not an ActionGuardError), so the operator gets a full-page runtime
// boundary instead of a handled failure — and the optimistic projection that
// was applied before the call never learns the write failed, leaving an
// unpersisted value on screen looking saved.
//
// So the conversion happens HERE, at the boundary, and only here. The
// resolver is untouched; migrations, jobs and any non-action caller still get
// the hard exception. What changes is that an operator now receives a
// governed DATA_INTEGRITY result and keeps their workspace.
//
// This is containment, not repair. The underlying cause is that
// `assembly_leaves.quote_leaf_id` was never populated — migration 0049 was
// authored but deliberately withheld from the journal, so 129 of 137 rows
// have no canonical pointer. See docs/costs-certification-handover.md §0.5.
// Removing this boundary handler once the population lands would be wrong
// anyway: the invariant can still fail, and when it does the operator should
// still be told rather than dropped into a crash.

const ATTACHMENT_INTEGRITY_MESSAGE =
  "This product's structure could not be resolved, so the edit was not saved. " +
  "Nothing was changed. Please report this quote so the structure can be repaired.";

/**
 * Diagnostic read taken ONLY on the failure path.
 *
 * The resolver reports that resolution failed, not why. Support needs the
 * distinction between "no canonical row exists at all" and "a row exists but
 * the pointer is missing or drifting", because those have different repairs.
 * Cheap to compute here; never runs on the success path.
 */
async function describeAttachmentFailure(assemblyLeafId: string) {
  const rows = await db
    .select({
      assemblyId: assemblyLeaves.assemblyId,
      leafId: assemblyLeaves.leafId,
      pointer: assemblyLeaves.quoteLeafId,
      quoteId: assemblies.quoteId,
    })
    .from(assemblyLeaves)
    .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
    .where(eq(assemblyLeaves.id, assemblyLeafId))
    .limit(1);
  if (rows.length === 0) return { assemblyLeafId, reason: "legacy_row_not_found" };

  const row = rows[0];
  const candidates = await db
    .select({ id: quoteLeaves.id })
    .from(quoteLeaves)
    .where(
      and(
        eq(quoteLeaves.quoteId, row.quoteId),
        eq(quoteLeaves.assemblyId, row.assemblyId),
        eq(quoteLeaves.leafId, row.leafId),
      ),
    )
    .limit(5);

  const candidateCount = candidates.length;
  const reason =
    row.pointer === null
      ? candidateCount === 0
        ? "missing_pointer_no_canonical_row"
        : "missing_pointer_canonical_row_available"
      : candidateCount === 0
        ? "pointer_present_but_unresolvable"
        : "drifting_mapping";

  return {
    assemblyLeafId,
    quoteId: row.quoteId,
    assemblyId: row.assemblyId,
    leafId: row.leafId,
    pointer: row.pointer,
    candidateCount,
    reason,
  };
}

/** Resolve at an operator boundary: hard failure becomes a governed result. */
async function resolveAttachmentForOperator(
  assemblyLeafId: string,
): Promise<CanonicalAttachmentIdentity> {
  try {
    return await lookupCanonicalAttachmentByLegacyId(
      legacyAssemblyLeafId(assemblyLeafId),
    );
  } catch (e) {
    if (!(e instanceof CanonicalAttachmentResolutionError)) throw e;
    console.error(
      "[canonical-attachment] resolution failed at operator write boundary",
      { ...(await describeAttachmentFailure(assemblyLeafId)), error: e.message },
    );
    throw new ActionGuardError(ERR.DATA_INTEGRITY, ATTACHMENT_INTEGRITY_MESSAGE);
  }
}

// Shared draft + ownership guards used by every cost-input action
// layer (packaging, production, freight, costing). Hoisted Slice 7;
// migrated to NEW-model in Slice 11.5 Step 4 + 11.5.1 Step 3 (OLD
// `quoteForSku` / `quoteForLeafSku` / `quoteForLineGroup` deleted
// alongside the cost_skus tree drop; NEW equivalents are
// `quoteForAssembly` / `quoteForAssemblyLeaf` /
// `quoteForAssemblyLeafInputLineGroup` below).
//
// Each helper throws ActionGuardError on guard failure; callers
// wrapped in runAction get a structured ActionResult error response.
// Real bugs (and Next's redirect() sentinel) propagate.

type Quote = typeof quotes.$inferSelect;
type FreightLeg = typeof freightLegs.$inferSelect;
type FreightLegGroup = typeof freightLegGroups.$inferSelect;

// Asserts the quote is editable (status === 'draft'). Used by callers that
// already have the quote loaded.
export function requireDraft(quote: Quote): void {
  if (quote.status !== "draft") {
    throw new ActionGuardError(
      ERR.QUOTE_NOT_DRAFT,
      quoteNotDraftMessage(quote.status),
    );
  }
}

// Slice 12 Step 2 — asserts the quote is REVISABLE: currently `sent`
// or `accepted`. Used by the Revise-in-place action (Step 6) to gate
// the sent → draft / accepted → draft transitions that Nexus's
// reversibility model (v3 brief §4.1) requires.
//
// Reject list is explicit:
//   - draft:      already editable, nothing to revise
//   - complete:   THE LOCK (Pattern 52 relocated here per v3 §5) —
//                 NetSuite SO is live; admin override + SO cancellation
//                 required to unwind (v1.5+ scope)
//   - superseded: legacy status (zero writers today); v1 doesn't use it
//   - lost:       terminal (customer declined); revising a lost quote
//                 doesn't fit the operational model
//
// `requireDraft` stays authoritative for edit actions. Revise flips
// the SAME row's status back to draft first, THEN edits are allowed
// via requireDraft on the follow-up actions. See v3 brief §5.1
// (Round 3 amendment 2 — `requireDraft` UNCHANGED).
export function requireRevisable(quote: Quote): void {
  if (quote.status !== "sent" && quote.status !== "accepted") {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `This quote is in '${quote.status}' status and cannot be revised. Revise is available on 'sent' and 'accepted' quotes only.`,
    );
  }
}

// Resolve the quote by id and assert draft. For actions keyed on quote
// itself (vs sku or line group): updateQuoteGlobalPriceAdj, etc.
export async function quoteByIdDraft(quoteId: string): Promise<Quote> {
  const rows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found");
  const quote = rows[0];
  requireDraft(quote);
  return quote;
}

// ---------- NEW-model guards ----------
//
// NEW-model write actions resolve quote ownership through assemblies
// + assembly_leaves (replacing OLD quote_skus tree per Slice 11.5).
//
// Math semantics (per Slice 11.5 brief §2):
//   - assembly = math-assembly (parent in math tree)
//   - assembly_leaf = math-leaf (cost-bearing junction PK; receives
//     packaging cells + sell-price overrides + client targets)
//   - production policy + per-tier service fees attach at assembly
//     level (assembly_production_inputs); adapter fans to anchor leaf

type Assembly = typeof assemblies.$inferSelect;
type AssemblyLeaf = typeof assemblyLeaves.$inferSelect;

// Resolve quote ownership through (assembly → quote) and assert draft.
// Sister to quoteForSku for NEW-model assembly-keyed actions
// (production policy, production-input cells).
export async function quoteForAssembly(
  assemblyId: string,
): Promise<{ quote: Quote; assembly: Assembly }> {
  const rows = await db
    .select({ quote: quotes, assembly: assemblies })
    .from(assemblies)
    .innerJoin(quotes, eq(quotes.id, assemblies.quoteId))
    .where(eq(assemblies.id, assemblyId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Assembly not found");
  const { quote, assembly } = rows[0];
  requireDraft(quote);
  return { quote, assembly };
}

// Resolve quote ownership through (assembly_leaf → assembly → quote)
// and assert draft. Sister to quoteForLeafSku for NEW-model
// assembly_leaf-keyed actions (packaging cells, sell-price overrides,
// client targets).
//
// No leaf-only check — assembly_leaves ARE the math-leaves in NEW
// model; semantically equivalent to OLD leaf SKUs. Type-only
// constraint is enforced by the FK shape (assembly_leaf_inputs FK to
// assembly_leaves only).
export async function quoteForAssemblyLeaf(
  assemblyLeafId: string,
): Promise<{
  quote: Quote;
  assembly: Assembly;
  assemblyLeaf: AssemblyLeaf;
  attachment: CanonicalAttachmentIdentity;
}> {
  const attachment = await resolveAttachmentForOperator(assemblyLeafId);
  const rows = await db
    .select({
      quote: quotes,
      assembly: assemblies,
      assemblyLeaf: assemblyLeaves,
    })
    .from(assemblyLeaves)
    .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
    .innerJoin(quotes, eq(quotes.id, assemblies.quoteId))
    .where(eq(assemblyLeaves.id, assemblyLeafId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Assembly leaf not found");
  const { quote, assembly, assemblyLeaf } = rows[0];
  if (
    attachment.quoteId !== quote.id ||
    attachment.assemblyId !== assembly.id ||
    attachment.leafId !== assemblyLeaf.leafId
  ) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "Commercial attachment identity does not match its Quote membership.",
    );
  }
  requireDraft(quote);
  return { quote, assembly, assemblyLeaf, attachment };
}

// Resolve quote ownership through (assembly_leaf_inputs.line_group_id
// → assembly_leaves → assemblies → quote) and assert draft. Sister to
// quoteForLineGroup for NEW-model line-level packaging actions.
//
// line_group_id semantics: synthetic UUID grouping rows that represent
// the SAME logical packaging line across tiers (per CLAUDE.md
// audit_log namespace section "line_group_id semantics"). One
// line_group → N tier rows; first row carries the line metadata,
// siblings copy at the action layer.
export async function quoteForAssemblyLeafInputLineGroup(
  lineGroupId: string,
): Promise<{
  quote: Quote;
  assembly: Assembly;
  assemblyLeaf: AssemblyLeaf;
  attachment: CanonicalAttachmentIdentity;
  lineGroupId: string;
}> {
  const rows = await db
    .select({
      quote: quotes,
      assembly: assemblies,
      assemblyLeaf: assemblyLeaves,
    })
    .from(assemblyLeafInputs)
    .innerJoin(
      assemblyLeaves,
      eq(assemblyLeaves.id, assemblyLeafInputs.assemblyLeafId),
    )
    .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
    .innerJoin(quotes, eq(quotes.id, assemblies.quoteId))
    .where(eq(assemblyLeafInputs.lineGroupId, lineGroupId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(
      ERR.NOT_FOUND,
      "Packaging line not found",
    );
  const { quote, assembly, assemblyLeaf } = rows[0];
  const attachment = await resolveAttachmentForOperator(assemblyLeaf.id);
  if (
    attachment.quoteId !== quote.id ||
    attachment.assemblyId !== assembly.id ||
    attachment.leafId !== assemblyLeaf.leafId
  ) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "Commercial attachment identity does not match its Quote membership.",
    );
  }
  requireDraft(quote);
  return { quote, assembly, assemblyLeaf, attachment, lineGroupId };
}

// Slice R6.2 — resolve quote ownership through (leg-group → quote).
// Used by leg-group lifecycle actions (add / update / delete a group).
export async function quoteForLegGroup(
  legGroupId: string,
): Promise<{ quote: Quote; group: FreightLegGroup }> {
  const rows = await db
    .select({ quote: quotes, group: freightLegGroups })
    .from(freightLegGroups)
    .innerJoin(quotes, eq(quotes.id, freightLegGroups.quoteId))
    .where(eq(freightLegGroups.id, legGroupId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Leg group not found");
  const { quote, group } = rows[0];
  requireDraft(quote);
  return { quote, group };
}

// Slice R6.2 — resolve quote ownership through (leg → leg-group →
// quote). Used by leg lifecycle + per-tier rate cell actions.
export async function quoteForLeg(
  legId: string,
): Promise<{ quote: Quote; group: FreightLegGroup; leg: FreightLeg }> {
  const rows = await db
    .select({
      quote: quotes,
      group: freightLegGroups,
      leg: freightLegs,
    })
    .from(freightLegs)
    .innerJoin(
      freightLegGroups,
      eq(freightLegGroups.id, freightLegs.legGroupId),
    )
    .innerJoin(quotes, eq(quotes.id, freightLegGroups.quoteId))
    .where(eq(freightLegs.id, legId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Leg not found");
  const { quote, group, leg } = rows[0];
  requireDraft(quote);
  return { quote, group, leg };
}

// ---------------------------------------------------------------------------
// Phase 3 · Package 1 — resolve a quote from CANONICAL attachment identity
// ---------------------------------------------------------------------------
//
// Every guard above this one reaches the quote through the legacy junction:
// assembly_leaf → assembly → quote. A persisted lift keys on `quote_leaves.id`
// and must not, for the reason OD-017 records — a direct attachment
// (`quote_leaves.assembly_id IS NULL`) has no junction row, so a junction-based
// guard would refuse to resolve a quote that plainly owns the leaf.
//
// One join, and it is the FK the canonical row already carries. There is no
// crossing here and deliberately none: `quote_leaves.quote_id` IS the answer.
//
// Batch-shaped because Apply commits a SET. Resolving one cell at a time would
// be N round trips and — worse — would let a set whose cells span two quotes
// pass every individual check while being incoherent as a whole. Every id must
// resolve, and every resolution must name the same quote; anything else is
// refused before a single row is written.
export async function quoteForQuoteLeaves(
  quoteLeafIds: readonly string[],
): Promise<{ quote: Quote; quoteLeafIds: readonly string[] }> {
  const unique = Array.from(new Set(quoteLeafIds));
  if (unique.length === 0) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "No commercial attachment was named.",
    );
  }
  const rows = await db
    .select({ quote: quotes, quoteLeafId: quoteLeaves.id })
    .from(quoteLeaves)
    .innerJoin(quotes, eq(quotes.id, quoteLeaves.quoteId))
    .where(inArray(quoteLeaves.id, unique));

  if (rows.length !== unique.length) {
    // Named an attachment that does not exist. Reported without naming which,
    // because a set arriving with an unresolvable id is a client-side contract
    // break rather than something the operator mistyped.
    throw new ActionGuardError(
      ERR.NOT_FOUND,
      "A commercial attachment this adjustment names does not exist.",
    );
  }
  const quote = rows[0].quote;
  if (rows.some((r) => r.quote.id !== quote.id)) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "These adjustments do not all belong to one quote.",
    );
  }
  requireDraft(quote);
  return { quote, quoteLeafIds: unique };
}
