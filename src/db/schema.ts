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

// Phase A.1 v2 — Product Type taxonomy scope discriminator.
// Per Architect §0.5 Gate 1: unified `product_types` table with
// scope flag (Path A) accepted; pgEnum recommended over CHECK for
// house-style alignment with userRole + projectCategory + others.
export const productTypeScope = pgEnum("product_type_scope", [
  "assembly",
  "leaf",
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

// Slice 11 Step 4 — customer-PDF layout + detail axes. Snapshot-fleet
// members (mirror pdfLayout / detailLevel round-trip: draft reads live
// searchParam ?? default; sent+ reads the snapshot column). NULL on
// legacy rows (adapter defaults NULL → 'tier_table' / 'itemized'
// respectively; matches current behavior pre-Slice-11).
export const pdfLayout = pgEnum("pdf_layout", ["tier_table", "single_tier"]);
export const detailLevel = pgEnum("detail_level", ["itemized", "turnkey_only"]);

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
    // Phase A.1 v2 — permission flags for ASY/LEAF/library model.
    // Per Architect §0.5 Gate 5 (Path B): action-layer guards
    // enforce these flags (see src/lib/spec-permission-guard.ts);
    // NOT Postgres RLS policies. Matches existing admin-guard.ts
    // pattern. Default false; per-user grants applied via migration
    // seed (§15.3 dispositions).
    canEditSpecs: boolean("can_edit_specs").notNull().default(false),
    canCreateLeaves: boolean("can_create_leaves").notNull().default(false),
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
    // canonical-scenario-create-flow — slice extends usage; the
    // existing Slice RI.1 column is the canonical per-scenario
    // recommendation pin (the brief's proposed `scenario_recommended`
    // is duplicate — Pattern 22 §0.5 catch #7 in v1 cycle). The
    // soft action-layer invariant upgrades to a hard DB constraint
    // via the unique partial index below.
    isRecommended: boolean("is_recommended").notNull().default(false),
    // canonical-scenario-create-flow — intent note captured at
    // scenario creation modal. Optional; PMs explain why this
    // scenario exists ("Customer pushed back on packaging cost").
    intentNote: text("intent_note"),
    // canonical-scenario-create-flow — customer's stated target
    // tier captured at scenario creation. Stored as TEXT label (not
    // FK) per CA Q3 disposition — target tier reference is fragile
    // in a denormalized-scenarios world where copy operations
    // would invalidate per-quote FK; text label survives.
    customerTargetTierLabel: text("customer_target_tier_label"),
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
    // Slice 11 Step 4 — customer-PDF render axes. Snapshot fleet
    // members alongside DEC-7. Read path: draft = live
    // (searchParam ?? default); sent+ = snapshot column. NULL on
    // legacy rows (adapter defaults NULL → 'tier_table' / 'itemized'
    // / hasMeaningfulContent-driven addendum). The three columns
    // together capture "how did the customer see this quote at
    // send time?" — retrofits pdf_layout into the snapshot fleet
    // since RI.7 pre-dated the customer PDF render path.
    pdfLayoutSnapshot: pdfLayout("pdf_layout"),
    detailLevelSnapshot: detailLevel("detail_level"),
    includeSpecAddendumSnapshot: boolean("include_spec_addendum"),
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
    //
    // canonical-scenario-create-flow — upgraded from non-unique
    // index to UNIQUE per CA Q4 disposition: at most one
    // recommended scenario per project enforced at the DB level
    // (was soft action-layer invariant per RI.1 comment). Same
    // index serves both lookup performance AND uniqueness.
    uniqueIndex("quotes_project_recommended_idx")
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
    // slice-pricing-surface-redesign Step 2 — policy gates surfaced
    // by the Pricing surface classifier per CD data-source map. Both
    // default true to preserve current production behavior (override
    // path + accept-risk path both available). Surfaced in the
    // classifier as `policy.allow_override` + `policy.allow_accept_risk`.
    // When false:
    //   - allow_override = false → blocked-mode action card emits
    //     `kind: 'override_unavailable'` (inert) instead of
    //     `request_override`; state line carries `override unavailable
    //     · firm policy` qualifier (designer notes §9 round-2 fix #5)
    //   - allow_accept_risk = false → blocked-mode banner explains
    //     the accept-risk path is gated by firm policy (designer
    //     notes §8 disposition — banner preserves discoverability
    //     for cross-firm onboarding)
    // Versioned-table carry-forward: extended in
    // versionedFirmSettingsUpdate helper to carry both columns
    // forward on every update unless explicitly reset.
    allowOverride: boolean("allow_override").notNull().default(true),
    allowAcceptRisk: boolean("allow_accept_risk").notNull().default(true),
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
    // Slice R6.2 commit 4 — additive forwarder-visibility metadata
    // per PM ask post-smoke. Both nullable, never required by
    // incoterm class (ETA is a forwarder estimate; actual delivery
    // only known post-shipment). Designer notes Pushback 3 banked
    // vessel_eta for v2 as part of forwarder ETA-confidence framing;
    // pulled forward to v1 per PM demand. No math impact — both are
    // PM-reference fields; cross-leg sequential validation (Gap 5,
    // deferred to v1.1 per Gap 21) will prefer ETA over ETD when
    // present once the validation engine is re-introduced.
    vesselEta: date("vessel_eta"),
    actualDeliveryDate: date("actual_delivery_date"),

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

// ---------- pricing_events (Pricing reframe v1) ----------

// Pricing-surface telemetry. Single table, five event_type values:
//   - 'surgical_apply'         — PM applied a single-tier suggestion
//   - 'request_override'       — PM hit "Request override" on below-floor
//   - 'recommended_fired'      — ★ Recommended suggestion surfaced
//   - 'recommended_accepted'   — PM accepted the ★ Recommended path
//   - 'recommended_overridden' — PM picked non-recommended path
// CHECK constraint enforced in migration (drizzle-kit doesn't generate
// CHECK from comments; manual ALTER added to the migration).
//
// FK semantics (per Disposition A from §0.5):
//   - quote_id          → CASCADE (sibling-table consistency)
//   - user_id           → SET NULL (audit_log.user_id precedent)
//   - violation_tier_id → SET NULL (telemetry survives tier deletion
//                                   for cohort analysis)
//
// suggestion_target_tier_ids uuid[]: Postgres array, per-element FK
// constraints not supported. App-layer validation enforces; Pattern 32
// pre-prod tolerance applies.
//
// Indexes for cohort analysis (per Disposition):
//   - (quote_id, event_type, created_at) — per-quote analytics
//   - (event_type, created_at)            — cross-quote cohort queries
//
// Not in realtime publication. RLS off (matches codebase posture).
// Write-only from server actions; no client reads.
export const pricingEvents = pgTable(
  "pricing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    violationTierId: uuid("violation_tier_id").references(
      () => quoteTiers.id,
      { onDelete: "set null" },
    ),
    suggestionTargetTierIds: uuid("suggestion_target_tier_ids").array(),
    floorBreachPp: numeric("floor_breach_pp", { precision: 4, scale: 2 }),
    overrideReason: text("override_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pricing_events_quote_event_created_idx").on(
      t.quoteId,
      t.eventType,
      t.createdAt,
    ),
    index("pricing_events_event_created_idx").on(t.eventType, t.createdAt),
  ],
);

// ═════════════════════════════════════════════════════════════════
// Phase A.1 v2 — ASY/LEAF/library spec model
// ═════════════════════════════════════════════════════════════════
//
// Path A (Architect §0.5 disposition + Edward locked): NEW parallel
// structure layered over existing quote_skus. Six new tables ship in
// impl-1; existing quote_skus stays untouched. Existing quotes
// continue to use quote_skus; new quotes use the new model.
// Migration (impl-1 §4.2) backfills quote_leaves from quote_skus for
// sent quotes.
//
// Brief: docs/cc-phase-a1-v2-impl-brief.md §3
// Architect commit: docs/architect/phase-a1-v2-schema-commit.md
// Dispositions: docs/cc-phase-a1-v2-edward-dispositions.md (§15)
//
// Naming convention: tables named per CD designer notes vocabulary
// — `assemblies` (ASY = quotable SKU) + `leaves` (LEAF = reusable
// component under ASYs). Library scope = no quote_id on `leaves`;
// per-quote pinning via `quote_leaves`.

// ---------- product_types (taxonomy; Phase A.1 v2) ----------

// Unified Product Type table with scope discriminator. Seeds 9 ASY
// categories + 8 LEAF types (3 first-class + 1 placeholder + 4
// hidden) at migration time per Edward §15.1 + §15.2.
//
// `field_schema` JSONB is null for placeholder + hidden types; set
// for first-class leaf types (PP / SP / TP — Edward §15.2 TP starter
// schema). PP + SP schemas inherited from CD designer notes; CD
// refines at SpecEntry design time.
//
// Validation strategy (Architect Gate 1): app-side validation
// against field_schema; no Postgres-side JSON schema enforcement.
//
// `placeholder` flag: type-picker renders placeholder treatment
// (empty fields + "schema pending" copy) for these in v1.
// `hidden` flag: type doesn't appear in type-picker dropdowns;
// legacy data referencing them still renders correctly.
export const productTypes = pgTable(
  "product_types",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    scope: productTypeScope("scope").notNull(),
    description: text("description"),
    fieldSchema: jsonb("field_schema"),
    placeholder: boolean("placeholder").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Type-picker queries filter visible types by scope
    // (Architect Gate 1 recommended index).
    index("product_types_scope_idx").on(t.scope).where(sql`hidden = false`),
  ],
);

// ---------- assemblies (per-quote quotable SKUs; Phase A.1 v2) ----------

// ASY = quotable SKU. Has commercial fields (unit_price, margin,
// markup, tax_schedule_id). ASY-level Product Type for
// categorization (Skincare / Supplement / Body / etc.). NO specs at
// the ASY level — specs live on child LEAFs.
//
// Per Architect §0.5 Gate 1 amendment: keyed on `quote_id`, not on
// a phantom `scenario_id`. Scenarios are denormalized onto `quotes`
// (per CLAUDE.md Pattern 22 RI.9 precedent); assemblies follow the
// same model. Matches `bulk_raw_section_meta` pattern.
//
// `internal_notes` surfaces in Setup tree view's HAS NOTE chip.
// `position` drives tree-order rendering.
export const assemblies = pgTable(
  "assemblies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    packLabel: text("pack_label"),
    productTypeId: text("product_type_id").references(() => productTypes.id),
    description: text("description"),
    url: text("url"),
    imageUrl: text("image_url"),
    unitPrice: numeric("unit_price"),
    unitCost: numeric("unit_cost"),
    marginPct: numeric("margin_pct"),
    markupPct: numeric("markup_pct"),
    taxScheduleId: uuid("tax_schedule_id"),
    ownerId: uuid("owner_id").references(() => users.id),
    fscClaim: boolean("fsc_claim"),
    fscStatus: text("fsc_status"),
    supplierVerified: boolean("supplier_verified"),
    internalNotes: text("internal_notes"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Unique SKU per quote (allows same SKU across different quotes).
    uniqueIndex("assemblies_quote_sku_idx").on(t.quoteId, t.sku),
    // Tree-order rendering on Setup surface.
    index("assemblies_quote_position_idx").on(t.quoteId, t.position),
  ],
);

// ---------- leaves (globally-scoped reusable library; Phase A.1 v2) ----------

// LEAF = reusable component nested under ASYs via assembly_leaves.
// Has identity + leaf-level Product Type for spec rendering + spec
// values (in leaf_specs). **No quote_id** — globally scoped library
// shared across quotes/scenarios. References tracked via
// assembly_leaves (which keys on assembly_id → quote_id).
//
// `archived` soft-delete flag: ON DELETE RESTRICT on leaf_id in
// assembly_leaves + quote_leaves prevents hard delete when refs
// exist; `archived = true` is the recommended retire path. Indexes
// filter on `archived = false` for library browse performance.
export const leaves = pgTable(
  "leaves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sku: text("sku"),
    url: text("url"),
    imageUrl: text("image_url"),
    productTypeId: text("product_type_id").references(() => productTypes.id),
    unitCost: numeric("unit_cost"),
    fscClaim: boolean("fsc_claim"),
    fscStatus: text("fsc_status"),
    supplierVerified: boolean("supplier_verified"),
    ownerId: uuid("owner_id").references(() => users.id),
    archived: boolean("archived").notNull().default(false),
    // slice-hubspot-bidirectional — HubSpot Product association.
    // NULL = Nexus-local library leaf (no HubSpot record). NOT NULL
    // = HubSpot-authoritative leaf created via canonical Add Product
    // modal LEAF mode (HubSpot-first pattern) OR pulled from
    // HubSpot via pullFromHubSpot. Unique partial index below
    // prevents duplicate HubSpot Product attachments.
    hubspotProductId: text("hubspot_product_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Library browse by type (filter on archived for active set).
    index("leaves_product_type_idx")
      .on(t.productTypeId)
      .where(sql`archived = false`),
    // Library search by SKU.
    index("leaves_sku_idx").on(t.sku).where(sql`archived = false`),
    // slice-hubspot-bidirectional — partial index over archived
    // rows. Complements the existing `archived = false` partial
    // indexes above; supports admin queries that surface archived
    // library leaves (PM workflow rarely touches archived, but
    // audit + reconciliation paths benefit).
    index("leaves_archived_idx").on(t.archived).where(sql`archived = true`),
    // slice-hubspot-bidirectional — unique partial index on
    // hubspot_product_id WHERE NOT NULL. Two leaves can't share
    // the same HubSpot Product; NULL is allowed for unlimited
    // Nexus-local leaves. Mirrors the legacy
    // `quote_skus_hubspot_product_id_idx` (non-unique) pattern but
    // strict-unique here because library leaves are globally
    // scoped (one row per HubSpot Product across all quotes).
    uniqueIndex("leaves_hubspot_product_id_idx")
      .on(t.hubspotProductId)
      .where(sql`hubspot_product_id is not null`),
  ],
);

// ---------- assembly_leaves (M:N junction; Phase A.1 v2) ----------

// Junction table linking assemblies (per-quote ASYs) to leaves
// (global library). One row per (assembly, leaf) attachment.
//
// `parent_assembly_leaf_id` self-referential FK supports future
// deeper-nesting workflows (leaves under leaves). Per Architect
// Gate 3 + Edward §15 disposition: v1 ALWAYS NULL — app-side guard
// in attach actions prevents non-NULL parent. Schema allows
// nesting; workflow not yet designed.
//
// **Architect Gate 3 unique-index disposition**: the broad
// `unique (assembly_id, leaf_id, parent_assembly_leaf_id)`
// constraint from the brief is permissive for non-NULL parents
// (Postgres treats NULLs as distinct by default). For v1 (always-
// NULL parent), the canonical "one row per (assembly, leaf) at
// top level" guarantee comes from a partial unique INDEX (not
// constraint):
//
//   create unique index assembly_leaves_top_level_unique_idx
//     on assembly_leaves (assembly_id, leaf_id)
//     where parent_assembly_leaf_id is null;
//
// This enforces uniqueness at top level (the only v1 case) while
// leaving future nested cases unconstrained until the workflow
// lands.
//
// `ON DELETE RESTRICT` on leaf_id: prevents accidental library
// leaf deletion when references exist. Soft archive is the path.
// `ON DELETE CASCADE` on assembly_id + parent_assembly_leaf_id:
// when an ASY is deleted, its assembly_leaves rows cascade; when
// a parent assembly_leaf is removed, its children cascade.
export const assemblyLeaves = pgTable(
  "assembly_leaves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assemblyId: uuid("assembly_id")
      .notNull()
      .references(() => assemblies.id, { onDelete: "cascade" }),
    leafId: uuid("leaf_id")
      .notNull()
      .references(() => leaves.id, { onDelete: "restrict" }),
    quantity: numeric("quantity").notNull().default("1"),
    position: integer("position").notNull().default(0),
    // Self-referential FK; nullable; ALWAYS NULL in v1 (app-side
    // guard). Type annotation via AnyPgColumn to satisfy Drizzle's
    // type-checker on the self-reference.
    parentAssemblyLeafId: uuid("parent_assembly_leaf_id").references(
      (): AnyPgColumn => assemblyLeaves.id,
      { onDelete: "cascade" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Partial unique index — v1 enforcement of one-row-per-(ASY,
    // leaf) at top level. Future deeper-nesting workflow can
    // extend without retrofitting this index.
    uniqueIndex("assembly_leaves_top_level_unique_idx")
      .on(t.assemblyId, t.leafId)
      .where(sql`parent_assembly_leaf_id IS NULL`),
    // Tree-order rendering.
    index("assembly_leaves_assembly_position_idx").on(
      t.assemblyId,
      t.position,
    ),
    // Reference-count + cascade-warning queries (count refs per
    // library leaf across ASYs / scenarios).
    index("assembly_leaves_leaf_idx").on(t.leafId),
  ],
);

// ---------- leaf_specs (versioned spec values; Phase A.1 v2) ----------

// Per-leaf spec values, versioned. ONE current row per leaf via
// partial unique index on (leaf_id) where is_current = true.
//
// Versioning semantics (Architect Gate 2 + brief §3.5 clarification):
//
// - First spec entry: insert with version_number=1, is_current=true.
// - Subsequent EDITS between pin events: UPDATE the current row's
//   spec_values in place. Same row; no version bump. This is the
//   common case (PMs iterate on specs during quote authoring).
// - At quote pin event (quote send time): close current row by
//   setting effective_to = now() + is_current = false; INSERT new
//   row with bumped version_number + is_current = true + initial
//   spec_values copied from prior current. Audit emits
//   `leaf_spec_version_pin` action (system event).
// - Historical pinned versions queryable by version_number. quote_
//   leaves.leaf_spec_version_id pins to a specific historical
//   leaf_specs row.
//
// Validation: app-side `spec_values` validation against the leaf's
// product_type.field_schema. Unknown keys rejected. Required fields
// (when type schema declares `required: true`) enforced at save.
//
// Per Architect Gate 2: chose single-table-with-is_current over
// separate `leaf_spec_versions` history. Acceptable for v1 scale
// (~100s of leaves × ~12 users); revisit if performance surfaces.
export const leafSpecs = pgTable(
  "leaf_specs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leafId: uuid("leaf_id")
      .notNull()
      .references(() => leaves.id, { onDelete: "cascade" }),
    specValues: jsonb("spec_values").notNull().default(sql`'{}'::jsonb`),
    versionNumber: integer("version_number").notNull().default(1),
    isCurrent: boolean("is_current").notNull().default(true),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    // Partial unique — one current row per leaf. Enforces "the
    // current spec for leaf X is unique" while allowing multiple
    // historical versions.
    uniqueIndex("leaf_specs_current_idx")
      .on(t.leafId)
      .where(sql`is_current = true`),
    // Historical version lookup (pin-time queries +
    // version-comparison views).
    index("leaf_specs_leaf_version_idx").on(t.leafId, t.versionNumber),
  ],
);

// ---------- quote_leaves (per-quote pinning; Phase A.1 v2) ----------

// Per-quote pinning of leaf-spec versions. One row per
// (quote, assembly, leaf) triple. `leaf_spec_version_id` references
// the specific leaf_specs row pinned at send time; NULL for draft
// quotes (drafts auto-update; sent quotes stay pinned).
//
// `assembly_id` carried alongside `leaf_id` for query convenience
// (per-quote per-ASY views read directly without re-joining
// assembly_leaves).
//
// `pinned_at` records the timestamp the leaf was pinned (matches
// send_event audit row).
//
// ON DELETE behavior:
//   - quote_id CASCADE — quote delete cascades pinnings
//   - assembly_id CASCADE — ASY delete within quote cascades
//   - leaf_id RESTRICT — prevents accidental library leaf delete
//     when pinnings reference it
//   - leaf_spec_version_id no FK action — pinned version stays
//     even if it's no longer current
export const quoteLeaves = pgTable(
  "quote_leaves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    assemblyId: uuid("assembly_id")
      .notNull()
      .references(() => assemblies.id, { onDelete: "cascade" }),
    leafId: uuid("leaf_id")
      .notNull()
      .references(() => leaves.id, { onDelete: "restrict" }),
    leafSpecVersionId: uuid("leaf_spec_version_id").references(
      () => leafSpecs.id,
    ),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    quantity: numeric("quantity").notNull().default("1"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Per-quote queries (PDF render, soft-gate check, etc.).
    index("quote_leaves_quote_idx").on(t.quoteId),
    // "Where is this spec version pinned?" queries (replenishment
    // view + cascade-warning lookups).
    index("quote_leaves_leaf_version_idx").on(t.leafId, t.leafSpecVersionId),
  ],
);

// ---------- quote_attachments (canonical scenario-create flow) ----------

// PM-internal documents attached to a quote (scenario). Captures the
// customer's brief / RFQ / supporting docs at scenario creation or
// post-creation via the Setup-surface attachment list affordance.
//
// Pattern 45 boundary discipline — `quote_attachments` is PM-internal.
// MUST NOT be imported from src/components/pdf/ (verifier blocks
// @/db/schema imports from pdf/ subtree at build time).
//
// Files live in Supabase Storage bucket `quote-attachments` at path
// convention `{quote_id}/{uuid}-{filename}`. Storage RLS limits read/
// write/delete to authenticated users (canonical scenario-create
// flow manual SQL applies the policies). Action layer validates
// file size (≤25 MB) and MIME type allowlist (PDF, Word, Excel,
// images, plain text).
//
// `uploaded_by` FK to users tracks attribution; hard delete on
// quote (ON DELETE CASCADE) drops attachments when the parent quote
// is removed. Attachment removal (action `removeQuoteAttachment`)
// hard-deletes BOTH the row and the Storage object; audit row
// `quote_attachment_removed` carries pre-delete snapshot.
export const quoteAttachments = pgTable(
  "quote_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    storageUrl: text("storage_url").notNull(),
    mimeType: text("mime_type"),
    fileSizeBytes: integer("file_size_bytes"),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
  },
  (t) => [
    // Per-quote attachment list queries (Setup surface + project
    // detail scenario card chip).
    index("quote_attachments_quote_id_idx").on(t.quoteId),
  ],
);

// ---------- Slice 11.5 — NEW-model cost-data extension tables ----------
//
// Path B per Slice 11.5 brief §2. Four sparse-row tables align the
// NEW model (assemblies + assembly_leaves + quote_leaves + leaves)
// with the math layer's `QuoteCostingInput` shape. Each mirrors an
// OLD-model table semantically; the adapter
// (`src/lib/costing-adapter.ts`, lands Step 3) does straightforward
// translation. OLD tables (`packaging_inputs`, `production_inputs`,
// `quote_sku_tiers`, `quote_sku_tier_targets`, `quote_skus`) drop
// in Step 8.
//
// Math layer is the load-bearing surface; this slice swaps the data
// source feeding it without touching the math. See CLAUDE.md "Math
// layer is the load-bearing surface" (landed Step 8) for the
// architectural commitment.

// ---------- assembly_leaf_inputs (Slice 11.5; mirrors packaging_inputs) ----------
//
// Per-cell packaging cost data keyed by (assembly_leaf, tier).
// Direct semantic analog of `packaging_inputs` keyed by
// (quote_sku, tier); the assembly_leaves table is the NEW-model
// analog of the OLD-model leaf SKU row.
//
// `line_group_id` (v2 A3 semantics): synthetic UUID grouping rows
// that represent the SAME logical packaging line across tiers
// (e.g., one bottle supplier line × 3 tier variants = 3 rows
// sharing one line_group_id). NOT a FK; UUIDs are minted client-side
// on line creation (action layer `addAssemblyLeafInput` generates
// via `crypto.randomUUID()` on the first row + reuses for tier
// siblings). Pattern carries through from OLD `packaging_inputs`
// semantics.
//
// Line-level fields (supplier, qty_per_sellable_unit, category,
// markup_pct, markup_pct_source, inventory_eligible, notes,
// sort_order) duplicate across tier rows of the same line_group_id;
// mass updates of line metadata happen at the action layer via
// line_group_id. Per-tier fields are unit_cost and purchase_qty.
//
// `markup_pct_source` reuses the existing `markupPctSource` enum
// (`category_default` / `manual_override`) per the same sticky-
// override semantics as packaging_inputs.
//
// No FK on category to markup_defaults — soft reference; Slice 9's
// vocabulary swap rewrites both sides.
export const assemblyLeafInputs = pgTable(
  "assembly_leaf_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assemblyLeafId: uuid("assembly_leaf_id")
      .notNull()
      .references(() => assemblyLeaves.id, { onDelete: "cascade" }),
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

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One row per (assembly_leaf, line, tier). Prevents duplicate cells.
    uniqueIndex("assembly_leaf_inputs_line_tier_idx").on(
      t.assemblyLeafId,
      t.lineGroupId,
      t.tierId,
    ),
    index("assembly_leaf_inputs_assembly_leaf_id_idx").on(t.assemblyLeafId),
    index("assembly_leaf_inputs_tier_id_idx").on(t.tierId),
    index("assembly_leaf_inputs_line_group_id_idx").on(t.lineGroupId),
  ],
);

// ---------- assembly_production_inputs (Slice 11.5; mirrors production_inputs) ----------
//
// Per-assembly-tier production policy + per-tier service-fee cost
// inputs. Keyed by (assembly_id, tier_id) — one row per assembly
// per tier, matching the OLD-model "per leaf SKU × tier" cardinality
// (assemblies in the NEW model occupy the production-policy role
// that leaf SKUs held in the OLD model).
//
// Denormalization (mirrors production_inputs): customer_ships_raws,
// allocate_service_fees_to_cost, and notes are per-assembly policy,
// fanned across all tier rows for that assembly by the action
// layer's `updateAssemblyProductionPolicy`. Reading any one tier row
// gives the policy.
//
// `bulk_raw_cost` survives the customer_ships_raws toggle — CSS-hide
// / data-preserved semantics; toggling back restores the value.
// Matches OLD-model production_inputs semantics.
//
// Cascade: tier delete and assembly delete both ON DELETE CASCADE.
export const assemblyProductionInputs = pgTable(
  "assembly_production_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assemblyId: uuid("assembly_id")
      .notNull()
      .references(() => assemblies.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),

    // Per-assembly policy (denormalized across this assembly's tier rows).
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
    uniqueIndex("assembly_production_inputs_assembly_tier_idx").on(
      t.assemblyId,
      t.tierId,
    ),
    index("assembly_production_inputs_assembly_id_idx").on(t.assemblyId),
    index("assembly_production_inputs_tier_id_idx").on(t.tierId),
  ],
);

// ---------- assembly_leaf_overrides (Slice 11.5; mirrors quote_sku_tiers) ----------
//
// Sparse sell-price overrides per (assembly_leaf, tier). Direct
// semantic analog of `quote_sku_tiers` per Slice 9.3, with the unit
// of override now (assembly_leaf, tier) — sharper than the old
// "quote_sku" framing per brief §2.
//
// Lazy-row pattern (mirrors quote_sku_tiers):
//   - Action `updateAssemblyLeafOverride(assemblyLeafId, tierId,
//     value | null)`: value > 0 → INSERT ON CONFLICT DO UPDATE;
//     value === null → DELETE.
//   - Action layer rejects value <= 0 (non-positive prices break
//     partition revenue math).
//   - Read paths LEFT JOIN this table; absent row reads as "no
//     override."
//
// numeric(10,4) matches `quote_sku_tiers.sell_price_override`
// precision; NOT NULL enforces "row exists ⟹ override is set"
// invariant at the schema level.
export const assemblyLeafOverrides = pgTable(
  "assembly_leaf_overrides",
  {
    assemblyLeafId: uuid("assembly_leaf_id")
      .notNull()
      .references(() => assemblyLeaves.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),
    sellPriceOverride: numeric("sell_price_override", {
      precision: 10,
      scale: 4,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.assemblyLeafId, t.tierId] }),
    index("assembly_leaf_overrides_tier_id_idx").on(t.tierId),
  ],
);

// ---------- assembly_leaf_targets (Slice 11.5; mirrors quote_sku_tier_targets) ----------
//
// Sparse client target benchmarks per (assembly_leaf, tier). Direct
// semantic analog of `quote_sku_tier_targets` per Slice 9.4b — the
// customer's stated target price per cell, feeding the two-axis
// verdict + reverse-solve affordance.
//
// Lazy-row pattern + audit pattern mirror assembly_leaf_overrides:
//   - Action `updateAssemblyLeafTarget(assemblyLeafId, tierId,
//     value | null)`: INSERT ON CONFLICT DO UPDATE / DELETE.
//   - entity_type = "assembly_leaf_target" (audit_log.entity_id
//     text), entity_id = synthesized `${assemblyLeafId}:${tierId}`.
//
// numeric(10,4) matches override precision; NOT NULL enforces
// "row exists ⟹ benchmark is set" invariant.
export const assemblyLeafTargets = pgTable(
  "assembly_leaf_targets",
  {
    assemblyLeafId: uuid("assembly_leaf_id")
      .notNull()
      .references(() => assemblyLeaves.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),
    clientTargetPricePerUnit: numeric("client_target_price_per_unit", {
      precision: 10,
      scale: 4,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.assemblyLeafId, t.tierId] }),
    index("assembly_leaf_targets_tier_id_idx").on(t.tierId),
  ],
);
