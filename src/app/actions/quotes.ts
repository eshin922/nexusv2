"use server";

import { and, asc, eq, max } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  auditLog,
  freightInputs,
  packagingInputs,
  productionInputs,
  quotes,
  quoteSkus,
  quoteTiers,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  getProduct,
  HubspotError,
  searchProducts,
  type ProductSummary,
} from "@/lib/hubspot";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  ActionGuardError,
  ERR,
  quoteNotDraftMessage,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  snapshotSkuSubtree,
  validateAssemblyOperation,
  type SkuRoleValue,
} from "@/lib/sku-tree";

// DB query inlined here (used to live in sku-tree.ts but that module
// must stay client-safe since SkuRow imports its pure helpers).
async function loadAllSkusForQuote(quoteId: string) {
  return db.select().from(quoteSkus).where(eq(quoteSkus.quoteId, quoteId));
}
import { packagingInputs as packagingInputsTable } from "@/db/schema";
import { inArray } from "drizzle-orm";

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
  if (rows.length === 0)
    throw new ActionGuardError(ERR.QUOTE_NOT_FOUND, "Quote not found");
  return rows[0];
}

function assertDraft(quote: { status: string }) {
  if (quote.status !== "draft") {
    throw new ActionGuardError(ERR.QUOTE_NOT_DRAFT, quoteNotDraftMessage(quote.status));
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

export type QuoteNotesSnapshot = {
  quoteId: string;
  internalNotes: string | null;
  customerFacingNotes: string | null;
};

export async function updateQuoteNotes(
  formData: FormData,
): Promise<ActionResult<QuoteNotesSnapshot>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

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
    if (Object.keys(diff).length === 0) {
      return {
        quoteId,
        internalNotes: quote.internalNotes,
        customerFacingNotes: quote.customerFacingNotes,
      };
    }

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

    revalidateQuoteTree(quote.projectId, quoteId);

    return { quoteId, internalNotes: internal, customerFacingNotes: customer };
  });
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
export async function addSkuFromHubspotProduct(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const productId = String(formData.get("productId") ?? "").trim();
    if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    if (!productId) throw new ActionGuardError(ERR.VALIDATION, "productId required");

    // Optional assembly fields (Slice 5.5).
    const skuRoleRaw = String(formData.get("skuRole") ?? "leaf") as SkuRoleValue;
    const parentSkuIdRaw = trimOrNull(formData.get("parentSkuId"));
    const qtyPerParentRaw = trimOrNull(formData.get("qtyPerParent"));
    if (!["leaf", "assembly"].includes(skuRoleRaw))
      throw new ActionGuardError(ERR.VALIDATION, `Invalid sku_role: ${skuRoleRaw}`);

    const user = await ensureUser();
    const quote = await loadQuoteOrThrow(quoteId);
    assertDraft(quote);

    const product = await getProduct(productId);
    if (!product)
      throw new ActionGuardError(
        ERR.HUBSPOT,
        `HubSpot product ${productId} not found`,
      );

    // Validate assembly assignment (parent must exist, same quote, can have
    // children; cycle check is moot here since the new SKU has no descendants).
    if (parentSkuIdRaw) {
      const allSkus = await loadAllSkusForQuote(quoteId);
      const validation = validateAssemblyOperation({
        skuId: null,
        newParentId: parentSkuIdRaw,
        newQtyPerParent: qtyPerParentRaw,
        newRole: skuRoleRaw,
        quoteId,
        allSkus,
      });
      if (!validation.ok)
        throw new ActionGuardError(validation.code, validation.message);
    }

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
        skuRole: skuRoleRaw,
        parentSkuId: parentSkuIdRaw,
        qtyPerParent: qtyPerParentRaw,
      })
      .returning({ id: quoteSkus.id });

    // Slice 6: leaf SKUs get one production_inputs row per existing tier.
    // Assemblies don't have production rows — costs roll up from leaves.
    if (skuRoleRaw === "leaf") {
      await seedProductionInputsForNewLeaf({ quoteId, skuId: sku.id });
    }

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
        sku_role: skuRoleRaw,
        parent_sku_id: parentSkuIdRaw,
        qty_per_parent: qtyPerParentRaw,
      },
    });

    revalidateQuoteTree(quote.projectId, quoteId);
  });
}

// Insert one production_inputs row per existing tier for a newly-created
// (or assembly-promoted-to-) leaf SKU. Default policy values; ON CONFLICT
// DO NOTHING so a re-promotion preserves any prior data on tiers that
// already had rows.
async function seedProductionInputsForNewLeaf(args: {
  quoteId: string;
  skuId: string;
}): Promise<void> {
  const tiers = await db
    .select({ id: quoteTiers.id })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, args.quoteId));
  if (tiers.length === 0) return;
  await db
    .insert(productionInputs)
    .values(
      tiers.map((t) => ({
        quoteSkuId: args.skuId,
        tierId: t.id,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Create a Nexus-local assembly SKU — no HubSpot Product reference.
 * Used when PMs design an assembly before (or instead of) creating it
 * in HubSpot. Leaf SKUs should still go through addSkuFromHubspotProduct.
 */
export async function addAssemblySku(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const skuLabel = String(formData.get("skuLabel") ?? "").trim();
    const productName = String(formData.get("productName") ?? "").trim();
    const parentSkuIdRaw = trimOrNull(formData.get("parentSkuId"));
    const qtyPerParentRaw = trimOrNull(formData.get("qtyPerParent"));

    if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    if (!skuLabel) throw new ActionGuardError(ERR.VALIDATION, "skuLabel required");
    if (!productName) throw new ActionGuardError(ERR.VALIDATION, "productName required");

    const user = await ensureUser();
    const quote = await loadQuoteOrThrow(quoteId);
    assertDraft(quote);

    if (parentSkuIdRaw) {
      const allSkus = await loadAllSkusForQuote(quoteId);
      const validation = validateAssemblyOperation({
        skuId: null,
        newParentId: parentSkuIdRaw,
        newQtyPerParent: qtyPerParentRaw,
        newRole: "assembly",
        quoteId,
        allSkus,
      });
      if (!validation.ok)
        throw new ActionGuardError(validation.code, validation.message);
    }

    const maxRow = await db
      .select({ max: max(quoteSkus.sortOrder) })
      .from(quoteSkus)
      .where(eq(quoteSkus.quoteId, quoteId));
    const sortOrder = (maxRow[0]?.max ?? -1) + 1;

    const [sku] = await db
      .insert(quoteSkus)
      .values({
        quoteId,
        hubspotProductId: null,
        skuLabel,
        productName,
        unitsPerPack: 1,
        sortOrder,
        skuRole: "assembly",
        parentSkuId: parentSkuIdRaw,
        qtyPerParent: qtyPerParentRaw,
      })
      .returning({ id: quoteSkus.id });

    await logAudit({
      userId: user.id,
      entityType: "quote_sku",
      entityId: sku.id,
      action: "created",
      diffJson: {
        quote_id: quoteId,
        hubspot_product_id: null,
        sku_label: skuLabel,
        product_name: productName,
        sku_role: "assembly",
        parent_sku_id: parentSkuIdRaw,
        qty_per_parent: qtyPerParentRaw,
      },
    });

    revalidateQuoteTree(quote.projectId, quoteId);
  });
}

/**
 * Set parent_sku_id and qty_per_parent on an existing SKU.
 * Validates: parent in same quote, can have children, no cycle, qty>0.
 */
/**
 * Update qty_per_parent on a SKU that already has a parent. Refuses if
 * SKU has no parent. Standalone (doesn't change the parent_sku_id link).
 */
export async function updateQtyPerParent(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const skuId = String(formData.get("skuId") ?? "").trim();
    const qtyRaw = String(formData.get("qty") ?? "").trim();
    if (!skuId) throw new ActionGuardError(ERR.VALIDATION, "skuId required");
    if (!qtyRaw || Number(qtyRaw) <= 0)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "qty must be greater than zero.",
      );

    const user = await ensureUser();
    const skuRows = await db
      .select()
      .from(quoteSkus)
      .where(eq(quoteSkus.id, skuId))
      .limit(1);
    if (skuRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "SKU not found");
    const sku = skuRows[0];

    if (!sku.parentSkuId)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "qty_per_parent only applies when the SKU has a parent.",
      );

    const quote = await loadQuoteOrThrow(sku.quoteId);
    assertDraft(quote);

    // Numeric equality to avoid spurious "0.5" vs "0.5000" diffs
    if (sku.qtyPerParent !== null && Number(sku.qtyPerParent) === Number(qtyRaw))
      return;

    await db
      .update(quoteSkus)
      .set({ qtyPerParent: qtyRaw, updatedAt: new Date() })
      .where(eq(quoteSkus.id, skuId));

    await logAudit({
      userId: user.id,
      entityType: "quote_sku",
      entityId: skuId,
      action: "qty_per_parent_updated",
      diffJson: { qty_per_parent: { from: sku.qtyPerParent, to: qtyRaw } },
    });

    revalidateQuoteTree(quote.projectId, sku.quoteId);
  });
}

export async function assignSkuToParent(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const skuId = String(formData.get("skuId") ?? "").trim();
    const parentSkuId = String(formData.get("parentSkuId") ?? "").trim();
    const qtyRaw = String(formData.get("qtyPerParent") ?? "").trim();
    if (!skuId) throw new ActionGuardError(ERR.VALIDATION, "skuId required");
    if (!parentSkuId)
      throw new ActionGuardError(ERR.VALIDATION, "parentSkuId required");
    if (!qtyRaw)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "qtyPerParent required when assigning a parent.",
      );

    const user = await ensureUser();
    const skuRows = await db
      .select()
      .from(quoteSkus)
      .where(eq(quoteSkus.id, skuId))
      .limit(1);
    if (skuRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "SKU not found");
    const sku = skuRows[0];

    const quote = await loadQuoteOrThrow(sku.quoteId);
    assertDraft(quote);

    const allSkus = await loadAllSkusForQuote(sku.quoteId);
    const validation = validateAssemblyOperation({
      skuId,
      newParentId: parentSkuId,
      newQtyPerParent: qtyRaw,
      newRole: sku.skuRole as SkuRoleValue,
      quoteId: sku.quoteId,
      allSkus,
    });
    if (!validation.ok)
      throw new ActionGuardError(validation.code, validation.message);

    await db
      .update(quoteSkus)
      .set({
        parentSkuId,
        qtyPerParent: qtyRaw,
        updatedAt: new Date(),
      })
      .where(eq(quoteSkus.id, skuId));

    await logAudit({
      userId: user.id,
      entityType: "quote_sku",
      entityId: skuId,
      action: "assigned_to_parent",
      diffJson: {
        parent_sku_id: { from: sku.parentSkuId, to: parentSkuId },
        qty_per_parent: { from: sku.qtyPerParent, to: qtyRaw },
      },
    });

    revalidateQuoteTree(quote.projectId, sku.quoteId);
  });
}

export async function unassignSkuFromParent(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const skuId = String(formData.get("skuId") ?? "").trim();
    if (!skuId) throw new ActionGuardError(ERR.VALIDATION, "skuId required");

    const user = await ensureUser();
    const skuRows = await db
      .select()
      .from(quoteSkus)
      .where(eq(quoteSkus.id, skuId))
      .limit(1);
    if (skuRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "SKU not found");
    const sku = skuRows[0];

    if (!sku.parentSkuId) return; // already detached

    const quote = await loadQuoteOrThrow(sku.quoteId);
    assertDraft(quote);

    await db
      .update(quoteSkus)
      .set({
        parentSkuId: null,
        qtyPerParent: null,
        updatedAt: new Date(),
      })
      .where(eq(quoteSkus.id, skuId));

    await logAudit({
      userId: user.id,
      entityType: "quote_sku",
      entityId: skuId,
      action: "unassigned_from_parent",
      diffJson: {
        parent_sku_id: { from: sku.parentSkuId, to: null },
        qty_per_parent: { from: sku.qtyPerParent, to: null },
      },
    });

    revalidateQuoteTree(quote.projectId, sku.quoteId);
  });
}

/**
 * Change a SKU's role between leaf and assembly. Demoting assembly →
 * leaf is refused if the SKU has children — PM must detach or delete
 * them explicitly first. No auto-detach.
 */
export async function convertSkuRole(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const skuId = String(formData.get("skuId") ?? "").trim();
    const newRoleRaw = String(formData.get("newRole") ?? "") as SkuRoleValue;
    if (!skuId) throw new ActionGuardError(ERR.VALIDATION, "skuId required");
    if (!["leaf", "assembly"].includes(newRoleRaw))
      throw new ActionGuardError(ERR.VALIDATION, `Invalid newRole: ${newRoleRaw}`);

    const user = await ensureUser();
    const skuRows = await db
      .select()
      .from(quoteSkus)
      .where(eq(quoteSkus.id, skuId))
      .limit(1);
    if (skuRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "SKU not found");
    const sku = skuRows[0];

    if (sku.skuRole === newRoleRaw) return; // no-op

    const quote = await loadQuoteOrThrow(sku.quoteId);
    assertDraft(quote);

    const allSkus = await loadAllSkusForQuote(sku.quoteId);
    const validation = validateAssemblyOperation({
      skuId,
      newParentId: sku.parentSkuId,
      newQtyPerParent: sku.qtyPerParent,
      newRole: newRoleRaw,
      quoteId: sku.quoteId,
      allSkus,
    });
    if (!validation.ok)
      throw new ActionGuardError(validation.code, validation.message);

    await db
      .update(quoteSkus)
      .set({ skuRole: newRoleRaw, updatedAt: new Date() })
      .where(eq(quoteSkus.id, skuId));

    // Slice 6: assembly → leaf needs production_inputs rows for every tier.
    // ON CONFLICT DO NOTHING — if the SKU was previously a leaf, its rows
    // were preserved (leaf → assembly doesn't delete) so this only fills
    // in tiers added while the SKU was an assembly.
    if (sku.skuRole === "assembly" && newRoleRaw === "leaf") {
      await seedProductionInputsForNewLeaf({
        quoteId: sku.quoteId,
        skuId,
      });
    }

    await logAudit({
      userId: user.id,
      entityType: "quote_sku",
      entityId: skuId,
      action: "role_converted",
      diffJson: {
        sku_role: { from: sku.skuRole, to: newRoleRaw },
      },
    });

    revalidateQuoteTree(quote.projectId, sku.quoteId);
  });
}

/**
 * Re-pull HubSpot Product data and overwrite ONLY the fields whose
 * field_source_json[field] === "hubspot". Nexus-local fields stay intact.
 * Audit records the diff of what changed.
 */
export async function refreshSkuFromHubspot(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
  const skuId = String(formData.get("skuId") ?? "").trim();
  if (!skuId) throw new ActionGuardError(ERR.VALIDATION, "skuId required");

  const user = await ensureUser();
  const skuRows = await db
    .select()
    .from(quoteSkus)
    .where(eq(quoteSkus.id, skuId))
    .limit(1);
  if (skuRows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "SKU not found");
  const sku = skuRows[0];

  const quote = await loadQuoteOrThrow(sku.quoteId);
  assertDraft(quote);

  // Nexus-local SKUs (assemblies without a HubSpot reference)
  // can't be refreshed — there's no source to refresh from.
  if (!sku.hubspotProductId) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "This SKU isn't anchored to a HubSpot product, so there's nothing to refresh.",
    );
  }

  const product = await getProduct(sku.hubspotProductId);
  if (!product)
    throw new ActionGuardError(
      ERR.HUBSPOT,
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

  revalidateQuoteTree(quote.projectId, sku.quoteId);
  });
}

/**
 * Update Nexus-local fields on a SKU. HubSpot-sourced fields (sku_label,
 * product_name) are read-only here — the only way to change them is in
 * HubSpot and then click Refresh on the row.
 *
 * Editable fields: units_per_pack (required), retail_benchmark (optional),
 * notes (optional).
 */
export type SkuEditableSnapshot = {
  skuId: string;
  unitsPerPack: number;
  retailBenchmark: string | null;
  notes: string | null;
};

export async function updateSku(
  formData: FormData,
): Promise<ActionResult<SkuEditableSnapshot>> {
  return runAction(async () => {
  const skuId = String(formData.get("skuId") ?? "").trim();
  if (!skuId) throw new ActionGuardError(ERR.VALIDATION, "skuId required");

  const user = await ensureUser();
  const skuRows = await db
    .select()
    .from(quoteSkus)
    .where(eq(quoteSkus.id, skuId))
    .limit(1);
  if (skuRows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "SKU not found");
  const sku = skuRows[0];

  const quote = await loadQuoteOrThrow(sku.quoteId);
  assertDraft(quote);

  // Defensive: refuse to write to HubSpot-sourced fields even if the form
  // somehow includes them. (UI doesn't, but belt-and-suspenders.)
  for (const f of ["skuLabel", "productName"] as const) {
    if (formData.has(f)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
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
  if (Object.keys(diff).length === 0) {
    return {
      skuId,
      unitsPerPack: sku.unitsPerPack,
      retailBenchmark: sku.retailBenchmark,
      notes: sku.notes,
    };
  }

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

  revalidateQuoteTree(quote.projectId, sku.quoteId);

  return {
    skuId,
    unitsPerPack: newUnitsPerPack,
    retailBenchmark: newRetailBenchmark,
    notes: newNotes,
  };
  });
}

export async function deleteSku(formData: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const skuId = String(formData.get("skuId") ?? "").trim();
    if (!skuId) throw new ActionGuardError(ERR.VALIDATION, "skuId required");

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

    // Cascade-aware audit: snapshot the SKU's full subtree BEFORE the
    // FK CASCADE wipes it. Single audit row captures the entire blast
    // radius so PMs can reconstruct accidental cascades.
    const allSkus = await loadAllSkusForQuote(sku.quoteId);
    const { root, descendants } = snapshotSkuSubtree(skuId, allSkus);

    // Count packaging_inputs and production_inputs that will cascade (both
    // FK on quote_sku_id). Includes the deleted sku + every descendant.
    const allDeletedSkuIds = [skuId, ...descendants.map((d) => d.id)];
    const pkgRows = await db
      .select({ id: packagingInputsTable.id })
      .from(packagingInputsTable)
      .where(inArray(packagingInputsTable.quoteSkuId, allDeletedSkuIds));
    const cascadedPackagingCount = pkgRows.length;
    const prodRows = await db
      .select({ id: productionInputs.id })
      .from(productionInputs)
      .where(inArray(productionInputs.quoteSkuId, allDeletedSkuIds));
    const cascadedProductionCount = prodRows.length;
    const frtRows = await db
      .select({ id: freightInputs.id })
      .from(freightInputs)
      .where(inArray(freightInputs.quoteSkuId, allDeletedSkuIds));
    const cascadedFreightCount = frtRows.length;

    await db.delete(quoteSkus).where(eq(quoteSkus.id, skuId));

    await logAudit({
      userId: user.id,
      entityType: "quote_sku",
      entityId: skuId,
      action: "deleted",
      diffJson: {
        deleted_sku: root,
        cascaded_descendants: descendants,
        cascaded_descendant_count: descendants.length,
        cascaded_packaging_inputs_count: cascadedPackagingCount,
        cascaded_production_inputs_count: cascadedProductionCount,
        cascaded_freight_inputs_count: cascadedFreightCount,
      },
    });

    revalidateQuoteTree(quote.projectId, sku.quoteId);
  });
}

export async function moveSku(formData: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
  const skuId = String(formData.get("skuId") ?? "").trim();
  const direction = String(formData.get("direction") ?? "") as "up" | "down";
  if (!skuId) throw new ActionGuardError(ERR.VALIDATION, "skuId required");
  if (direction !== "up" && direction !== "down")
    throw new ActionGuardError(ERR.VALIDATION, "direction must be up or down");

  const user = await ensureUser();
  const skuRows = await db
    .select()
    .from(quoteSkus)
    .where(eq(quoteSkus.id, skuId))
    .limit(1);
  if (skuRows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "SKU not found");
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

  revalidateQuoteTree(quote.projectId, sku.quoteId);
  });
}

// ---------- tier actions ----------

export async function addTier(formData: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

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

  // Auto-create empty packaging_inputs rows for this new tier across every
  // existing line group (one row per line × the new tier). This keeps the
  // (line × tier) grid contiguous so the UI doesn't have to render holes.
  // We dedupe by line_group_id at the action layer (no SQL DISTINCT needed
  // for correctness — the unique constraint on (sku, line_group, tier)
  // would catch any accidental dupes).
  const existingLines = await db
    .select({
      lineGroupId: packagingInputs.lineGroupId,
      quoteSkuId: packagingInputs.quoteSkuId,
      sortOrder: packagingInputs.sortOrder,
      supplier: packagingInputs.supplier,
      qtyPerSellableUnit: packagingInputs.qtyPerSellableUnit,
      category: packagingInputs.category,
      markupPct: packagingInputs.markupPct,
      markupPctSource: packagingInputs.markupPctSource,
      inventoryEligible: packagingInputs.inventoryEligible,
      notes: packagingInputs.notes,
    })
    .from(packagingInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, packagingInputs.quoteSkuId))
    .where(eq(quoteSkus.quoteId, quoteId));

  const seen = new Set<string>();
  const newRows: typeof packagingInputs.$inferInsert[] = [];
  for (const l of existingLines) {
    if (seen.has(l.lineGroupId)) continue;
    seen.add(l.lineGroupId);
    newRows.push({
      quoteSkuId: l.quoteSkuId,
      tierId: tier.id,
      lineGroupId: l.lineGroupId,
      sortOrder: l.sortOrder,
      supplier: l.supplier,
      qtyPerSellableUnit: l.qtyPerSellableUnit,
      category: l.category,
      markupPct: l.markupPct,
      markupPctSource: l.markupPctSource,
      inventoryEligible: l.inventoryEligible,
      notes: l.notes,
      // unit_cost and purchase_qty start null on the new tier — PM fills in.
    });
  }
  if (newRows.length > 0) {
    await db.insert(packagingInputs).values(newRows);
  }

  // Slice 6: production_inputs rows are auto-created per (leaf SKU × tier).
  // Walk every leaf SKU in the quote, inherit policy from any existing
  // production row of that SKU (so the new tier gets the SKU's current
  // customer_ships_raws / allocate_service_fees_to_cost / notes), and
  // insert one row per leaf at the new tier.
  const leafSkus = await db
    .select({ id: quoteSkus.id })
    .from(quoteSkus)
    .where(and(eq(quoteSkus.quoteId, quoteId), eq(quoteSkus.skuRole, "leaf")));
  let productionRowsSeeded = 0;
  if (leafSkus.length > 0) {
    const leafIds = leafSkus.map((s) => s.id);
    const existingPolicy = await db
      .selectDistinctOn([productionInputs.quoteSkuId], {
        quoteSkuId: productionInputs.quoteSkuId,
        customerShipsRaws: productionInputs.customerShipsRaws,
        allocateServiceFeesToCost: productionInputs.allocateServiceFeesToCost,
        notes: productionInputs.notes,
      })
      .from(productionInputs)
      .where(inArray(productionInputs.quoteSkuId, leafIds));
    const policyByLeaf = new Map(
      existingPolicy.map((p) => [p.quoteSkuId, p]),
    );
    const newProdRows: (typeof productionInputs.$inferInsert)[] = leafSkus.map(
      (s) => {
        const p = policyByLeaf.get(s.id);
        return {
          quoteSkuId: s.id,
          tierId: tier.id,
          customerShipsRaws: p?.customerShipsRaws ?? false,
          allocateServiceFeesToCost: p?.allocateServiceFeesToCost ?? true,
          notes: p?.notes ?? null,
          // per-tier costs intentionally null — PM fills in.
        };
      },
    );
    await db.insert(productionInputs).values(newProdRows);
    productionRowsSeeded = newProdRows.length;
  }

  // Slice 7: freight_inputs rows for every existing line_group_id × the
  // new tier. Per-line metadata cloned from any existing tier row (any row
  // of the line carries the line metadata, denormalized).
  const existingFreightLines = await db
    .selectDistinctOn([freightInputs.lineGroupId], {
      lineGroupId: freightInputs.lineGroupId,
      quoteSkuId: freightInputs.quoteSkuId,
      sortOrder: freightInputs.sortOrder,
      shipmentId: freightInputs.shipmentId,
      supplier: freightInputs.supplier,
      freightMode: freightInputs.freightMode,
      freightTreatment: freightInputs.freightTreatment,
      markupPct: freightInputs.markupPct,
      notes: freightInputs.notes,
    })
    .from(freightInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, freightInputs.quoteSkuId))
    .where(eq(quoteSkus.quoteId, quoteId));
  let freightRowsSeeded = 0;
  if (existingFreightLines.length > 0) {
    await db.insert(freightInputs).values(
      existingFreightLines.map((l) => ({
        quoteSkuId: l.quoteSkuId,
        tierId: tier.id,
        lineGroupId: l.lineGroupId,
        sortOrder: l.sortOrder,
        shipmentId: l.shipmentId,
        supplier: l.supplier,
        freightMode: l.freightMode,
        freightTreatment: l.freightTreatment,
        markupPct: l.markupPct,
        notes: l.notes,
        // total_freight, units_in_shipment intentionally null — PM fills in.
      })),
    );
    freightRowsSeeded = existingFreightLines.length;
  }

  await logAudit({
    userId: user.id,
    entityType: "quote_tier",
    entityId: tier.id,
    action: "created",
    diffJson: {
      quote_id: quoteId,
      sort_order: sortOrder,
      packaging_rows_seeded: newRows.length,
      production_rows_seeded: productionRowsSeeded,
      freight_rows_seeded: freightRowsSeeded,
    },
  });

  revalidateQuoteTree(quote.projectId, quoteId);
  });
}

export type TierEditableSnapshot = {
  tierId: string;
  label: string;
  qty: number | null;
};

export async function updateTier(
  formData: FormData,
): Promise<ActionResult<TierEditableSnapshot>> {
  return runAction(async () => {
  const tierId = String(formData.get("tierId") ?? "").trim();
  if (!tierId) throw new ActionGuardError(ERR.VALIDATION, "tierId required");

  const user = await ensureUser();
  const tierRows = await db
    .select()
    .from(quoteTiers)
    .where(eq(quoteTiers.id, tierId))
    .limit(1);
  if (tierRows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found");
  const tier = tierRows[0];

  const quote = await loadQuoteOrThrow(tier.quoteId);
  assertDraft(quote);

  const newLabel = String(formData.get("label") ?? "").trim() || tier.label;
  const newQty = parseIntOrNull(formData.get("qty"));

  const before = { label: tier.label, qty: tier.qty };
  const after = { label: newLabel, qty: newQty };
  const diff = diffOf(before, after);
  if (Object.keys(diff).length === 0) {
    return { tierId, label: tier.label, qty: tier.qty };
  }

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

  revalidateQuoteTree(quote.projectId, tier.quoteId);

  return { tierId, label: newLabel, qty: newQty };
  });
}

export async function deleteTier(formData: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
  const tierId = String(formData.get("tierId") ?? "").trim();
  if (!tierId) throw new ActionGuardError(ERR.VALIDATION, "tierId required");

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

  revalidateQuoteTree(quote.projectId, tier.quoteId);
  });
}

export async function moveTier(formData: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
  const tierId = String(formData.get("tierId") ?? "").trim();
  const direction = String(formData.get("direction") ?? "") as "up" | "down";
  if (!tierId) throw new ActionGuardError(ERR.VALIDATION, "tierId required");
  if (direction !== "up" && direction !== "down")
    throw new ActionGuardError(ERR.VALIDATION, "direction must be up or down");

  const user = await ensureUser();
  const tierRows = await db
    .select()
    .from(quoteTiers)
    .where(eq(quoteTiers.id, tierId))
    .limit(1);
  if (tierRows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found");
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

  revalidateQuoteTree(quote.projectId, tier.quoteId);
  });
}

export async function applyTierPreset(formData: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  const presetKey = String(formData.get("preset") ?? "").trim() as TierPresetKey;
  if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
  if (!(presetKey in TIER_PRESETS))
    throw new ActionGuardError(ERR.VALIDATION, `Unknown preset: ${presetKey}`);

  const user = await ensureUser();
  const quote = await loadQuoteOrThrow(quoteId);
  assertDraft(quote);

  const preset = TIER_PRESETS[presetKey];

  const before = await db
    .select({ id: quoteTiers.id, label: quoteTiers.label, qty: quoteTiers.qty })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quoteId))
    .orderBy(asc(quoteTiers.sortOrder));

  // Snapshot existing packaging line metadata BEFORE deleting tiers (the
  // delete cascades through packaging_inputs and would otherwise wipe the
  // line work the PM did — vendor lookups, category decisions, markups).
  // After re-creating tiers, we reseed packaging_inputs with empty
  // unit_cost / purchase_qty for each preserved line × each new tier.
  // Same shape applies to production_inputs (Slice 6); freight_inputs (Slice 7).
  const preservedLines = await db
    .selectDistinctOn([packagingInputs.lineGroupId], {
      lineGroupId: packagingInputs.lineGroupId,
      quoteSkuId: packagingInputs.quoteSkuId,
      sortOrder: packagingInputs.sortOrder,
      supplier: packagingInputs.supplier,
      qtyPerSellableUnit: packagingInputs.qtyPerSellableUnit,
      category: packagingInputs.category,
      markupPct: packagingInputs.markupPct,
      markupPctSource: packagingInputs.markupPctSource,
      inventoryEligible: packagingInputs.inventoryEligible,
      notes: packagingInputs.notes,
    })
    .from(packagingInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, packagingInputs.quoteSkuId))
    .where(eq(quoteSkus.quoteId, quoteId))
    .orderBy(asc(packagingInputs.lineGroupId), asc(packagingInputs.createdAt));

  // Slice 6 — production policy snapshot, keyed by quote_sku_id. One row
  // per leaf SKU; values come from any existing production_inputs row for
  // that SKU (denormalized, so any row carries the policy).
  const preservedProductionPolicy = await db
    .selectDistinctOn([productionInputs.quoteSkuId], {
      quoteSkuId: productionInputs.quoteSkuId,
      customerShipsRaws: productionInputs.customerShipsRaws,
      allocateServiceFeesToCost: productionInputs.allocateServiceFeesToCost,
      notes: productionInputs.notes,
    })
    .from(productionInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, productionInputs.quoteSkuId))
    .where(eq(quoteSkus.quoteId, quoteId));

  // Forensic snapshot — capture every (sku, tier) row with non-null cost
  // data or actual_units_produced before the cascade wipes them. Filter
  // out empty bookkeeping rows (no data lost = no audit value).
  const allProductionRows = await db
    .select()
    .from(productionInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, productionInputs.quoteSkuId))
    .where(eq(quoteSkus.quoteId, quoteId));
  const productionDataLost = allProductionRows
    .map((r) => r.production_inputs)
    .filter(
      (r) =>
        r.actualUnitsProduced !== null ||
        r.fillingBlendingCost !== null ||
        r.cmAssemblyTotal !== null ||
        r.setupFeeTotal !== null ||
        r.toolingArtworkTotal !== null ||
        r.rdTotal !== null ||
        r.otherServiceTotal !== null ||
        r.bulkRawCost !== null,
    )
    .map((r) => ({
      quote_sku_id: r.quoteSkuId,
      tier_id: r.tierId,
      actual_units_produced: r.actualUnitsProduced,
      filling_blending_cost: r.fillingBlendingCost,
      cm_assembly_total: r.cmAssemblyTotal,
      setup_fee_total: r.setupFeeTotal,
      tooling_artwork_total: r.toolingArtworkTotal,
      rd_total: r.rdTotal,
      other_service_total: r.otherServiceTotal,
      bulk_raw_cost: r.bulkRawCost,
    }));

  // Slice 7 — freight line metadata snapshot, keyed by line_group_id.
  const preservedFreightLines = await db
    .selectDistinctOn([freightInputs.lineGroupId], {
      lineGroupId: freightInputs.lineGroupId,
      quoteSkuId: freightInputs.quoteSkuId,
      sortOrder: freightInputs.sortOrder,
      shipmentId: freightInputs.shipmentId,
      supplier: freightInputs.supplier,
      freightMode: freightInputs.freightMode,
      freightTreatment: freightInputs.freightTreatment,
      markupPct: freightInputs.markupPct,
      notes: freightInputs.notes,
    })
    .from(freightInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, freightInputs.quoteSkuId))
    .where(eq(quoteSkus.quoteId, quoteId));

  // Forensic snapshot — capture every (line, tier) row with non-null
  // total_freight or units_in_shipment before cascade wipes them.
  const allFreightRows = await db
    .select()
    .from(freightInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, freightInputs.quoteSkuId))
    .where(eq(quoteSkus.quoteId, quoteId));
  const freightDataLost = allFreightRows
    .map((r) => r.freight_inputs)
    .filter((r) => r.totalFreight !== null || r.unitsInShipment !== null)
    .map((r) => ({
      quote_sku_id: r.quoteSkuId,
      tier_id: r.tierId,
      line_group_id: r.lineGroupId,
      total_freight: r.totalFreight,
      units_in_shipment: r.unitsInShipment,
    }));

  let cellsSeeded = 0;
  let productionCellsSeeded = 0;
  let freightCellsSeeded = 0;
  await db.transaction(async (tx) => {
    // Delete all existing tiers — cascade kills all packaging_inputs rows.
    // (Per-tier cost values are intentionally lost; different volumes
    // mean different costs anyway.)
    await tx.delete(quoteTiers).where(eq(quoteTiers.quoteId, quoteId));

    if (preset.tiers.length === 0) return;

    const newTiers = await tx
      .insert(quoteTiers)
      .values(
        preset.tiers.map((t, i) => ({
          quoteId,
          label: t.label,
          qty: t.qty,
          sortOrder: i,
        })),
      )
      .returning({ id: quoteTiers.id });

    // Reseed packaging_inputs: each preserved line × each new tier.
    if (preservedLines.length > 0) {
      const seedRows: typeof packagingInputs.$inferInsert[] = [];
      for (const line of preservedLines) {
        for (const tier of newTiers) {
          seedRows.push({
            quoteSkuId: line.quoteSkuId,
            tierId: tier.id,
            lineGroupId: line.lineGroupId,
            sortOrder: line.sortOrder,
            supplier: line.supplier,
            qtyPerSellableUnit: line.qtyPerSellableUnit,
            category: line.category,
            markupPct: line.markupPct,
            markupPctSource: line.markupPctSource,
            inventoryEligible: line.inventoryEligible,
            notes: line.notes,
            // unit_cost and purchase_qty intentionally null — costs reset
            // because they depend on the tier volume.
          });
        }
      }
      await tx.insert(packagingInputs).values(seedRows);
      cellsSeeded = seedRows.length;
    }

    // Reseed production_inputs: each leaf SKU's preserved policy × each new
    // tier. Per-tier costs and actual_units_produced intentionally null —
    // already snapshotted into productionDataLost for the audit row.
    if (preservedProductionPolicy.length > 0) {
      const seedRows: (typeof productionInputs.$inferInsert)[] = [];
      for (const policy of preservedProductionPolicy) {
        for (const tier of newTiers) {
          seedRows.push({
            quoteSkuId: policy.quoteSkuId,
            tierId: tier.id,
            customerShipsRaws: policy.customerShipsRaws,
            allocateServiceFeesToCost: policy.allocateServiceFeesToCost,
            notes: policy.notes,
          });
        }
      }
      await tx.insert(productionInputs).values(seedRows);
      productionCellsSeeded = seedRows.length;
    }

    // Reseed freight_inputs: each preserved line × each new tier.
    // Per-tier costs intentionally null.
    if (preservedFreightLines.length > 0) {
      const seedRows: (typeof freightInputs.$inferInsert)[] = [];
      for (const line of preservedFreightLines) {
        for (const tier of newTiers) {
          seedRows.push({
            quoteSkuId: line.quoteSkuId,
            tierId: tier.id,
            lineGroupId: line.lineGroupId,
            sortOrder: line.sortOrder,
            shipmentId: line.shipmentId,
            supplier: line.supplier,
            freightMode: line.freightMode,
            freightTreatment: line.freightTreatment,
            markupPct: line.markupPct,
            notes: line.notes,
          });
        }
      }
      await tx.insert(freightInputs).values(seedRows);
      freightCellsSeeded = seedRows.length;
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
      packaging_lines_preserved: preservedLines.length,
      packaging_cells_seeded: cellsSeeded,
      production_skus_preserved: preservedProductionPolicy.length,
      production_cells_seeded: productionCellsSeeded,
      production_data_lost: productionDataLost,
      freight_lines_preserved: preservedFreightLines.length,
      freight_cells_seeded: freightCellsSeeded,
      freight_data_lost: freightDataLost,
    },
  });

  revalidateQuoteTree(quote.projectId, quoteId);
  });
}
