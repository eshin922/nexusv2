import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  freightInputs,
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

export type LineGroupTable = "packaging_inputs" | "freight_inputs";

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

// quoteForSku + leaf-only check. Used by production (Slice 6) and freight
// (Slice 7) — both apply only to leaf SKUs; assemblies render as read-only
// banners. The action layer enforces server-side; the UI hides controls
// proactively (defense in depth).
export async function quoteForLeafSku(
  quoteSkuId: string,
  inputDomain: "production" | "freight",
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

// Resolve quote ownership through a line_group_id. The line group lives in
// either packaging_inputs or freight_inputs; caller specifies which via
// `table` discriminator.
export async function quoteForLineGroup(
  lineGroupId: string,
  table: LineGroupTable,
): Promise<{ quote: Quote; sku: Sku; lineGroupId: string }> {
  if (table === "packaging_inputs") {
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
  // freight_inputs
  const rows = await db
    .select({
      quote: quotes,
      sku: quoteSkus,
      lineGroupId: freightInputs.lineGroupId,
    })
    .from(freightInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, freightInputs.quoteSkuId))
    .innerJoin(quotes, eq(quotes.id, quoteSkus.quoteId))
    .where(eq(freightInputs.lineGroupId, lineGroupId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Freight line not found");
  const { quote, sku } = rows[0];
  requireDraft(quote);
  return { quote, sku, lineGroupId };
}
