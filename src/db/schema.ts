import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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

// quote_skus is a REFERENCE to a HubSpot Product. hubspot_product_id is
// required and is the only canonical link — Nexus does not own product
// vocabulary (categorization, classification, type). The two snapshot
// fields below come from HubSpot at insert time and refresh on demand,
// solely for fast display without re-fetching. Markup categorization is
// out of scope here and lands in Slice 9 against a different vocabulary.
//
// Slice 12 writeback must refuse to push any quote_sku missing
// hubspot_product_id (defensive — the NOT NULL constraint is the
// primary guard).
export const quoteSkus = pgTable(
  "quote_skus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    hubspotProductId: text("hubspot_product_id").notNull(),
    // Snapshot from HubSpot product: hs_sku → sku_label, name → product_name.
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("quote_skus_quote_id_idx").on(t.quoteId),
    index("quote_skus_hubspot_product_id_idx").on(t.hubspotProductId),
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
