"use server";

import { and, asc, eq, max } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, quotes, quoteSkus, quoteTiers } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  getProduct,
  HubspotError,
  searchProducts,
  type ProductSummary,
} from "@/lib/hubspot";

// HubSpot-sourced snapshot fields on quote_skus. Refresh from HubSpot
// overwrites only these. Everything else on the row is Nexus-local.
function snapshotFromHubspotProduct(p: ProductSummary): {
  skuLabel: string;
  productName: string;
} {
  return {
    skuLabel: p.sku || p.name,
    productName: p.name,
  };
}

// ---------- tier presets (internal — "use server" disallows non-async exports) ----------

type TierPresetKey =
  | "single_volume"
  | "reorder"
  | "packaging_domestic"
  | "packaging_overseas"
  | "soft_goods"
  | "custom";

const TIER_PRESETS: Record<
  TierPresetKey,
  { label: string; tiers: Array<{ label: string; qty: number | null }> }
> = {
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
      { label: "Tier 1 — 5k", qty: 5000 },
      { label: "Tier 2 — 10k", qty: 10000 },
      { label: "Tier 3 — 25k", qty: 25000 },
      { label: "Tier 4 — 50k", qty: 50000 },
    ],
  },
  packaging_overseas: {
    label: "Packaging — Overseas",
    tiers: [
      { label: "Tier 1 — 25k", qty: 25000 },
      { label: "Tier 2 — 50k", qty: 50000 },
      { label: "Tier 3 — 100k", qty: 100000 },
      { label: "Tier 4 — 250k", qty: 250000 },
    ],
  },
  soft_goods: {
    label: "Soft Goods",
    tiers: [
      { label: "Tier 1 — 1k", qty: 1000 },
      { label: "Tier 2 — 5k", qty: 5000 },
      { label: "Tier 3 — 10k", qty: 10000 },
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
  if (rows.length === 0) throw new Error("Quote not found");
  return rows[0];
}

function assertDraft(quote: { status: string }) {
  if (quote.status !== "draft") {
    throw new Error(
      `Cannot modify a quote in '${quote.status}' status — only drafts are editable`,
    );
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

export async function updateQuoteNotes(formData: FormData) {
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  if (!quoteId) throw new Error("quoteId required");

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
  if (Object.keys(diff).length === 0) return;

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

  revalidatePath(`/projects/${quote.projectId}/quotes/${quoteId}`);
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

/**
 * Add a SKU to a quote, anchored to a HubSpot Product. The HubSpot product
 * is the canonical source for sku_label/product_name/product_category;
 * those snapshot fields are populated here and tagged "hubspot" in
 * field_source_json so the refresh action knows to overwrite them.
 * packaging_category and units_per_pack are Nexus-local (no HubSpot
 * equivalent at DPS today) and start unset; the UI requires the PM to
 * fill them in.
 */
export async function addSkuFromHubspotProduct(formData: FormData) {
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim();
  if (!quoteId) throw new Error("quoteId required");
  if (!productId) throw new Error("productId required");

  const user = await ensureUser();
  const quote = await loadQuoteOrThrow(quoteId);
  assertDraft(quote);

  const product = await getProduct(productId);
  if (!product)
    throw new HubspotError(`HubSpot product ${productId} not found`);

  const snap = snapshotFromHubspotProduct(product);

  const maxRow = await db
    .select({ max: max(quoteSkus.sortOrder) })
    .from(quoteSkus)
    .where(eq(quoteSkus.quoteId, quoteId));
  const sortOrder = (maxRow[0]?.max ?? -1) + 1;

  const [sku] = await db
    .insert(quoteSkus)
    .values({
      quoteId,
      hubspotProductId: productId,
      skuLabel: snap.skuLabel,
      productName: snap.productName,
      unitsPerPack: 1,
      sortOrder,
      lastHubspotRefreshAt: new Date(),
    })
    .returning({ id: quoteSkus.id });

  await logAudit({
    userId: user.id,
    entityType: "quote_sku",
    entityId: sku.id,
    action: "created",
    diffJson: {
      quote_id: quoteId,
      hubspot_product_id: productId,
      sku_label: snap.skuLabel,
      product_name: snap.productName,
    },
  });

  revalidatePath(`/projects/${quote.projectId}/quotes/${quoteId}`);
}

/**
 * Re-pull HubSpot Product data and overwrite ONLY the fields whose
 * field_source_json[field] === "hubspot". Nexus-local fields stay intact.
 * Audit records the diff of what changed.
 */
export async function refreshSkuFromHubspot(formData: FormData) {
  const skuId = String(formData.get("skuId") ?? "").trim();
  if (!skuId) throw new Error("skuId required");

  const user = await ensureUser();
  const skuRows = await db
    .select()
    .from(quoteSkus)
    .where(eq(quoteSkus.id, skuId))
    .limit(1);
  if (skuRows.length === 0) throw new Error("SKU not found");
  const sku = skuRows[0];

  const quote = await loadQuoteOrThrow(sku.quoteId);
  assertDraft(quote);

  const product = await getProduct(sku.hubspotProductId);
  if (!product)
    throw new HubspotError(
      `HubSpot product ${sku.hubspotProductId} no longer exists`,
    );

  const snap = snapshotFromHubspotProduct(product);

  // Both HubSpot-sourced fields are unconditionally refreshed; record only
  // the ones that actually changed in the audit diff.
  const patch: Partial<{ skuLabel: string; productName: string }> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (sku.skuLabel !== snap.skuLabel) {
    patch.skuLabel = snap.skuLabel;
    before.sku_label = sku.skuLabel;
    after.sku_label = snap.skuLabel;
  }
  if (sku.productName !== snap.productName) {
    patch.productName = snap.productName;
    before.product_name = sku.productName;
    after.product_name = snap.productName;
  }

  await db
    .update(quoteSkus)
    .set({ ...patch, lastHubspotRefreshAt: new Date(), updatedAt: new Date() })
    .where(eq(quoteSkus.id, skuId));

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    diff[k] = { from: before[k], to: after[k] };
  }

  await logAudit({
    userId: user.id,
    entityType: "quote_sku",
    entityId: skuId,
    action: "refreshed_from_hubspot",
    diffJson: diff,
  });

  revalidatePath(`/projects/${quote.projectId}/quotes/${sku.quoteId}`);
}

/**
 * Update Nexus-local fields on a SKU. HubSpot-sourced fields (sku_label,
 * product_name) are read-only here — the only way to change them is in
 * HubSpot and then click Refresh on the row.
 *
 * Editable fields: units_per_pack (required), retail_benchmark (optional),
 * notes (optional).
 */
export async function updateSku(formData: FormData) {
  const skuId = String(formData.get("skuId") ?? "").trim();
  if (!skuId) throw new Error("skuId required");

  const user = await ensureUser();
  const skuRows = await db
    .select()
    .from(quoteSkus)
    .where(eq(quoteSkus.id, skuId))
    .limit(1);
  if (skuRows.length === 0) throw new Error("SKU not found");
  const sku = skuRows[0];

  const quote = await loadQuoteOrThrow(sku.quoteId);
  assertDraft(quote);

  // Defensive: refuse to write to HubSpot-sourced fields even if the form
  // somehow includes them. (UI doesn't, but belt-and-suspenders.)
  for (const f of ["skuLabel", "productName"] as const) {
    if (formData.has(f)) {
      throw new Error(
        `Field "${f}" is sourced from HubSpot and cannot be edited directly. Use Refresh from HubSpot.`,
      );
    }
  }

  const before = {
    units_per_pack: sku.unitsPerPack,
    retail_benchmark: sku.retailBenchmark,
    notes: sku.notes,
  };

  const newUnitsPerPack = parseInt0(formData.get("unitsPerPack"), sku.unitsPerPack);
  const newRetailBenchmarkRaw = trimOrNull(formData.get("retailBenchmark"));
  const newRetailBenchmark =
    newRetailBenchmarkRaw && Number.isFinite(Number(newRetailBenchmarkRaw))
      ? newRetailBenchmarkRaw
      : null;
  const newNotes = trimOrNull(formData.get("notes"));

  const after = {
    units_per_pack: newUnitsPerPack,
    retail_benchmark: newRetailBenchmark,
    notes: newNotes,
  };

  const diff = diffOf(before, after);
  if (Object.keys(diff).length === 0) return;

  await db
    .update(quoteSkus)
    .set({
      unitsPerPack: newUnitsPerPack,
      retailBenchmark: newRetailBenchmark,
      notes: newNotes,
      updatedAt: new Date(),
    })
    .where(eq(quoteSkus.id, skuId));

  await logAudit({
    userId: user.id,
    entityType: "quote_sku",
    entityId: skuId,
    action: "updated",
    diffJson: diff,
  });

  revalidatePath(`/projects/${quote.projectId}/quotes/${sku.quoteId}`);
}

export async function deleteSku(formData: FormData) {
  const skuId = String(formData.get("skuId") ?? "").trim();
  if (!skuId) throw new Error("skuId required");

  const user = await ensureUser();
  const skuRows = await db
    .select()
    .from(quoteSkus)
    .where(eq(quoteSkus.id, skuId))
    .limit(1);
  if (skuRows.length === 0) return;
  const sku = skuRows[0];

  const quote = await loadQuoteOrThrow(sku.quoteId);
  assertDraft(quote);

  await db.delete(quoteSkus).where(eq(quoteSkus.id, skuId));

  await logAudit({
    userId: user.id,
    entityType: "quote_sku",
    entityId: skuId,
    action: "deleted",
    diffJson: { sku_label: sku.skuLabel, product_name: sku.productName },
  });

  revalidatePath(`/projects/${quote.projectId}/quotes/${sku.quoteId}`);
}

export async function moveSku(formData: FormData) {
  const skuId = String(formData.get("skuId") ?? "").trim();
  const direction = String(formData.get("direction") ?? "") as "up" | "down";
  if (!skuId) throw new Error("skuId required");
  if (direction !== "up" && direction !== "down")
    throw new Error("direction must be up or down");

  const user = await ensureUser();
  const skuRows = await db
    .select()
    .from(quoteSkus)
    .where(eq(quoteSkus.id, skuId))
    .limit(1);
  if (skuRows.length === 0) throw new Error("SKU not found");
  const sku = skuRows[0];

  const quote = await loadQuoteOrThrow(sku.quoteId);
  assertDraft(quote);

  const siblings = await db
    .select()
    .from(quoteSkus)
    .where(eq(quoteSkus.quoteId, sku.quoteId))
    .orderBy(asc(quoteSkus.sortOrder), asc(quoteSkus.createdAt));

  const idx = siblings.findIndex((s) => s.id === skuId);
  const swapWith = direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
  if (!swapWith) return;

  await db.transaction(async (tx) => {
    await tx
      .update(quoteSkus)
      .set({ sortOrder: swapWith.sortOrder, updatedAt: new Date() })
      .where(eq(quoteSkus.id, sku.id));
    await tx
      .update(quoteSkus)
      .set({ sortOrder: sku.sortOrder, updatedAt: new Date() })
      .where(eq(quoteSkus.id, swapWith.id));
  });

  await logAudit({
    userId: user.id,
    entityType: "quote_sku",
    entityId: skuId,
    action: "reordered",
    diffJson: { sort_order: { from: sku.sortOrder, to: swapWith.sortOrder } },
  });

  revalidatePath(`/projects/${quote.projectId}/quotes/${sku.quoteId}`);
}

// ---------- tier actions ----------

export async function addTier(formData: FormData) {
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  if (!quoteId) throw new Error("quoteId required");

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

  await logAudit({
    userId: user.id,
    entityType: "quote_tier",
    entityId: tier.id,
    action: "created",
    diffJson: { quote_id: quoteId, sort_order: sortOrder },
  });

  revalidatePath(`/projects/${quote.projectId}/quotes/${quoteId}`);
}

export async function updateTier(formData: FormData) {
  const tierId = String(formData.get("tierId") ?? "").trim();
  if (!tierId) throw new Error("tierId required");

  const user = await ensureUser();
  const tierRows = await db
    .select()
    .from(quoteTiers)
    .where(eq(quoteTiers.id, tierId))
    .limit(1);
  if (tierRows.length === 0) throw new Error("Tier not found");
  const tier = tierRows[0];

  const quote = await loadQuoteOrThrow(tier.quoteId);
  assertDraft(quote);

  const newLabel = String(formData.get("label") ?? "").trim() || tier.label;
  const newQty = parseIntOrNull(formData.get("qty"));

  const before = { label: tier.label, qty: tier.qty };
  const after = { label: newLabel, qty: newQty };
  const diff = diffOf(before, after);
  if (Object.keys(diff).length === 0) return;

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

  revalidatePath(`/projects/${quote.projectId}/quotes/${tier.quoteId}`);
}

export async function deleteTier(formData: FormData) {
  const tierId = String(formData.get("tierId") ?? "").trim();
  if (!tierId) throw new Error("tierId required");

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

  revalidatePath(`/projects/${quote.projectId}/quotes/${tier.quoteId}`);
}

export async function moveTier(formData: FormData) {
  const tierId = String(formData.get("tierId") ?? "").trim();
  const direction = String(formData.get("direction") ?? "") as "up" | "down";
  if (!tierId) throw new Error("tierId required");
  if (direction !== "up" && direction !== "down")
    throw new Error("direction must be up or down");

  const user = await ensureUser();
  const tierRows = await db
    .select()
    .from(quoteTiers)
    .where(eq(quoteTiers.id, tierId))
    .limit(1);
  if (tierRows.length === 0) throw new Error("Tier not found");
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

  revalidatePath(`/projects/${quote.projectId}/quotes/${tier.quoteId}`);
}

export async function applyTierPreset(formData: FormData) {
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  const presetKey = String(formData.get("preset") ?? "").trim() as TierPresetKey;
  if (!quoteId) throw new Error("quoteId required");
  if (!(presetKey in TIER_PRESETS)) throw new Error(`Unknown preset: ${presetKey}`);

  const user = await ensureUser();
  const quote = await loadQuoteOrThrow(quoteId);
  assertDraft(quote);

  const preset = TIER_PRESETS[presetKey];

  const before = await db
    .select({ id: quoteTiers.id, label: quoteTiers.label, qty: quoteTiers.qty })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quoteId))
    .orderBy(asc(quoteTiers.sortOrder));

  await db.transaction(async (tx) => {
    // Delete all existing tiers — cascade picks up future input rows in
    // packaging_inputs / freight_inputs / production_inputs (none yet in
    // Slice 4, but the action is forward-compatible).
    await tx.delete(quoteTiers).where(eq(quoteTiers.quoteId, quoteId));

    if (preset.tiers.length > 0) {
      await tx.insert(quoteTiers).values(
        preset.tiers.map((t, i) => ({
          quoteId,
          label: t.label,
          qty: t.qty,
          sortOrder: i,
        })),
      );
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
    },
  });

  revalidatePath(`/projects/${quote.projectId}/quotes/${quoteId}`);
}
