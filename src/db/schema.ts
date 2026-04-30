import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------- enums ----------

export const userRole = pgEnum("user_role", [
  "admin",
  "pm",
  "purchasing",
  "production",
  "accounting",
  "read_only",
]);

export const projectCategory = pgEnum("project_category", [
  "packaging",
  "turnkey",
  "soft_goods",
  "secondary",
  "other",
]);

export const projectStatus = pgEnum("project_status", ["active", "archived"]);

export const quoteStatus = pgEnum("quote_status", [
  "draft",
  "sent",
  "accepted",
  "superseded",
  "lost",
]);

export const scenarioStatus = pgEnum("scenario_status", [
  "active",
  "dropped",
  "accepted",
]);

export const acceptSource = pgEnum("accept_source", [
  "manual_button",
  "hubspot_stage_change",
  "api",
]);

export const markupPctSource = pgEnum("markup_pct_source", [
  "category_default",
  "manual_override",
]);

// Slice 7 — freight ops vocabulary.
export const freightMode = pgEnum("freight_mode", [
  "parcel",
  "ltl",
  "ftl",
  "ocean",
  "air",
  "courier",
  "other",
]);
export const freightTreatment = pgEnum("freight_treatment", [
  "bundled",
  "pass_through",
]);

// Slice 5.5 — assembly support. A SKU is one of:
//   - leaf: terminal SKU (no children); the typical orderable item.
//   - assembly: a SKU that holds child SKUs (kit, BOM, formulation
//     composed of raw_material children, etc.). Whether the assembly
//     represents a "formulation" is captured by cost_category (from
//     HubSpot's hs_product_type), NOT by sku_role. A premade-bought
//     formulation is a leaf with cost_category='Formulation'; a
//     DPS-formulated assembly is sku_role='assembly' with
//     cost_category='Formulation' and raw_material children.
// Only assembly can have children. Validation lives in
// src/lib/sku-tree.ts and the action layer.
export const skuRole = pgEnum("sku_role", ["leaf", "assembly"]);

// ---------- identity ----------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    email: text("email").notNull().unique(),
    name: text("name"),
    role: userRole("role").notNull().default("read_only"),
    hubspotOwnerId: text("hubspot_owner_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_hubspot_owner_id_idx").on(t.hubspotOwnerId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hubspotDealId: text("hubspot_deal_id").notNull(),
    // HubSpot owner ID at import time. Lets ensureUser back-fill sales_rep_user_id
    // for new users without re-querying HubSpot per project.
    hubspotOwnerId: text("hubspot_owner_id"),
    dealName: text("deal_name").notNull(),
    clientName: text("client_name"),
    salesRepUserId: uuid("sales_rep_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    pmUserId: uuid("pm_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    projectCategory: projectCategory("project_category").notNull().default("packaging"),
    status: projectStatus("status").notNull().default("active"),
    // Snapshot of HubSpot deal stage; refreshed via the Refresh button.
    // Stored to avoid hitting HubSpot on every page render (rate-limit hygiene
    // and Slice 13 portfolio list performance).
    dealStage: text("deal_stage"),
    lastHubspotRefreshAt: timestamp("last_hubspot_refresh_at", {
      withTimezone: true,
    }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    importedByUserId: uuid("imported_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_hubspot_deal_id_idx").on(t.hubspotDealId),
    index("projects_hubspot_owner_id_idx").on(t.hubspotOwnerId),
    index("projects_status_idx").on(t.status),
  ],
);

// ---------- quotes ----------

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scenarioLabel: text("scenario_label").notNull().default("Primary"),
    scenarioStatus: scenarioStatus("scenario_status").notNull().default("active"),
    versionNumber: integer("version_number").notNull(),
    status: quoteStatus("status").notNull().default("draft"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Lazy reference to quote_tiers (declared below). Drizzle resolves the
    // lambda after both tables are defined; the migration emits an ALTER
    // TABLE that adds the FK after both CREATE TABLEs. AnyPgColumn breaks
    // the TS circular-type-inference cycle.
    acceptedTierId: uuid("accepted_tier_id").references(
      (): AnyPgColumn => quoteTiers.id,
      { onDelete: "set null" },
    ),
    acceptSource: acceptSource("accept_source"),
    pdfUrl: text("pdf_url"),
    hubspotQuoteId: text("hubspot_quote_id"),
    globalPriceAdjPct: numeric("global_price_adj_pct", { precision: 5, scale: 4 })
      .notNull()
      .default("0"),
    // Self-FK; declared via foreignKey() below.
    copiedFromQuoteId: uuid("copied_from_quote_id"),
    customerFacingNotes: text("customer_facing_notes"),
    internalNotes: text("internal_notes"),
    validUntil: date("valid_until"),
    acceptedSnapshotJson: jsonb("accepted_snapshot_json"),
    underpricedOverrideUserId: uuid("underpriced_override_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    underpricedOverrideReason: text("underpriced_override_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("quotes_project_scenario_version_idx").on(
      t.projectId,
      t.scenarioLabel,
      t.versionNumber,
    ),
    index("quotes_project_id_idx").on(t.projectId),
    index("quotes_status_idx").on(t.status),
    foreignKey({
      columns: [t.copiedFromQuoteId],
      foreignColumns: [t.id],
      name: "quotes_copied_from_fk",
    }).onDelete("set null"),
  ],
);

export const quoteTiers = pgTable(
  "quote_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    qty: integer("qty"), // nullable: "not yet specified" rather than sentinel 0
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quote_tiers_quote_id_idx").on(t.quoteId)],
);

// quote_skus is typically a reference to a HubSpot Product, but
// hubspot_product_id is **nullable** as of Slice 5.5: assembly nodes
// are often Nexus-conceived structures that may not exist in HubSpot.
// Leaf SKUs are still typically HubSpot-anchored. Slice 12's writeback
// must defensively skip any node missing hubspot_product_id (assemblies
// with no HubSpot match don't writeback as line items — only their leaf
// descendants do).
//
// Markup categorization remains out of scope here (Slice 9 redefines).
//
// Assembly fields (Slice 5.5):
//   parent_sku_id  self-FK; nullable (top-level nodes have NULL).
//                  ON DELETE CASCADE — deleting an assembly deletes
//                  its entire subtree.
//   sku_role       leaf / assembly. Default leaf. Whether an assembly
//                  represents a formulation, kit, etc. is captured by
//                  cost_category (Slice 9 / HubSpot hs_product_type),
//                  NOT by sku_role.
//   qty_per_parent how many of this child go into one parent unit
//                  (e.g., 12 droppers per kit). NULL on top-level nodes.
export const quoteSkus = pgTable(
  "quote_skus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    hubspotProductId: text("hubspot_product_id"),
    // Snapshot from HubSpot product: hs_sku → sku_label, name → product_name.
    // For Nexus-local assemblies (no HubSpot ref), PM enters these manually.
    skuLabel: text("sku_label").notNull(),
    productName: text("product_name").notNull(),
    // Nexus-local: PM-edited.
    unitsPerPack: integer("units_per_pack").notNull().default(1),
    retailBenchmark: numeric("retail_benchmark", { precision: 10, scale: 4 }),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    lastHubspotRefreshAt: timestamp("last_hubspot_refresh_at", {
      withTimezone: true,
    }),
    // Assembly support (Slice 5.5)
    parentSkuId: uuid("parent_sku_id").references(
      (): AnyPgColumn => quoteSkus.id,
      { onDelete: "cascade" },
    ),
    skuRole: skuRole("sku_role").notNull().default("leaf"),
    qtyPerParent: numeric("qty_per_parent", { precision: 10, scale: 4 }),
    // Customs / landed-cost data (Slice 6.5).
    //
    // CUSTOMER-INVISIBLE. These three values are NEVER shown to customers
    // — no PDF, no quote view, no email. They are inputs to Slice 8's
    // landed-freight rollup:
    //
    //   container_freight_per_unit = (sku.cbm_per_unit / total_shipment_cbm)
    //                                  × line.total_freight / effective_units
    //   duty_per_unit   = sku_factory_cost × sku.duty_pct
    //   tariff_per_unit = sku_factory_cost × sku.tariff_pct
    //
    // sku_factory_cost = packaging_inputs.unit_cost (per-unit) +
    //                    production_inputs amortized service fees +
    //                    production_inputs raw costs
    //                    (respecting allocate_service_fees_to_cost flag)
    //
    // CBM is constant across tiers per SKU — physical product volume
    // doesn't change with order quantity. Stored once, applied across
    // every freight rollup that touches this SKU.
    //
    // Often NULL during early quote drafting; PM populates after
    // confirming with freight forwarder. See docs/CLAUDE.md
    // "Customs / landed-cost data" for the full convention and the
    // "Internal — not shown to customer" UI badge requirement.
    cbmPerUnit: numeric("cbm_per_unit", { precision: 10, scale: 4 }),
    dutyPct: numeric("duty_pct", { precision: 5, scale: 4 }),
    tariffPct: numeric("tariff_pct", { precision: 5, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("quote_skus_quote_id_idx").on(t.quoteId),
    index("quote_skus_hubspot_product_id_idx").on(t.hubspotProductId),
    index("quote_skus_parent_sku_id_idx").on(t.parentSkuId),
    index("quote_skus_sku_role_idx").on(t.skuRole),
  ],
);

// ---------- inputs (Slice 5: packaging) ----------

// Per-line markup defaults. Vocabulary is intentionally *temporary* for
// Slice 5 — Slice 9 redefines categories around "line of work" and will
// rewrite both the markup_defaults rows and the category strings on
// existing packaging_inputs rows. Kept as text PK (not enum) so that
// future additions/renames don't require ALTER TYPE migrations.
export const markupDefaults = pgTable("markup_defaults", {
  category: text("category").primaryKey(),
  defaultMarkupPct: numeric("default_markup_pct", {
    precision: 5,
    scale: 4,
  }).notNull(),
  // Nullable so seed migrations can insert rows without a real user FK.
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// packaging_inputs is keyed by (quote_sku_id, tier_id) per the spec — one
// row per (line, tier) cell. line_group_id groups all per-tier rows that
// belong to the same logical "line" (same supplier / qty_per_unit /
// category / markup). Line-level fields are duplicated across the tier
// rows; per-tier fields are unit_cost and purchase_qty. Mass updates of
// line metadata happen at the action layer via line_group_id.
//
// sort_order is line-level (all tier rows of the same line_group share
// the same value); ↑/↓ arrows swap sort_order between two line groups.
//
// markup_pct + markup_pct_source: when category is set, default fills
// from markup_defaults[category]. Manual edits flip source to
// 'manual_override'; once overridden, category changes preserve the
// manual value (sticky override; UI surfaces a revert affordance).
//
// No FK on category to markup_defaults — Slice 9's vocabulary swap will
// rewrite both sides; the join is a soft reference.
export const packagingInputs = pgTable(
  "packaging_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteSkuId: uuid("quote_sku_id")
      .notNull()
      .references(() => quoteSkus.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),
    lineGroupId: uuid("line_group_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),

    // Line-level (duplicated across tier rows of the same line_group_id):
    supplier: text("supplier"),
    qtyPerSellableUnit: numeric("qty_per_sellable_unit"),
    category: text("category"),
    markupPct: numeric("markup_pct", { precision: 5, scale: 4 }),
    markupPctSource: markupPctSource("markup_pct_source"),
    inventoryEligible: boolean("inventory_eligible").notNull().default(false),
    notes: text("notes"),

    // Per-tier:
    unitCost: numeric("unit_cost", { precision: 10, scale: 4 }),
    purchaseQty: numeric("purchase_qty"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per (line, tier). Prevents duplicate cells.
    uniqueIndex("packaging_inputs_line_tier_idx").on(
      t.quoteSkuId,
      t.lineGroupId,
      t.tierId,
    ),
    index("packaging_inputs_quote_sku_id_idx").on(t.quoteSkuId),
    index("packaging_inputs_tier_id_idx").on(t.tierId),
    index("packaging_inputs_line_group_id_idx").on(t.lineGroupId),
  ],
);

// ---------- inputs (Slice 6: production) ----------

// One row per (leaf SKU × tier) — automatic, not PM-added like packaging
// lines. The (quote_sku_id, tier_id) unique index enforces this.
//
// Denormalization: customer_ships_raws, allocate_service_fees_to_cost, and
// notes are per-SKU policy, fanned out across all tier rows of that SKU
// by updateSkuProductionPolicy. Reading any one tier row gives the policy.
//
// bulk_raw_cost survives the customer_ships_raws toggle — the toggle
// conditionally hides the field in the UI but the value stays in the DB
// (CSS-hide / data-preserved semantics; toggling back restores the value).
//
// actual_units_produced is post-production observation, recorded after
// the job runs. Stored alongside cost inputs because it varies per tier.
//
// Cascade: tier delete and SKU delete both ON DELETE CASCADE. Tier add
// creates one row per leaf SKU; SKU creation (or assembly→leaf promotion)
// creates one row per existing tier — both wired in actions/quotes.ts.
export const productionInputs = pgTable(
  "production_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteSkuId: uuid("quote_sku_id")
      .notNull()
      .references(() => quoteSkus.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),

    // Per-SKU policy (denormalized across this SKU's tier rows).
    customerShipsRaws: boolean("customer_ships_raws").notNull().default(false),
    allocateServiceFeesToCost: boolean("allocate_service_fees_to_cost")
      .notNull()
      .default(true),
    notes: text("notes"),

    // Per-tier cost inputs (PM-edited).
    fillingBlendingCost: numeric("filling_blending_cost", {
      precision: 12,
      scale: 2,
    }),
    cmAssemblyTotal: numeric("cm_assembly_total", { precision: 12, scale: 2 }),
    setupFeeTotal: numeric("setup_fee_total", { precision: 12, scale: 2 }),
    toolingArtworkTotal: numeric("tooling_artwork_total", {
      precision: 12,
      scale: 2,
    }),
    rdTotal: numeric("rd_total", { precision: 12, scale: 2 }),
    otherServiceTotal: numeric("other_service_total", {
      precision: 12,
      scale: 2,
    }),
    bulkRawCost: numeric("bulk_raw_cost", { precision: 12, scale: 2 }),

    // Post-production observation.
    actualUnitsProduced: integer("actual_units_produced"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("production_inputs_sku_tier_idx").on(t.quoteSkuId, t.tierId),
    index("production_inputs_quote_sku_id_idx").on(t.quoteSkuId),
    index("production_inputs_tier_id_idx").on(t.tierId),
  ],
);

// ---------- inputs (Slice 7: freight) ----------

// PM-added freight lines, one per logical shipment. Each line spans every
// active tier (one row per (line_group_id, tier) pair). Per-line metadata
// — supplier, shipment_id, mode, markup, treatment, notes — is denormalized
// across this line's tier rows; updateFreightLineMetadata fans out across
// all rows of one line_group_id in a single UPDATE. Same shape as
// packaging_inputs.
//
// Freight lines are PM-added (not auto-seeded on SKU creation), unlike
// production_inputs. The cascade pattern in addTier walks existing
// line_group_ids and seeds new tier rows; if a SKU has no freight lines
// yet, no rows are created.
//
// markup_pct is NULLABLE here even though addFreightLine writes 0.30 at
// insert time. Matches packaging convention — captures "unset" as a
// meaningful state, doesn't silently apply 30% to a row no PM has touched.
//
// units_in_shipment is nullable. NULL = "use tier.qty for amortization in
// cost rollup" (the typical case). Populated only when shipment units
// differ from tier qty (yield-mismatch: ship 10k raws to produce 5k
// finished). Slice 8 cost rollup MUST honor: NULL → tier.qty.
export const freightInputs = pgTable(
  "freight_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteSkuId: uuid("quote_sku_id")
      .notNull()
      .references(() => quoteSkus.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),
    lineGroupId: uuid("line_group_id").notNull(),

    // Per-line metadata (denormalized across tier rows of the same line).
    shipmentId: text("shipment_id"),
    supplier: text("supplier"),
    freightMode: freightMode("freight_mode"),
    freightTreatment: freightTreatment("freight_treatment")
      .notNull()
      .default("bundled"),
    markupPct: numeric("markup_pct", { precision: 5, scale: 4 }),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),

    // Per-tier.
    totalFreight: numeric("total_freight", { precision: 12, scale: 2 }),
    unitsInShipment: integer("units_in_shipment"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("freight_inputs_line_tier_idx").on(
      t.quoteSkuId,
      t.lineGroupId,
      t.tierId,
    ),
    index("freight_inputs_quote_sku_id_idx").on(t.quoteSkuId),
    index("freight_inputs_tier_id_idx").on(t.tierId),
    index("freight_inputs_line_group_id_idx").on(t.lineGroupId),
  ],
);

// ---------- hubspot deal cache (Slice 5.6) ----------

// Local mirror of HubSpot deals for the import-deals page. Keeps the page
// sub-100ms after first sync (vs. ~1s for the prior 3-RT HubSpot chain).
// Cache, NOT source of truth — fields can be added/dropped freely; no
// inbound FK references. Eviction model:
//   - syncDeals(): DELETE active-stage rows + INSERT current active set,
//     in a short transaction (HubSpot fetch happens outside the tx).
//     Deals that left the active pipeline are evicted automatically.
//   - syncDealById(): single-row upsert. Closed deals reach the cache
//     only via this path (importing/refreshing a closed deal); they
//     coexist with active rows and aren't touched by syncDeals.
// Name/email columns are denormalized at sync time so the read query is
// single-table. See docs/HUBSPOT_CACHE.md for the full design.
export const hubspotDealsCache = pgTable(
  "hubspot_deals_cache",
  {
    dealId: text("deal_id").primaryKey(),
    dealName: text("deal_name").notNull(),
    dealStage: text("deal_stage"),
    amount: numeric("amount", { precision: 15, scale: 2 }),
    closeDate: date("close_date"),
    salesRepId: text("sales_rep_id"),
    salesRepName: text("sales_rep_name"),
    salesRepEmail: text("sales_rep_email"),
    pmId: text("pm_id"),
    pmName: text("pm_name"),
    pmEmail: text("pm_email"),
    associatedCompanyId: text("associated_company_id"),
    associatedCompanyName: text("associated_company_name"),
    createdAtHubspot: timestamp("created_at_hubspot", { withTimezone: true }),
    updatedAtHubspot: timestamp("updated_at_hubspot", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("hubspot_deals_cache_deal_name_idx").on(t.dealName),
    index("hubspot_deals_cache_deal_stage_idx").on(t.dealStage),
    index("hubspot_deals_cache_last_synced_at_idx").on(t.lastSyncedAt),
  ],
);

// ---------- audit ----------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    diffJson: jsonb("diff_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId)],
);
