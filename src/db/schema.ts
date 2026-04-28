import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
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
