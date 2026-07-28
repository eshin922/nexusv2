import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeafInputs,
  assemblyLeaves,
  freightLegGroups,
  freightLegs,
  quotes,
} from "@/db/schema";
import {
  ActionGuardError,
  ERR,
  quoteNotDraftMessage,
} from "./action-result";

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
): Promise<{ quote: Quote; assembly: Assembly; assemblyLeaf: AssemblyLeaf }> {
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
  requireDraft(quote);
  return { quote, assembly, assemblyLeaf };
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
  requireDraft(quote);
  return { quote, assembly, assemblyLeaf, lineGroupId };
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
