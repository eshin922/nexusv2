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
  primaryKey,
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

// Slice 7 / R6.2 — freight treatment (bundled vs pass-through).
// Carries forward from Slice 7 unchanged; per-leg in the R6.2 model.
export const freightTreatment = pgEnum("freight_treatment", [
  "bundled",
  "pass_through",
]);

// Slice R6.2 — multi-leg journey freight vocabulary. Replaces the
// Slice 7 `freight_mode` 7-value enum (retired commit 3) with a
// 10-value mode enum that matches the R6.2 prototype data.js modes
// list (parcel · ocean_fcl/lcl · air_freight/express · ltl_truck ·
// truckload · drayage · exw_pickup · other). Per Pattern 25
// disposition A (R6.2 gap dispositions, May 2026).
export const freightDirection = pgEnum("freight_direction", [
  "inbound",
  "outbound",
]);
export const freightIncoterm = pgEnum("freight_incoterm", [
  "DDP",
  "DAP",
  "FOB",
  "EXW",
  "FCA",
  "CIF",
]);
export const freightLegMode = pgEnum("freight_leg_mode", [
  "parcel",
  "ocean_fcl",
  "ocean_lcl",
  "air_freight",
  "air_express",
  "ltl_truck",
  "truckload",
  "drayage",
  "exw_pickup",
  "other",
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

// ---------- RI.1 enums (redesign-implementation slice) ----------

// Slice RI.1 — scenario drop reasons. NULL on quotes that aren't
// dropped; set when scenarioStatus = 'dropped' (action layer ensures).
// Values per Round 3 + Round 4 commitments:
//   - superseded_by_copy: replaced by a copy operation (Slice 15)
//   - draft_at_accept: was a draft at the moment a sibling was
//     accepted; auto-saved as dropped sibling (Round 3 commit #2)
//   - accept_sibling: dropped because a sibling was accepted via
//     Mark-Accepted (Round 3 commit #5)
//   - manual: PM explicitly dropped it
//   - other: catch-all for forensic future cases
export const scenarioDropReason = pgEnum("scenario_drop_reason", [
  "superseded_by_copy",
  "draft_at_accept",
  "accept_sibling",
  "manual",
  "other",
]);

// Slice RI.1 — Bulk Raw raws-mode tri-state per Bulk Raw correction.
// Determines whether the Costs page renders the Bulk Raw
// section + which row-set the cost stack header shows.
export const rawsMode = pgEnum("raws_mode", [
  "cm_sources",
  "dps_sources",
  "customer_supplies",
]);

// Slice RI.1 — deposit lifecycle for cost sections (packaging, production,
// bulk_raw). Per Round 6 deposit-badge surface design.
export const depositStatus = pgEnum("deposit_status", [
  "none",
  "due",
  "invoiced",
  "paid",
  "reconciled",
]);

// Slice RI.1 — bulk raw native units. Customer-stated unit for raw
// ingredient cost-per-native + usage-per-filled. Drives unit-conversion
// in the Bulk Raw drill-down.
export const bulkRawNativeUnit = pgEnum("bulk_raw_native_unit", [
  "kg",
  "L",
  "mL",
  "oz",
  "g",
  "lb",
]);

// Slice RI.1 — cost section kind for cross-section deposit lifecycle.
// Single deposit table keyed by (quote_id, section_kind) per architect
// option A — cleaner than per-section meta tables.
export const costSectionKind = pgEnum("cost_section_kind", [
  "packaging",
  "production",
  "bulk_raw",
]);

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
    // Slice RI.7 — phone for PreparedBy contact derivation (DEC-8).
    // Back-filled from HubSpot owners API in ensureUser on first sign-in
    // (sync extension lands in RI.7). Admin manual entry affordance for
    // users whose HubSpot owner record has no phone.
    phone: text("phone"),
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
    // Slice 9.1 — per-quote override of firm_settings.target_margin_pct.
    // NULL = use the firm-level value (current behavior). When set,
    // replaces the firm-level target for THIS quote's blended margin
    // verdict (GOOD / BELOW_TARGET / BELOW_FLOOR thresholds). Wired
    // up in Slice 9.2 alongside the per-tier price adjustment.
    targetMarginPct: numeric("target_margin_pct", { precision: 5, scale: 4 }),
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
    // Slice RI.1 — Round 4 commitment: ★ Primary indicator. One scenario
    // per project marked recommended. False default; project-level
    // unique-by-recommended invariant enforced at the action layer
    // (not via DB constraint — multiple scenarios can be flipped during
    // PM exploration before the recommended pin lands; soft invariant).
    isRecommended: boolean("is_recommended").notNull().default(false),
    // Slice RI.1 — Round 3/4 commitment: drop_reason for scenarios
    // whose status = 'dropped'. Carries forensic intent of the drop.
    // NULL on active/accepted; required (action-layer) when status
    // transitions to 'dropped'.
    dropReason: scenarioDropReason("drop_reason"),
    droppedByUserId: uuid("dropped_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    droppedAt: timestamp("dropped_at", { withTimezone: true }),
    // ---------- Slice RI.7 — state machine + send-time snapshots ----------
    // Per docs/ri7-state-machine.md (CR-SM). Decision tags below map to
    // the resolved DEC-1..DEC-8 in CR-SM §6.

    // DEC-1: customer-acceptance event recording (event-not-phase). The
    // (status='sent' AND customer_accepted_at IS NOT NULL) tuple is the
    // "awaiting Mark-Accepted" sub-state — PM has recorded the customer
    // signal but hasn't finalized the gates yet. Mark-Accepted action
    // promotes these to accepted_* fields when PM clicks through.
    customerAcceptedAt: timestamp("customer_accepted_at", {
      withTimezone: true,
    }),
    customerAcceptedTierId: uuid("customer_accepted_tier_id").references(
      (): AnyPgColumn => quoteTiers.id,
      { onDelete: "set null" },
    ),
    customerAcceptedRecordedByUserId: uuid(
      "customer_accepted_recorded_by_user_id",
    ).references(() => users.id, { onDelete: "set null" }),
    // DEC-4: customer-facing quote number. Nullable until send.
    // Format: `{firm_settings.quote_number_prefix}-{quote_number_seq}`.
    // sendQuote action assigns; partial unique index enforces uniqueness
    // among assigned numbers. Single-tenant v1 — sequence is global.
    quoteNumber: text("quote_number"),
    // DEC-7: send-time snapshots of firm_settings commercial defaults.
    // Snapshot at sendQuote so past sent quotes never silently update if
    // firm settings change post-send. Drafts read firm_settings live.
    paymentTermsSnapshot: text("payment_terms_snapshot"),
    leadTimeSnapshot: text("lead_time_snapshot"),
    incotermsSnapshot: text("incoterms_snapshot"),
    tcsSnapshot: text("tcs_snapshot"),
    daysValidSnapshot: integer("days_valid_snapshot"),
    // DEC-8: PreparedBy contact snapshot at send. Same rationale as
    // DEC-7 — customer view of an already-sent quote must always show
    // the rep who sent it, even if the rep is reassigned/leaves/changes
    // phone after send. sendQuote resolves live
    // (projects.salesRepUserId → users + HubSpot owners fallback for
    // un-signed-in-rep) and writes the snapshots one-shot. Drafts
    // render live via getQuotePreparedBy switch on quote.status.
    preparedByNameSnapshot: text("prepared_by_name_snapshot"),
    preparedByEmailSnapshot: text("prepared_by_email_snapshot"),
    preparedByPhoneSnapshot: text("prepared_by_phone_snapshot"),
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
    // Slice RI.1 — partial index on the recommended pin per project.
    // Supports "find the recommended scenario for this project"
    // queries (one row per project max in steady state).
    index("quotes_project_recommended_idx")
      .on(t.projectId)
      .where(sql`is_recommended = true`),
    // Slice RI.7 — partial unique index on quote_number. Nullable until
    // send (DEC-4); once assigned must be globally unique (single-tenant
    // v1). When multi-tenant lands, replace with (firm_id, quote_number)
    // composite — see UX_BACKLOG "Multi-tenant quote-number sequence".
    uniqueIndex("quotes_quote_number_idx")
      .on(t.quoteNumber)
      .where(sql`quote_number IS NOT NULL`),
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
    // Slice 9.1 — per-tier override of quotes.global_price_adj_pct.
    // NULL = use the global value (current behavior). When set,
    // REPLACES the global for THIS tier's costing math (not stacks).
    // PMs use this when one tier needs a different markup than the
    // quote-level adjustment. Wired up in Slice 9.2.
    tierPriceAdjPct: numeric("tier_price_adj_pct", { precision: 5, scale: 4 }),
    // §6.b Step 5 prep (Pattern 22 #7) — R7b "★ Recommended" flag.
    // One tier per quote can be marked recommended; PMs surface
    // the recommendation to customers via the Quote PDF +
    // Mark-Accepted flow. "One per quote" invariant enforced at
    // the action layer (setTierRecommended clears sibling rows on
    // set); no DB constraint v1.
    recommended: boolean("recommended").notNull().default(false),
    // (Slice 9.1's `client_target_price_per_unit` lived here originally;
    // moved to a dedicated `quote_sku_tier_targets` table in Slice 9.4b
    // migration 0016 once the IA spec settled per-(SKU, tier) granularity.
    // No data migration was needed — the column was speculative and
    // never UI-wired; zero non-null values existed at drop time.
    // Architect call against single-table extension (option A): client
    // target benchmark has independent lifecycle from `sell_price_override`
    // and isn't a price-adjustment-hierarchy participant. Sister table
    // preserves Slice 9.3's column-level NOT NULL invariant ("row exists
    // ⟹ value is set") and avoids cross-column cleanup logic in actions.)
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
    // Customs / landed-cost data (Slice 6.5 original; Slice R6.2
    // retired the per-SKU model in favor of per-leg customs JSONB
    // on `freight_legs.customs`). These columns persist as orphan
    // data post-R6.2 (pre-prod tolerance per Pattern 32 — no UI
    // writes them, the math layer ignores them). A future cleanup
    // can drop them once any forensic value is exhausted; until
    // then they're harmless null/legacy-value columns.
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

// ---------- per-cell sell-price overrides (Slice 9.3) ----------

// Sparse table: rows exist ONLY when a PM has set an explicit sell-price
// override on a (SKU, tier) cell. Absent row = "use computed sell"
// (which itself respects per-tier and global price adjustments). This
// is the third layer of the price-adjustment hierarchy:
//
//   if (cell exists) → use cell.sell_price_override (TERMINAL — bypasses
//                       both per-tier and global adjustments)
//   else if (tier.tier_price_adj_pct IS NOT NULL) → use tier override
//   else → use quote.global_price_adj_pct
//
// Composite PK on (quote_sku_id, tier_id) — one override per cell at
// most. Lazy writes: actions/sell-price-overrides.ts performs INSERT
// ON CONFLICT UPDATE on set, DELETE on clear. Read paths LEFT JOIN.
//
// FKs cascade-delete from both parents — removing a SKU or a tier
// removes any overrides it carried. Audit pattern uses a synthesized
// composite key for entity_id ("{quote_sku_id}:{tier_id}") since
// audit_log.entity_id is text (per CLAUDE.md "audit_log.entity_id is
// text"). Diff_json carries both keys as well for query convenience.
export const quoteSkuTiers = pgTable(
  "quote_sku_tiers",
  {
    quoteSkuId: uuid("quote_sku_id")
      .notNull()
      .references(() => quoteSkus.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),
    // numeric(10,4) matches the precision of computed sell prices
    // (packagingInputs.unitCost, freightInputs.totalFreight, etc.).
    // NOT NULL enforces the invariant "row exists ⟹ override is set"
    // at the schema level. The action layer's DELETE-not-UPDATE-NULL
    // pattern works without friction here; NOT NULL is defense in
    // depth that catches future code paths attempting to violate
    // the invariant before bad data accumulates.
    sellPriceOverride: numeric("sell_price_override", { precision: 10, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.quoteSkuId, t.tierId] }),
    // Reverse index for "all overrides in this tier" queries (e.g.,
    // tier-side aggregations during costing rollup).
    index("quote_sku_tiers_tier_id_idx").on(t.tierId),
  ],
);

// ---------- per-cell client target benchmarks (Slice 9.4b) ----------

// Sister sparse table to `quote_sku_tiers`. Different concern, parallel
// pattern. Stores the customer's stated target price per (SKU, tier) cell
// — the "client wants $5 landed at 50k for this SKU" data — used by
// Slice 9.4b's two-axis verdict (margin × competitive: COMPETITIVE /
// OVER / WAY OVER) and the "Apply suggested adj to match client target"
// reverse-solve affordance (which writes per-tier `tier_price_adj_pct`,
// not per-cell sell price — see UX_BACKLOG).
//
// Why a sister table, not a column on `quote_sku_tiers`:
//   - `quote_sku_tiers` is "third layer of the price-adjustment
//     hierarchy" — terminal sell-price overrides that bypass per-tier
//     and global adjustments. Client target benchmarks aren't price-
//     adjustment-hierarchy participants; they feed a separate verdict
//     and a different reverse-solve target.
//   - Independent lifecycles: PM may benchmark a cell without
//     overriding it, override without knowing the client target, or
//     set both. Single-column NOT NULL preserves Slice 9.3's
//     "row exists ⟹ value is set" defense-in-depth at the column
//     level (vs row-level CHECK across two columns, which complicates
//     action-layer cleanup logic with read-after-write race windows).
//   - Future cell-level concerns (per-cell freight treatment, valid-
//     until, scenario annotations, PM justification notes) follow the
//     same table-per-concern pattern. Composes by addition; no CHECK
//     constraint amendment as columns accrete.
//
// Lazy-row pattern (mirrors `quote_sku_tiers`):
//   - Action `setClientTarget(quoteSkuId, tierId, value | null)`:
//     value > 0 → INSERT ON CONFLICT DO UPDATE; value === null → DELETE
//   - Action layer rejects value <= 0 (matches Slice 9.3 sell-override
//     invariant — non-positive prices break partition revenue math).
//   - Read paths LEFT JOIN this table; absent row reads as "no benchmark."
//
// Audit pattern (mirrors `quote_sku_tiers`):
//   - `entity_type = "quote_sku_tier_target"` (audit_log.entity_id text)
//   - `entity_id` = synthesized composite `${quoteSkuId}:${tierId}`
//   - Single action `client_target_updated`; from/to in diff_json
//     distinguishes set/change/clear (per CLAUDE.md "Audit source
//     convention" — same column → same action; from/to encodes intent).
export const quoteSkuTierTargets = pgTable(
  "quote_sku_tier_targets",
  {
    quoteSkuId: uuid("quote_sku_id")
      .notNull()
      .references(() => quoteSkus.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),
    // numeric(10,4) matches the precision of `quote_sku_tiers.sell_price_override`
    // and other monetary columns. NOT NULL enforces "row exists ⟹
    // benchmark is set" at the column level (defense in depth — action
    // layer's DELETE-not-UPDATE-NULL pattern catches future bypass).
    clientTargetPricePerUnit: numeric("client_target_price_per_unit", {
      precision: 10,
      scale: 4,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.quoteSkuId, t.tierId] }),
    // Reverse index for "all benchmarks in this tier" queries.
    index("quote_sku_tier_targets_tier_id_idx").on(t.tierId),
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

// Slice 8 — firm-level policy. Versioned via effective_from/until so we
// can answer "what was our floor margin in Q3" without schema migration.
// v1 only ever has one current row (effective_until IS NULL); admin
// edits insert a new row and set the prior row's effective_until.
//
// Read pattern: the "current" settings is the row with effective_until
// IS NULL. Index on (effective_from DESC NULLS LAST, effective_until
// DESC NULLS FIRST) supports both that lookup and historical queries.
export const firmSettings = pgTable(
  "firm_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetMarginPct: numeric("target_margin_pct", { precision: 5, scale: 4 })
      .notNull()
      .default("0.3500"),
    floorMarginPct: numeric("floor_margin_pct", { precision: 5, scale: 4 })
      .notNull()
      .default("0.2500"),
    // ---------- Slice RI.7 — vendor identity + customer-facing defaults ----------
    // Per docs/ri7-brief-amendment.md §3.10. Vendor identity is firm-level
    // (renders live on every customer view PdfHeader). Customer-facing
    // defaults (T&Cs / terms / lead time / incoterms / days_valid) feed
    // the per-quote snapshot at sendQuote (see quotes.*_snapshot above).
    // Seed values landed via migration 0020 for the active row (per PM
    // answers in brief amendment §5.1, §5.3-§5.7); tcs_default left NULL
    // pending Edward's canonical T&Cs text (hold gate before PR-to-main).
    vendorName: text("vendor_name"),
    vendorTagline: text("vendor_tagline"),
    vendorAddress: text("vendor_address"),
    quoteNumberPrefix: text("quote_number_prefix"),
    tcsDefault: text("tcs_default"),
    paymentTermsDefault: text("payment_terms_default"),
    leadTimeDefault: text("lead_time_default"),
    incotermsDefault: text("incoterms_default"),
    daysValidDefault: integer("days_valid_default"),
    effectiveFrom: date("effective_from").notNull().default(sql`CURRENT_DATE`),
    effectiveUntil: date("effective_until"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("firm_settings_current_idx").on(
      t.effectiveFrom.desc().nullsLast(),
      t.effectiveUntil.desc().nullsFirst(),
    ),
  ],
);

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

// ---------- R6.2 freight legs (multi-leg journey model) ----------
//
// Slice R6.2 replaces the Slice 7 flat `freight_inputs` table with a
// multi-leg journey structure: leg_groups → legs → per-(leg, tier)
// cost rows + customer-arranges-meta. Per Pattern 25 disposition A
// (R6.2 gap dispositions, May 2026). Commit 1 shipped the additive
// schema, commit 2 swept every consumer, commit 3 closed out the
// migration by dropping the legacy `freight_inputs` table + the
// `freight_mode` 7-value enum.

// Journey container. One row per logical journey (e.g.,
// "Outbound · Shenzhen → Busan → Long Beach"). Legs in the
// group form a sequence; cross-leg date drift produces inline
// warnings (per Gap 5 disposition: warn, not reject).
// `display_order` orders groups within a quote.
export const freightLegGroups = pgTable(
  "freight_leg_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("freight_leg_groups_quote_id_idx").on(t.quoteId)],
);

// One row per physical leg within a journey. The math contract
// carries the markup-on-amount semantics:
//   freight_billable = freight_cost × (1 + freight_markup_pct)
//   duty_billable    = duty_pct × goods_cost_base × (1 + duty_markup_pct)
//   tariff_billable  = parallel
//
// `customs` is JSONB per CD commitment — leaves room for
// additional rates (broker fees, classification annotations)
// without schema churn. Shape: { duty_pct?, tariff_pct? }.
//
// `crosses_international_border` is PM-set in v1; v1.x will
// derive from country-coded origin/destination once those
// fields get structure (Pushback 2 of designer notes).
//
// Customs cluster visibility rule:
//   crosses_international_border AND incoterm = 'DDP'
//
// Per-component markup pcts default 0.3000. Range per Gap 5:
// 0.0000 - 9.9999 (covers Cally's tariff-anomaly zero-markup
// case and forwarder edge weirdness).
//
// `forwarder_quote_pdf_id` deferred to P2 with the attachments
// table (Gap 24) — column not added yet to avoid stale FK.
export const freightLegs = pgTable(
  "freight_legs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legGroupId: uuid("leg_group_id")
      .notNull()
      .references(() => freightLegGroups.id, { onDelete: "cascade" }),

    // Head
    direction: freightDirection("direction").notNull().default("outbound"),
    label: text("label"),
    origin: text("origin"),
    destination: text("destination"),
    crossesInternationalBorder: boolean("crosses_international_border")
      .notNull()
      .default(false),
    treatment: freightTreatment("treatment").notNull().default("bundled"),

    // Body grid
    mode: freightLegMode("mode"),
    carrier: text("carrier"),
    incoterm: freightIncoterm("incoterm"),
    cargoReadyDate: date("cargo_ready_date"),
    vesselEtd: date("vessel_etd"),

    // Per-component markup pills
    freightMarkupPct: numeric("freight_markup_pct", { precision: 5, scale: 4 })
      .notNull()
      .default("0.3000"),
    dutyMarkupPct: numeric("duty_markup_pct", { precision: 5, scale: 4 })
      .notNull()
      .default("0.3000"),
    tariffMarkupPct: numeric("tariff_markup_pct", { precision: 5, scale: 4 })
      .notNull()
      .default("0.3000"),

    // Customs JSONB (per CD commitment)
    customs: jsonb("customs").notNull().default(sql`'{}'::jsonb`),

    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("freight_legs_leg_group_id_idx").on(t.legGroupId)],
);

// Per-(leg, tier) cost data. PM enters `total_freight` from
// forwarder quotes; `units_in_shipment` overrides tier.qty
// when a leg ships a different volume than the tier qty
// (rare — partial container, yield mismatch). The math layer
// applies `effective_units = units_in_shipment ?? tier.qty`
// per leg.
//
// Sparse: rows exist only after PM has started entering data
// for the (leg, tier). UNIQUE(leg, tier) — one row per
// intersection.
export const freightLegTiers = pgTable(
  "freight_leg_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    freightLegId: uuid("freight_leg_id")
      .notNull()
      .references(() => freightLegs.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),
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
    uniqueIndex("freight_leg_tiers_leg_tier_idx").on(
      t.freightLegId,
      t.tierId,
    ),
    index("freight_leg_tiers_freight_leg_id_idx").on(t.freightLegId),
    index("freight_leg_tiers_tier_id_idx").on(t.tierId),
  ],
);

// Customer-arranges-mode metadata per leg. Separate table per
// Gap 18 disposition (rather than JSONB on freight_legs) —
// fields have independent audit lifecycles and audit_note is
// a multi-line TEXT field.
//
// `freight_leg_id` is PK + FK; one meta row per leg. Created
// only when the leg's panel mode = 'customer_arranges'.
// `cargo_ready_date` for customer-arranges legs lives on
// freight_legs.cargo_ready_date — unified across modes per
// the rev-1 promotion (designer notes Pushback 3).
export const freightCustomerArrangesMeta = pgTable(
  "freight_customer_arranges_meta",
  {
    freightLegId: uuid("freight_leg_id")
      .primaryKey()
      .references(() => freightLegs.id, { onDelete: "cascade" }),
    customerContact: text("customer_contact"),
    auditNote: text("audit_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// ---------- validation engine (Slice 9.5) ----------

// Persistent warnings produced by the validation engine
// (`src/lib/validation.ts`). Surfaces inline alongside the suspicious
// field, in per-page summary panels, and aggregated on the Costing
// Sheet. PMs can fix the underlying data (engine auto-resolves) or
// accept the warning with a reason.
//
// Two scopes (per brief §2):
//   - 'line' — warning targets a specific row + field + tier
//     (table_name + row_id + field_name + tier_id)
//   - 'quote' — warning targets the whole quote (e.g., "no SKUs have
//     cost data yet"); table_name / row_id / field_name / tier_id
//     all NULL
//
// `row_id` is TEXT (not UUID) per architect's recommendation — mirrors
// `audit_log.entity_id` posture. Genuine row warnings store the row's
// UUID-as-text. Cross-row pattern warnings (e.g., service-fee variance
// across that SKU's tier rows) synthesize a composite text key like
// `"sku:<sku_id>:col:setup_fee_total"`. Single column carries both
// shapes; identity-tuple addressing stays unambiguous.
//
// Status lifecycle:
//   - 'active' — currently surfaced
//   - 'accepted' — PM explicitly suppressed with reason. Per architect
//     option (iii): suppression sticks until manual re-activate or row
//     delete; engine doesn't compare accept-time data snapshots. UX
//     for manual re-activate is UX_BACKLOG candidate (not 9.5 blocking).
//   - 'auto_resolved' — underlying data changed such that engine no
//     longer fires; engine flips status automatically. Auto-resolved
//     row stays as historical record; if engine re-fires, a NEW active
//     row is INSERTed (architect verdict in §3 reconciliation).
//
// Audit pattern (mirrors CLAUDE.md cascade audit):
//   - Single audit row per user action that triggers re-validation
//   - Cascading warning lifecycle changes (created / auto-resolved /
//     re-activated) captured in `diff_json.cascaded_warnings_*` keys
//   - When PM explicitly accepts a warning: own audit row with
//     `caused_by_audit_id` linking back to the input change that
//     surfaced the warning (when applicable; Round 5 commitment)
//
// Persistence asymmetry (per brief §3): engine fires client-side on
// every input change for inline display (free, in-memory); persists
// server-side ONLY on action commit (insert/update/delete completion).
// This is intentionally different from costing's keystroke-debounced
// persistence — warnings are persistent state with audit trail;
// keystroke-aligned persistence would create write storms.
export const quoteWarnings = pgTable(
  "quote_warnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),

    // Scope: line-level vs quote-level
    scope: text("scope").notNull(), // CHECK enforced via raw SQL in migration

    // Targeting: which row, which field, which tier (NULL when scope = 'quote')
    tableName: text("table_name"),
    rowId: text("row_id"),
    fieldName: text("field_name"),
    tierId: uuid("tier_id").references(() => quoteTiers.id, {
      onDelete: "cascade",
    }),

    // Classification
    kind: text("kind").notNull(),
    severity: text("severity").notNull(), // CHECK: 'info' | 'review' | 'action_required'

    // Status lifecycle
    status: text("status").notNull().default("active"), // CHECK: 'active' | 'accepted' | 'auto_resolved'

    // Acceptance trail (when status = 'accepted')
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptReasonKind: text("accept_reason_kind"), // 'vendor_moq_break' | 'customer_specific_pricing' | 'special_handling_fee' | 'custom' | NULL
    acceptReasonText: text("accept_reason_text"),

    // Auto-resolve trail (when status = 'auto_resolved')
    autoResolvedAt: timestamp("auto_resolved_at", { withTimezone: true }),

    // Surface metadata
    message: text("message").notNull(),
    detailJson: jsonb("detail_json"),

    // Lifecycle timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // "Active warnings on this quote" — drives summary chip counts +
    // Mark-Accepted gate read in Slice 12.
    index("quote_warnings_quote_active_idx")
      .on(t.quoteId, t.status)
      .where(sql`status = 'active'`),
    // "All warnings on this quote, by scope" — line vs quote split.
    index("quote_warnings_quote_scope_idx").on(t.quoteId, t.scope),
    // "Warnings on this row" — for inline icon affordances + cell-
    // level cleanup. Partial: skips quote-scope warnings (no row_id).
    index("quote_warnings_row_idx")
      .on(t.tableName, t.rowId)
      .where(sql`table_name IS NOT NULL`),
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
    // text rather than uuid so non-UUID-PK entities (e.g.,
    // markup_defaults uses category text as PK) can audit cleanly.
    // Existing UUID-PK entities (firm_settings, quotes, packaging_inputs,
    // etc.) still write their UUID into this column — UUIDs are valid
    // text. Caught Slice 8 admin smoke-test 7: inserting a markup
    // defaults audit row with category "Test Category" rejected by
    // the prior uuid type. Migration 0013 casts existing values via
    // entity_id::text losslessly.
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    diffJson: jsonb("diff_json").notNull().default(sql`'{}'::jsonb`),
    // Slice RI.1 — Round 5 cascade tagging commitment. When a single
    // user action triggers cascading derived audit rows (e.g., re-band
    // cascading from firm_settings change touches N quotes), each
    // derived row sets caused_by_audit_id → the user-action's audit row.
    // Self-FK; ON DELETE SET NULL preserves cascade roots even when
    // a derived child is purged. NULL on root (user-initiated) audits.
    causedByAuditId: uuid("caused_by_audit_id").references(
      (): AnyPgColumn => auditLog.id,
      { onDelete: "set null" },
    ),
    // Slice RI.1 — Round 5 audit log read view denormalized columns
    // for free-text search. summary = human-readable short description
    // ("PM updated target margin from 35% to 38%"); entity_label =
    // resolved label of the entity ("Lumen & Co. · Primary v3").
    // Both indexed via gin_trgm_ops for trigram search. Populated by
    // logAudit() helper at write time; existing rows backfilled via
    // migration data step where derivable.
    summary: text("summary"),
    entityLabel: text("entity_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    // Slice RI.1 — index on caused_by_audit_id for cascade-rollup
    // queries ("show all audit rows derived from this user action").
    // Partial — only non-NULL caused_by rows are interesting.
    index("audit_log_caused_by_idx")
      .on(t.causedByAuditId)
      .where(sql`caused_by_audit_id IS NOT NULL`),
    // Slice RI.1 — trigram GIN indexes for free-text search on
    // summary + entity_label. Powers the audit-log read view filter
    // bar's free-text search box. Requires pg_trgm extension.
    index("audit_log_summary_trgm_idx").using(
      "gin",
      sql`${t.summary} gin_trgm_ops`,
    ),
    index("audit_log_entity_label_trgm_idx").using(
      "gin",
      sql`${t.entityLabel} gin_trgm_ops`,
    ),
  ],
);

// ---------- RI.1 workspace state ----------

// Slice RI.1 — user-pinned projects for the outer rail's Pinned
// section (Round 4). Composite PK enforces one pin per
// (user, project). pin_order drives stable left-to-right ordering
// in the rail. ON DELETE CASCADE on both FKs cleans pins when a
// user or project is removed.
export const userPinnedProjects = pgTable(
  "user_pinned_projects",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    pinOrder: integer("pin_order").notNull().default(0),
    pinnedAt: timestamp("pinned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.projectId] }),
    index("user_pinned_projects_user_pin_order_idx").on(
      t.userId,
      t.pinOrder,
    ),
  ],
);

// Slice RI.1 — user-project visit log for the outer rail's Recent
// section (Round 4 MRU). Composite PK enforces single row per
// (user, project); last_visited_at updated on each project surface
// nav. Index on (user_id, last_visited_at DESC) supports
// MRU-ordered Recent fetch.
export const userProjectVisits = pgTable(
  "user_project_visits",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    lastVisitedAt: timestamp("last_visited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.projectId] }),
    index("user_project_visits_user_visited_idx").on(
      t.userId,
      t.lastVisitedAt.desc(),
    ),
  ],
);

// ---------- RI.1 Bulk Raw schema (Bulk Raw correction) ----------

// Slice RI.1 — per-quote bulk-raw section meta. Carries raws_mode
// (the tri-state mode selector). Deposit lifecycle lives on the
// cross-section `cost_section_deposits` table per architect
// option A — single deposit table for all sections.
//
// Keyed by quote_id (one bulk-raw section per quote). When Slice 14
// normalizes scenarios into their own table, this could re-key to
// (scenario_id) but for v1 quote_id is sufficient.
export const bulkRawSectionMeta = pgTable(
  "bulk_raw_section_meta",
  {
    quoteId: uuid("quote_id")
      .primaryKey()
      .references(() => quotes.id, { onDelete: "cascade" }),
    rawsMode: rawsMode("raws_mode").notNull().default("cm_sources"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// Slice RI.1 — Bulk Raw category. PM-defined grouping of ingredients
// (e.g., "Active ingredients", "Carriers"). Multiple per quote;
// markup_pct optional override of firm default for this category.
export const bulkRawCategories = pgTable(
  "bulk_raw_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    markupPct: numeric("markup_pct", { precision: 5, scale: 4 }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("bulk_raw_categories_quote_id_idx").on(t.quoteId)],
);

// Slice RI.1 — Bulk Raw ingredient. PM-entered raw with native unit
// + cost-per-native + usage-per-filled. per_filled_unit_cost is a
// stored generated column (Postgres-computed at row-write time) so
// downstream consumers don't re-derive on every read. supplier_id
// nullable until suppliers infrastructure ships separately.
export const bulkRawIngredients = pgTable(
  "bulk_raw_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => bulkRawCategories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nativeUnit: bulkRawNativeUnit("native_unit").notNull(),
    costPerNativeUnit: numeric("cost_per_native_unit", {
      precision: 10,
      scale: 4,
    }),
    usagePerFilledUnit: numeric("usage_per_filled_unit", {
      precision: 10,
      scale: 4,
    }),
    perFilledUnitCost: numeric("per_filled_unit_cost", {
      precision: 10,
      scale: 4,
    }).generatedAlwaysAs(
      sql`cost_per_native_unit * usage_per_filled_unit`,
    ),
    htsCode: text("hts_code"),
    supplierId: uuid("supplier_id"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bulk_raw_ingredients_category_id_idx").on(t.categoryId),
  ],
);

// ---------- RI.1 cross-section deposits ----------

// Slice RI.1 — single table for deposit lifecycle across all cost
// sections (architect option A per brief Q1). Keyed by
// (quote_id, section_kind) — at most one deposit row per
// (quote, section). Round 6 deposit-badge surface design renders
// state strings off this table.
export const costSectionDeposits = pgTable(
  "cost_section_deposits",
  {
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    sectionKind: costSectionKind("section_kind").notNull(),
    depositPct: numeric("deposit_pct", { precision: 5, scale: 4 }),
    depositAmount: numeric("deposit_amount", { precision: 12, scale: 2 }),
    depositStatus: depositStatus("deposit_status").notNull().default("none"),
    depositInvoiceId: text("deposit_invoice_id"),
    depositInvoicedAt: timestamp("deposit_invoiced_at", {
      withTimezone: true,
    }),
    depositPaidAt: timestamp("deposit_paid_at", { withTimezone: true }),
    depositReconciledAt: timestamp("deposit_reconciled_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.quoteId, t.sectionKind] }),
    index("cost_section_deposits_quote_id_idx").on(t.quoteId),
  ],
);

// ---------- Slice RI.9 — Navigation IA `user_surface_visits` ----------
//
// Records the LAST surface a user touched per (project, quote). Read
// path is the Home Resume card ("continue where you left off"). Write
// path is every quote-scoped server-rendered page-load, via UPSERT.
//
// Schema decision (CC + CA, May 2026, brief §3.7 patched inline):
// `scenario_id` was originally part of the unique key per R7a designer
// notes, but our v1 schema denormalizes scenarios onto `quotes`
// (`quotes.scenario_label`, `quotes.scenario_status`,
// `quotes.version_number`); there is no `scenarios` table yet. `quote_id`
// is the natural FK target — each quote row IS a scenario version.
// Resume card reads `quotes.scenario_label` via JOIN for display.
// Slice 14 normalization may re-key to `(scenario_id)` later per the
// schema.ts:1158 Slice 14 todo. Caught Pattern 22 pre-build.
//
// UPSERT growth model (CA refinement of CD's append + trim):
// `unique (user_id, project_id, quote_id, surface_key)` + INSERT ...
// ON CONFLICT DO UPDATE SET visited_at = NOW(). No cron trim needed —
// table size bounded by user × surface × quote combinations
// (~5 surfaces × N quotes per user). Trade-off accepted: loses
// per-surface visit history beyond latest. Revisit if R7c surfaces a
// "recent activity" use case requiring history.
//
// Both `project_id` and `quote_id` carry ON DELETE CASCADE so cleanup
// is automatic when a project or quote is deleted (no stale resume
// rows). `quote_id` is nullable on the column even though the typical
// use case keys on it — leave room for future non-quote-scoped surfaces
// (Setup before SKUs is currently `/projects/[id]/quotes/[quoteId]` so
// the column is effectively NOT NULL in practice).
export const userSurfaceVisits = pgTable(
  "user_surface_visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id").references(() => quotes.id, {
      onDelete: "cascade",
    }),
    surfaceKey: text("surface_key").notNull(),
    visitedAt: timestamp("visited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("user_surface_visits_unique_idx").on(
      t.userId,
      t.projectId,
      t.quoteId,
      t.surfaceKey,
    ),
    index("user_surface_visits_user_visited_idx").on(
      t.userId,
      t.visitedAt,
    ),
  ],
);
