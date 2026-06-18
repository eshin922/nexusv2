import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  // Slice 11.5 — NEW-model cost-data tables (Step 2 schema).
  assemblies,
  assemblyLeafInputs,
  assemblyLeaves,
  freightLegGroups,
  freightLegs,
  packagingInputs,
  quotes,
  quoteSkus,
} from "@/db/schema";
import {
  ActionGuardError,
  ERR,
  quoteNotDraftMessage,
} from "./action-result";

// Shared draft + ownership guards used by every cost-input action layer
// (packaging, production, freight, costing). Hoisted Slice 7 — extracted
// before the third caller landed.
//
// Each helper throws ActionGuardError on guard failure; callers wrapped
// in runAction get a structured ActionResult error response. Real bugs
// (and Next's redirect() sentinel) propagate.

type Quote = typeof quotes.$inferSelect;
type Sku = typeof quoteSkus.$inferSelect;
type FreightLeg = typeof freightLegs.$inferSelect;
type FreightLegGroup = typeof freightLegGroups.$inferSelect;

// Pre-R6.2 `LineGroupTable` discriminated packaging vs freight line
// groups. R6.2 retires the `freight_inputs` line-group shape entirely;
// packaging is the only remaining domain that uses line-group identity.
// `quoteForLineGroup` below now takes packaging implicitly (no other
// table uses the line-group pattern). Freight's analog is
// `quoteForLeg` / `quoteForLegGroup`.
export type LineGroupTable = "packaging_inputs";

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

// Resolve quote ownership through (sku → quote) and assert draft. Returns
// both rows for the caller to use. Used by per-SKU and per-cell actions
// that arrive with a SKU id.
export async function quoteForSku(
  quoteSkuId: string,
): Promise<{ quote: Quote; sku: Sku }> {
  const rows = await db
    .select({ quote: quotes, sku: quoteSkus })
    .from(quoteSkus)
    .innerJoin(quotes, eq(quotes.id, quoteSkus.quoteId))
    .where(eq(quoteSkus.id, quoteSkuId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "SKU not found");
  const { quote, sku } = rows[0];
  requireDraft(quote);
  return { quote, sku };
}

// quoteForSku + leaf-only check. Used by per-SKU cost-input domains
// (packaging, production). Slice R6.2 retires the freight per-SKU
// binding (Gap 22: freight is per-quote, not per-SKU) — the third
// caller pre-R6.2 was freight; post-R6.2 it's not.
export async function quoteForLeafSku(
  quoteSkuId: string,
  inputDomain: "packaging" | "production",
): Promise<{ quote: Quote; sku: Sku }> {
  const result = await quoteForSku(quoteSkuId);
  if (result.sku.skuRole !== "leaf") {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `${inputDomain[0].toUpperCase()}${inputDomain.slice(1)} inputs only apply to leaf SKUs.`,
    );
  }
  return result;
}

// Resolve quote ownership through a packaging line_group_id. Pre-R6.2
// this was overloaded for packaging vs freight; R6.2 narrows it to
// packaging only (freight uses leg / leg-group guards below).
export async function quoteForLineGroup(
  lineGroupId: string,
  _table: LineGroupTable = "packaging_inputs",
): Promise<{ quote: Quote; sku: Sku; lineGroupId: string }> {
  const rows = await db
    .select({
      quote: quotes,
      sku: quoteSkus,
      lineGroupId: packagingInputs.lineGroupId,
    })
    .from(packagingInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, packagingInputs.quoteSkuId))
    .innerJoin(quotes, eq(quotes.id, quoteSkus.quoteId))
    .where(eq(packagingInputs.lineGroupId, lineGroupId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Packaging line not found");
  const { quote, sku } = rows[0];
  requireDraft(quote);
  return { quote, sku, lineGroupId };
}

// ---------- Slice 11.5 NEW-model guards ----------
//
// Sister helpers to the OLD-model `quoteForSku` / `quoteForLeafSku` /
// `quoteForLineGroup`. NEW-model write actions resolve quote ownership
// through assemblies + assembly_leaves instead of quote_skus.
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
