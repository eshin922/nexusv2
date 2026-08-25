import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
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
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------- enums ----------

/**
 * Nexus application roles. NOT Entra or Clerk roles — the identity provider
 * authenticates; Nexus decides what an authenticated person may do.
 *
 * Ordered by authority, `read_only` last.
 *
 * ── WHAT A ROLE DOES AND DOES NOT CARRY ──────────────────────────────────
 *
 * Only `admin` is read for an authorization decision anywhere in the tree
 * (`admin-guard.ts`, `spec-permission-guard.ts`). Every other value is a
 * DESCRIPTIVE LABEL today: `purchasing`, `accounting` and `read_only` appear
 * nowhere outside this file, and `pm` appears once — as the provisioning
 * fallback below, not as a check.
 *
 * That is deliberate, and it is the reason `logistics` and `sales` could be
 * added without inventing gates for them: real authority is carried by
 * narrower, independently-defaulted grants —
 *
 *   role === "admin"      admin surfaces, plus implicit spec/leaf grants
 *   canEditSpecs          default false
 *   canCreateLeaves       default false
 *   commercialApprover    default false, BV-005, never derived from role
 *
 * — so a new role value inherits nothing. It is not privileged by default
 * because nothing consults it.
 *
 * `read_only` is therefore NOT enforced by a guard. It is the honest label for
 * "no grants", which is exactly what an unrostered account has.
 *
 * When per-role gating does arrive it follows the role-as-affordance model in
 * CLAUDE.md — per section, on a shared page — not per route.
 */
export const userRole = pgEnum("user_role", [
  "admin",
  "pm",
  "purchasing",
  "production",
  // Finance maps HERE rather than to a role of its own. A separate `finance`
  // value would have been a synonym nothing distinguished.
  "accounting",
  // Freight and shipment work. No admin authority, no spec or leaf grants, no
  // commercial approval.
  "logistics",
  // Quote authoring alongside PMs. Same absence of implied grants.
  "sales",
  "read_only",
]);

/**
 * Whether a `users` row has yet been attached to a Clerk identity (#327).
 *
 * STATED, not inferred from the nullity of `clerk_user_id`. Inferring it would
 * make an unprovisioned row and a deliberately pre-authorized one the same
 * thing — the OD-027 ambiguity in a new place. A DB CHECK ties the two together
 * so the statement and the handle can never disagree.
 *
 * `pending_first_sign_in` is reachable ONLY by an admin provisioning a row
 * ahead of the person's first login. The transition to `bound` is one-way and
 * happens once; no sign-in path may write `clerk_user_id` on a row that already
 * has one.
 */
export const userBindingState = pgEnum("user_binding_state", [
  "pending_first_sign_in",
  "bound",
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
  // Slice 12 Step 2 — terminal + non-editable state marking a quote
  // whose Tier Selection Advance has fired (NetSuite SO push landed).
  // Pattern 52 immutability lock relocates here from `sent` (per v3
  // brief §5). Revise action (Step 6) allows sent → draft +
  // accepted → draft transitions; `complete` blocks them (admin
  // override only; v1.5+).
  "complete",
]);
export type QuoteStatus = (typeof quoteStatus.enumValues)[number];

// Slice 12 Step 3 — Client Review feed event types (v3 brief §5.1
// Round 3 amendment 1). pgEnum, not text, so bad values fail at the
// DB. Extensible via `ALTER TYPE ADD VALUE`.
//   - sent:              system-generated; auto-logged by sendQuote
//                        (Step 5) as the feed's first entry per §0
//                        Round 4 disposition (`system=true`).
//   - responded:         PM-authored — customer replied.
//   - asked:             PM-authored — you asked them something.
//   - revision_requested: PM-authored — grows inline "↺ Revise"
//                        affordance (R8 designer notes §4).
export const quoteReviewEventType = pgEnum("quote_review_event_type", [
  "sent",
  "responded",
  "asked",
  "revision_requested",
]);

export const scenarioStatus = pgEnum("scenario_status", [
  "active",
  "dropped",
  "accepted",
]);

/**
 * Who an audit row terminates in — Gate 1A actor model. A pgEnum rather than
 * text so a third kind cannot appear by typo; adding one should be a decision,
 * since each kind is a claim about what the trace means when it stops there.
 */
export const auditActorKind = pgEnum("audit_actor_kind", ["human", "system"]);

export const acceptSource = pgEnum("accept_source", [
  "manual_button",
  "hubspot_stage_change",
  "api",
]);

// Slice 12 Step 8a — how the CUSTOMER communicated their acceptance
// ("email" / "call" / "portal" / "other"). Orthogonal to `accept_source`
// which records how NEXUS captured the acceptance (button click,
// HubSpot webhook, direct API). Merging the two enums would collide
// two distinct semantics (a manual_button accept is not mutually
// exclusive with the customer having emailed their yes) — kept
// separate per Architect §0.5 verdict on R9's proposed
// `quote_acceptance` object.
export const customerResponseChannel = pgEnum("customer_response_channel", [
  "email",
  "call",
  "portal",
  "other",
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

/**
 * What a Product Library entry may be SOLD AS. BV-012 §5.
 *
 * Distinct from `leaves.hubspot_product_type`, which is an upstream vendor
 * taxonomy describing what the thing physically IS and from which spec-field
 * behaviour is derived. This is a Nexus governed statement about commercial
 * identity — and Step 9's "two authorities for one question" lesson is
 * respected because these are two questions, not two answers to one.
 */
export const leafCommercialKind = pgEnum("leaf_commercial_kind", [
  "product",
  "service",
]);

/**
 * The closed V1 Direct Service vocabulary — BV-012 §5.f.
 *
 * An enum precisely BECAUSE it is closed. BV-011's other destinations (Setup,
 * Tooling, Artwork, Dies, Print Plates, Samples, Processing Fee,
 * Freight/Duties/Tariffs, Customs, Cartons, Bulk Raw) are deliberately not
 * sellable on their own, and promoting one should require a migration that
 * says so rather than a new string at a call site.
 *
 * The identity also determines which Production input the Costs surface
 * exposes: a Filling service exposes filling, not formulation.
 */
export const bv011Destination = pgEnum("bv011_destination", [
  "otc_filling",
  "otc_packout",
  "otc_raws",
  "otc_freight_duties_tariffs",
  "otc_customs",
  "otc_setup",
  "otc_artwork",
  "otc_tooling",
  "otc_formulation",
  "otc_testing",
  "otc_other_service",
  "otc_dies",
  "otc_print_plates",
  "otc_samples",
  "otc_processing_fee",
  "otc_cartons",
]);

export const directServiceIdentity = pgEnum("direct_service_identity", [
  "formulation",
  "filling_blending",
  "packout_assembly",
  "testing_micros",
  "other_service",
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
export const freightFactSource = pgEnum("freight_fact_source", [
  "manual",
  "imported",
  "corrected_after_import",
]);
export const freightCustomsSource = pgEnum("freight_customs_source", [
  "invoice",
  "estimate",
]);
export const freightCustomsChargeType = pgEnum("freight_customs_charge_type", [
  "duty",
  "tariff",
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
    /**
     * NULLABLE since #327: a pre-authorized row exists before the person has
     * ever reached Clerk. Null means "no identity attached yet", and is legal
     * ONLY while `bindingState` is `pending_first_sign_in` (DB CHECK).
     *
     * Unique, which is also the structural guarantee that one Clerk identity
     * cannot be claimed by two Nexus rows — the binding checks for that too,
     * so the refusal is legible, but the constraint is the thing that makes it
     * impossible rather than merely unlikely.
     */
    clerkUserId: text("clerk_user_id").unique(),
    email: text("email").notNull().unique(),
    name: text("name"),
    role: userRole("role").notNull().default("read_only"),
    /**
     * BV-005 Commercial Approver authority — Track A disposition 1c.
     *
     * DELIBERATELY NOT A ROLE, and deliberately not derived from `admin`.
     * BV-005: authority "must not be hardcoded to the `admin` role", and admin
     * may ADMINISTER the list without being on it. Its own column so that
     * separation is structural rather than a convention a later refactor can
     * quietly collapse into `role === "admin"`.
     *
     * Defaults false, and is NOT seeded. Membership is assigned after
     * organisation-tenant SSO, when distinct staff identities exist — the three
     * pre-SSO rows in production today are all the same person, so seeding from
     * them would manufacture an independence the estate does not have.
     */
    commercialApprover: boolean("commercial_approver").notNull().default(false),
    /**
     * #327 · pre-authorized first-sign-in binding.
     *
     * DEFAULT 'bound' is load-bearing for deployment order, not a convenience:
     * the deployed `ensure-user` INSERT does not mention this column, and with
     * NOT NULL and no default that INSERT would have started failing the moment
     * the migration applied — the 0066 outage shape. A row that supplies a
     * clerk_user_id IS bound, so the default is also correct on its merits.
     *
     * An admin provisioning ahead of first login states
     * `pending_first_sign_in` explicitly.
     */
    bindingState: userBindingState("binding_state").notNull().default("bound"),
    /**
     * Durable Slack↔Nexus identity binding (`U…`).
     *
     * Email is a BOOTSTRAP only: the first successful Slack decision resolves
     * Slack id → verified Slack email → unique Nexus user, then persists the id
     * here. Every later callback uses THIS binding and ignores email.
     *
     * If a stored binding and a Slack email later disagree, the decision fails
     * closed — rebinding is an administrative act, never an inference from a
     * changed email. Unique so two Slack accounts cannot claim one Nexus user.
     */
    slackUserId: text("slack_user_id").unique(),
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
    /**
     * Fixture, certification lineage or smoke artefact — not customer work.
     *
     * Set once, from an explicit list of 13 project ids (migration 0097), and
     * read as a column thereafter. The Deal Organizer hides these by default.
     *
     * DELIBERATELY NOT A NAME MATCH. `MISTR - Sachet Rollstock Test Roll` is a
     * real customer deal, so any `%test%` heuristic hides real work — a queue
     * that silently drops a live deal is worse than one that shows a fixture.
     */
    isTest: boolean("is_test").notNull().default(false),
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
    // Slice 12 Step 3 — FK tightened SET NULL → RESTRICT per v3 brief
    // §5. Once a tier is bound as the accepted tier (Mark Accepted or
    // Tier Selection Advance), it can't be deleted out from under the
    // quote. All current writers of `accepted_tier_id` are on quotes
    // whose status transitions to accepted/complete, so no draft-time
    // tier delete could hit a non-null accepted_tier_id today.
    acceptedTierId: uuid("accepted_tier_id").references(
      (): AnyPgColumn => quoteTiers.id,
      { onDelete: "restrict" },
    ),
    acceptSource: acceptSource("accept_source"),
    // Slice 12 Step 8a — captured at acceptance alongside `accept_source`.
    // Nullable; set by markAccepted from PM's sub-tab-4 source picker.
    // Enum + column separation per Architect §0.5 verdict — see
    // customerResponseChannel pgEnum definition above for the rationale.
    customerResponseChannel: customerResponseChannel(
      "customer_response_channel",
    ),
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
    freightMarkupPct: numeric("freight_markup_pct", { precision: 5, scale: 4 })
      .notNull()
      .default("0.3000"),
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
    // Slice 12 Step 3 — NetSuite SO push writebacks per v3 brief §4.7.
    // Set at Tier Selection Advance (Step 8) when the SO is created
    // in NetSuite. Both NULL until then; Pattern 52 immutability locks
    // once `quote.status = 'complete'`.
    netsuiteSoId: varchar("netsuite_so_id", { length: 50 }),
    netsuitePushedAt: timestamp("netsuite_pushed_at", {
      withTimezone: true,
    }),
    // Slice 12 Step 8c-3 additions — mirror the SO's display id +
    // last-push status/error onto the quote row for fast reads by
    // sub-tab 5's success/failure surface (avoids joining to
    // netsuite_so_pushes for every render). netsuite_so_pushes remains
    // the source of truth for retry-idempotency + audit trail.
    netsuiteSoTranid: text("netsuite_so_tranid"),
    netsuiteSoPushStatus: text("netsuite_so_push_status"),
    netsuiteSoPushError: text("netsuite_so_push_error"),
    // Slice 12 Step 7b fix-pass (CA review Item #1) — durable
    // pre-write for HubSpot from_stage capture. Populated OUTSIDE
    // the markAccepted tx BEFORE the HubSpot deal-stage push fires;
    // cleared INSIDE the successful tx. On retry after a
    // HubSpot-succeeds-DB-fails failure, markAccepted reads this
    // column instead of re-querying the deal (which by then holds
    // the target stage, poisoning the from_stage snapshot).
    //
    // Rollback source of truth becomes idempotent: whether accept
    // succeeds first try or after N retries, the from_stage_id
    // written to `quote_accepted.diff_json.hubspot` is the ORIGINAL
    // stage. unmarkAccepted then rolls the deal back to where it
    // actually started, not to where it already sits.
    //
    // NULL post-successful-tx (cleared in the same tx that writes
    // status='accepted'). NULL also for quotes that never entered
    // markAccepted mid-flight.
    pendingHubspotFromStageId: text("pending_hubspot_from_stage_id"),
    // Slice 12 Step 7b fix-pass round 2 (CA re-review) — version-scope
    // the pending capture so an abandoned-attempt-across-revise cycle
    // doesn't leak stale state.
    //
    // Scenario without this: v1 accept attempt fails mid-flight →
    // pending populated with v1's from_stage → PM abandons + Revises
    // to v2 → someone moves deal externally → PM accepts v2 → retry
    // path trusts pending (still populated from v1) → HubSpot no-op
    // → audit records STALE v1 from_stage as if fresh → later rollback
    // sends deal to a stage it was never at during v2.
    //
    // With this: pending is trusted only when both columns match
    // (id populated AND version === current quote.versionNumber).
    // Cross-version mismatch → treat as stale, overwrite via a fresh
    // getDealStage read. Both columns set + cleared + trusted as a
    // pair.
    pendingHubspotFromStageVersion: integer(
      "pending_hubspot_from_stage_version",
    ),
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

// ---------- Slice 12 Step 5a — Versioned send snapshots ----------
//
// Per-send immutable snapshot of the customer-facing artifact per v3
// brief §5.1 Round 3 amendment 3. Each sendQuote INSERTs one row.
// Revise-in-place (Step 6) closes the prior row via `superseded_at`
// and increments `version_number` on the parent quote; the next send
// INSERTs a fresh row.
//
// Nothing writes to this table in Step 5a — the table ships alone
// (same pattern as `quote_review_events` in Step 3). Step 5b wires
// sendQuote to INSERT here; Step 6 wires Revise to flip
// superseded_at. Reads default `WHERE superseded_at IS NULL` for
// "the current sent version"; audit reads unfiltered for full
// history.
//
// Column choices mirror the snapshot columns on `quotes` today
// (tcs_snapshot, prepared_by_*, pdf_layout, etc.). Those columns on
// quotes REMAIN populated for the current send during transition
// (Step 5b writes both places) — read paths stay unchanged. Column
// removal from quotes deferred to Slice 12 close-out once every
// consumer confirms migration.
//
// `accepted_snapshot_json` moves here per v3 §5.1: acceptance
// snapshot follows the sent version it binds against. Currently
// zero non-null values in prod, so migration is trivial (leave the
// column dormant on quotes; new writes go here).
//
// Indexing:
//   - (quote_id, superseded_at) — current-version lookup (WHERE
//     superseded_at IS NULL); partial-index-worthy but full index
//     is cheap and supports audit reads too
//   - (quote_id, version_number, effective_from DESC) — per-version
//     history lookup (Step 5's version-picker total-column data
//     will consume this)
export const quoteSnapshots = pgTable(
  "quote_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    // Time this snapshot became authoritative (= sent_at at INSERT).
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    // NULL = the current version. Revise (Step 6) sets to now() on
    // the prior row before incrementing quote.version_number and
    // INSERTing a new row.
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    // Send metadata
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    validUntil: date("valid_until"),
    quoteNumber: text("quote_number"),
    // Commercial defaults snapshotted at send time (DEC-7 mirror)
    tcs: text("tcs"),
    paymentTerms: text("payment_terms"),
    leadTime: text("lead_time"),
    incoterms: text("incoterms"),
    daysValid: integer("days_valid"),
    // Prepared-by snapshot (DEC-8 mirror)
    preparedByName: text("prepared_by_name"),
    preparedByEmail: text("prepared_by_email"),
    preparedByPhone: text("prepared_by_phone"),
    // Customer-PDF render axes (Slice 11 Step 4 mirror)
    pdfLayout: pdfLayout("pdf_layout"),
    detailLevel: detailLevel("detail_level"),
    includeSpecAddendum: boolean("include_spec_addendum"),
    // Artifact pointer (Slice 11 Step 6 mirror). Signed URL is 30d;
    // storage path (in audit_log.diff_json.pdf.storagePath) is
    // permanent for regeneration.
    pdfUrl: text("pdf_url"),
    /**
     * The DURABLE identity of the customer PDF for this send.
     *
     * `pdfUrl` above is a 30-DAY SIGNED URL and the code that mints it says so:
     * internal-only, refreshed by re-signing, while "the file itself lives
     * forever". It is a convenience, never the authority.
     *
     * These carry the authority. The order packet re-signs from this path on
     * demand rather than storing a link that expires under it.
     *
     * NULLABLE ON PURPOSE. NULL means the artifact identity could not be
     * established for this snapshot — a state the packet route REPORTS rather
     * than guesses around. Two historical snapshots are in it; both predate
     * artifact persistence entirely. Forcing a value would mean inventing one,
     * which is the failure this exists to prevent.
     */
    pdfStoragePath: text("pdf_storage_path"),
    pdfStorageBucket: text("pdf_storage_bucket"),
    // Accepted-tier snapshot follows the version it binds against
    // (v3 §5.1 amendment 3 — moves from quotes.accepted_snapshot_json).
    // NULL until Mark Accepted; set at that transition (Step 7).
    acceptedSnapshotJson: jsonb("accepted_snapshot_json"),
    // ── M2 · the customer note is frozen like every field beside it ────────
    //
    // It was the only customer-facing text read LIVE on a sent quote. Payment
    // terms, lead time, incoterms and T&Cs all resolve `isSent ? snapshot :
    // live`; the note did not, and nothing captured it here. So editing it
    // after send changed what an already-sent quote said — the customer held
    // one document and Nexus reported another, silently.
    //
    // Written in the send transaction from quotes.customer_facing_notes, which
    // remains the single authored owner. This is the frozen copy, not a second
    // author.
    customerFacingNotes: text("customer_facing_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("quote_snapshots_current_idx").on(t.quoteId, t.supersededAt),
    index("quote_snapshots_version_idx").on(
      t.quoteId,
      t.versionNumber,
      t.effectiveFrom.desc(),
    ),
  ],
);

// ---------- OD-023 · the sent version's rendered representation ----------
//
// THE HISTORICAL INVARIANT
//
//   A sent version must be reconstructable from immutable data, without
//   depending on future costing, pricing, Library, firm-settings or live quote
//   behaviour.
//
// So this stores the CUSTOMER-RENDER INPUTS THEMSELVES, not the inputs that
// produce them. The alternative — snapshot the cost/spec graph and recompute —
// looks more normalised and fails the invariant: it freezes an input set the
// engine must keep interpreting identically forever, so any later change to the
// math silently re-prices quotes that were already sent. That is correctness
// held by the engine not changing rather than by construction.
//
// `quote_snapshots` already carried commercial terms, prepared-by, the three
// PDF axes and `pdf_url`. It carried NO product content: leaf set, Direct vs
// Item Group, membership, order, tiers, spec values, printed prices and service
// fee lines were all re-derived live on every historical read. This is that gap.
//
// WHAT IS *NOT* HERE, deliberately:
//   - No mirror of the header/party/vendor fields. `cpdf_data` already carries
//     vendor, customer and quote in full — adding columns for them would create
//     a second copy that can disagree with the payload the artifact was
//     rendered from, which is the failure this table exists to prevent.
//   - The two freight snapshot tables stay where they are. They record HOW a
//     commercial figure was produced and remain useful provenance; they are not
//     the historical rendering authority. This is.
//
// `schema_version` is load-bearing: a reader that meets an unknown version must
// REFUSE, not guess. A payload shape is a contract with every future reader.
/**
 * The ordered item's specification, as it stood for ONE sent offer.
 *
 * `leaf_specs` answers "what is this product's spec". This answers "what was
 * ordered", and they are different questions the moment anyone edits the first.
 * Nothing freezes the live row — no draft-lock, and for quote scope the
 * versioning columns are inert — so without this table a sent order's spec is
 * whatever the working spec says today.
 *
 * KEYED TO THE SNAPSHOT, not the quote: a quote can be sent more than once and
 * each send is its own offer. Keying to the quote would let a revision
 * overwrite the specification an earlier revision was ordered under.
 *
 * ONE ROW PER ORDERED LEAF, including leaves with no applicable spec — see
 * `disposition`. Absence therefore means "not ordered" and can never mean
 * "spec unknown".
 *
 * IMMUTABLE. A BEFORE UPDATE trigger raises; DELETE stays open so the snapshot
 * FK can cascade. A later revision creates a NEW snapshot rather than editing
 * this one, and the live spec remains freely revisable for future orders —
 * which is the point of freezing here instead of locking there.
 */
export const quoteSnapshotLeafSpecs = pgTable(
  "quote_snapshot_leaf_specs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteSnapshotId: uuid("quote_snapshot_id")
      .notNull()
      .references(() => quoteSnapshots.id, { onDelete: "cascade" }),
    /**
     * The ORDERED ITEM. No FK, deliberately, matching
     * `quote_snapshot_lines.quote_leaf_id`: the working structure may be edited
     * or deleted after a send, and the record of what was ordered must survive
     * someone tidying the quote afterwards.
     */
    quoteLeafId: uuid("quote_leaf_id").notNull(),
    /** Which live authority this was taken from. Explains; never resolves. */
    sourceLeafSpecId: uuid("source_leaf_spec_id"),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    specValues: jsonb("spec_values").notNull().default(sql`'{}'::jsonb`),
    productTypeId: text("product_type_id"),
    /** The PINNED schema the values were authored under. Part of the identity. */
    specSchema: text("spec_schema"),
    schemaDerivedFromType: text("schema_derived_from_type"),
    /** sha256 over canonical values + product type + schema. */
    contentHash: text("content_hash").notNull(),
    /**
     * Why this row looks the way it does — stated, never inferred from an
     * empty `spec_values`.
     *
     *   specified  a schema applies and values are frozen
     *   no_schema  specifications intentionally do not apply — an ANSWER
     *   unmapped   classified, no governed disposition — NOT an answer
     *   no_type    no authoritative Product Type
     */
    disposition: text("disposition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("qsls_snapshot_leaf_unique").on(t.quoteSnapshotId, t.quoteLeafId),
    index("qsls_by_snapshot").on(t.quoteSnapshotId),
    index("qsls_by_leaf").on(t.quoteLeafId),
    index("qsls_by_hash").on(t.contentHash),
  ],
);

export const quoteSnapshotArtifacts = pgTable("quote_snapshot_artifacts", {
  // 1:1 with the version. The snapshot id IS the key — a surrogate would
  // permit two artifacts for one version, and then "which one did the customer
  // get" has no answer.
  quoteSnapshotId: uuid("quote_snapshot_id")
    .primaryKey()
    .references(() => quoteSnapshots.id, { onDelete: "cascade" }),
  schemaVersion: integer("schema_version").notNull(),
  // The full `CpdfData` the artifact rendered from: vendor, customer, quote,
  // tiers, recommendedTierIdx, skus with their printed per-tier prices,
  // serviceFees, freightLines.
  cpdfData: jsonb("cpdf_data").notNull(),
  // `QuoteAddendumData`. NULL when the addendum was off at send — distinct from
  // an empty addendum, which is `{...}` with no meaningful content.
  addendumData: jsonb("addendum_data"),
  // Governed product structure, kept out of the render payload so it is
  // QUERYABLE rather than only printable: canonical `quote_leaves.id` per
  // product, Direct vs grouped, group identity, and explicit ordinals.
  structure: jsonb("structure").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------- Phase 1 — pinned commercial settings ----------
//
// One active Quote-scoped pin is written atomically with each customer-send
// snapshot. Revision supersedes the active pin without deleting it. The
// snapshot FK provides the durable point-in-time association while Quote
// remains the business identity.
export const quoteCommercialSettingsPins = pgTable(
  "quote_commercial_settings_pins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    // OPTIONAL PROVENANCE, not identity (migration 0078).
    //
    // The QUOTE owns the pin — `quote_id` above is NOT NULL and unchanged.
    // This answers the secondary question of WHICH immutable send artifact
    // produced the pin. For a legacy quote sent before the pin mechanism
    // existed, no artifact was ever captured and NULL is the truthful value;
    // the alternative was inventing a `quote_snapshots` row, which would
    // corrupt the record of what was actually sent in order to fix a
    // different problem.
    //
    // UNIQUE is retained and still does its job: Postgres treats NULLs as
    // distinct, so many legacy pins may be NULL while two pins can never
    // claim the same snapshot.
    //
    // A NULL here is only legible alongside `backfillReason` below.
    quoteSnapshotId: uuid("quote_snapshot_id")
      .unique()
      .references(() => quoteSnapshots.id, { onDelete: "cascade" }),
    targetMarginPct: numeric("target_margin_pct", {
      precision: 5,
      scale: 4,
    }).notNull(),
    floorMarginPct: numeric("floor_margin_pct", {
      precision: 5,
      scale: 4,
    }).notNull(),
    freightMarkupPct: numeric("freight_markup_pct", {
      precision: 5,
      scale: 4,
    }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    // NULL for pins written by the live send path. Non-NULL names the
    // migration that wrote this pin and why, so a NULL `quoteSnapshotId`
    // reads as a recorded fact rather than an omission — those are opposite
    // meanings and a NULL alone cannot distinguish them.
    backfillReason: text("backfill_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("quote_commercial_settings_pins_active_idx")
      .on(t.quoteId)
      .where(sql`superseded_at IS NULL`),
    index("quote_commercial_settings_pins_quote_idx").on(
      t.quoteId,
      t.createdAt.desc(),
    ),
  ],
);

// Phase 1 — per-send markup pin.
//
// GRAIN: the unique key is (pin_id, quote_leaf_id, tier_id, category), but
// the VALUE currently depends only on `category`. `prepareQuoteCommercialPin`
// resolves every coordinate against `markup_defaults`, so for a given
// category every (leaf, tier) row in a pin carries the SAME markup_pct by
// construction.
//
// The grain is therefore recording the RESOLUTION COORDINATE — proof of
// which (leaf, tier, category) combinations existed at send time and what
// each resolved to — not storage for varying values. This is deliberate and
// is the forensic record for a sent quote's commercial policy.
//
// WHY PER-LINE MARKUP IS NOT PINNED HERE: a PM's manual per-line override
// lives on `assembly_leaf_inputs.markup_pct`, which is quote-owned and
// draft-locked (Pattern 52). It cannot change after send, so it needs no
// pin. This table exists to freeze FIRM-LEVEL values that CAN change —
// `markup_defaults`, `firm_settings.target/floor_margin_pct`.
//
// ⚠️ TRIPWIRE — DO NOT DELETE THE RESOLVER'S CONFLICT THROW.
// `resolveQuoteCommercialSettings` collapses these rows to
// Record<category, pct> and throws on a same-category disagreement. Given
// the current writer that throw is UNREACHABLE, and it will look like dead
// defensive code. It is not. It is the guard that fires if a future writer
// ever makes markup vary per leaf or per tier — at which point the correct
// response is to WIDEN THE RESOLVER to return per-coordinate values, not to
// remove the throw. Removing it would let a sent quote resolve to an
// arbitrary one of several conflicting markups, silently.
//
// See docs/OPEN_DECISIONS.md and the engineering review finding F2.
export const quoteCommercialMarkupPins = pgTable(
  "quote_commercial_markup_pins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pinId: uuid("pin_id")
      .notNull()
      .references(() => quoteCommercialSettingsPins.id, {
        onDelete: "cascade",
      }),
    quoteLeafId: uuid("quote_leaf_id")
      .notNull()
      .references((): AnyPgColumn => quoteLeaves.id, { onDelete: "restrict" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "restrict" }),
    category: text("category").notNull(),
    chosenRung: text("chosen_rung").notNull(),
    markupPct: numeric("markup_pct", { precision: 5, scale: 4 }).notNull(),
    sourceUserId: uuid("source_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sourceSetAt: timestamp("source_set_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("quote_commercial_markup_pins_resolution_idx").on(
      t.pinId,
      t.quoteLeafId,
      t.tierId,
      t.category,
    ),
    index("quote_commercial_markup_pins_attachment_idx").on(
      t.quoteLeafId,
      t.tierId,
    ),
  ],
);

// ---------- Slice 12 Step 3 — Client Review feed ----------
//
// Append-only PM-facing activity log per v3 brief §4.3 + §5.1 Round 3.
// Every entry captures a discrete customer-review moment on a specific
// sent version of the quote (revision requests, questions, ad-hoc
// responses, system-logged `sent` events).
//
// Design constraints baked into this schema:
//   1. Append-only enforced STRUCTURALLY (no `updated_at`, no
//      `deleted_at`, no soft-delete flag). Actions may only INSERT +
//      SELECT; no UPDATE path exists (v3 §5.1 amendment 1).
//   2. `event_type` is a pgEnum, not text — bad values fail at the DB.
//      Extensible via `ALTER TYPE ADD VALUE` if a new event class
//      lands (`quote_review_event_type` above).
//   3. `version_number` is a plain int (not FK-linked); refers to the
//      quote's `versionNumber` at the time the entry was logged. Kept
//      queryable per-version so the mismatch banner + version chain
//      can filter entries by which sent version they pertain to. FK
//      would require exposing a versioned quote table shape v1 doesn't
//      have (v3 brief §5.1 amendment 1 — FK-able later).
//   4. `system` boolean discriminates auto-logged `sent` entries
//      (Step 5 `sendQuote` sets true) from PM-authored feed adds. Feed
//      UI (Step 6) treats system entries visually (`author: 'system'`
//      per R8 data.js §"review_events") and forensic queries can
//      isolate PM activity via `WHERE system = false`.
//   5. Cascade on `quote_id` delete — feed follows the parent quote
//      (nothing to preserve if the quote itself is gone). Author
//      FK is `SET NULL` (user delete shouldn't nuke history).
//   6. Mirror every write to `audit_log` via
//      `quote_review_event_added` action (Step 6 wires this) per v3
//      Round 3 amendment 1 — forensic replay independent of feed
//      table integrity.
//   7. Composite index `(quote_id, version_number, created_at DESC)`
//      matches the expected read shape: "load this quote's feed,
//      newest first, optionally filtered to a version."
export const quoteReviewEvents = pgTable(
  "quote_review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    eventType: quoteReviewEventType("event_type").notNull(),
    note: text("note"),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    system: boolean("system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("quote_review_events_composite_idx").on(
      t.quoteId,
      t.versionNumber,
      t.createdAt.desc(),
    ),
  ],
);

// ---------- inputs (Slice 5: packaging) ----------

// Per-line markup defaults. Vocabulary is intentionally *temporary* for
// Slice 5 — Slice 9 redefines categories around "line of work" and will
// rewrite both the markup_defaults rows and the category strings on
// existing packaging_inputs rows. Kept as text PK (not enum) so that
// future additions/renames don't require ALTER TYPE migrations.
/**
 * BV-005 1c — the governed below-floor override.
 *
 * Acceptance and completion block below the firm's margin floor. This table is
 * the ONLY door through that block, and it is a door rather than a switch: one
 * row per decision, scoped to exactly one quote version and tier and to the
 * commercial state that was true when the decision was taken.
 *
 * There is no request lifecycle. Edward's disposition took 1c over the full
 * BV-005 workflow for V1: no asynchronous request, no routing, no Slack, no
 * quorum. An authorized approver decides; the gates consult the decision.
 */
export const belowFloorAuthorizations = pgTable(
  "below_floor_authorizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    /** Scoped to ONE version. A revision does not inherit an approval. */
    quoteVersionNumber: integer("quote_version_number").notNull(),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),

    /**
     * What was true at decision time. EVIDENCE, never an input to a later
     * computation — a floor raised afterwards must not rewrite the history of a
     * decision that was correct when it was taken (BV-005: "a later firm-floor
     * change alone does not erase or invalidate historical approval").
     */
    marginAtDecision: numeric("margin_at_decision", { precision: 9, scale: 6 }).notNull(),
    floorAtDecision: numeric("floor_at_decision", { precision: 5, scale: 4 }).notNull(),

    /**
     * The material commercial state, fingerprinted.
     *
     * Invalidation compares this rather than re-deciding what "material" means
     * at each call site — two call sites deciding that separately is how the
     * same word comes to mean two things.
     */
    stateFingerprint: text("state_fingerprint").notNull(),

    approvedByUserId: uuid("approved_by_user_id")
      .notNull()
      .references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    /** NOT NULL: an approval without a why helps an auditor and nobody else. */
    reason: text("reason").notNull(),

    /** Invalidation is a transition, not a delete. The decision was still taken. */
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidatedReason: text("invalidated_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("below_floor_auth_live_idx").on(
      t.quoteId,
      t.quoteVersionNumber,
      t.tierId,
    ),
  ],
);

/**
 * The below-floor APPROVAL REQUEST lifecycle.
 *
 * `below_floor_authorizations` is decision-only: a row is an approval, and a
 * refusal is silence. This table is the missing asynchronous half — who asked,
 * what they asked against, whether anyone has answered, and what the answer was
 * when it was "no".
 *
 * IT AUTHORIZES NOTHING. An approved request PRODUCES an authorization row
 * (`authorizationId`); the Send/Accept gates read only that row and are
 * unchanged. Slack request state is not authorization.
 *
 * DECISION AND DELIVERY ARE ORTHOGONAL. `status` is what a human decided;
 * `deliveryStatus` is whether Slack received the message. A request may be
 * `pending` + `failed`, which authorizes nothing — a delivery state must never
 * imply authority.
 */
export const belowFloorApprovalRequests = pgTable(
  "below_floor_approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Same governed commercial scope as the authorization it may produce.
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    quoteVersionNumber: integer("quote_version_number").notNull(),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),

    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    /** The requester's why. NOT NULL — a request without one is unreviewable. */
    justification: text("justification").notNull(),

    /**
     * The commercial state this request was raised against, from the same
     * `fingerprintCommercialState` the gate uses. Comparing it at decision time
     * is what makes a delayed Slack click supersede rather than authorize.
     */
    stateFingerprint: text("state_fingerprint").notNull(),
    /** Evidence at request time. Never an input to a later computation. */
    marginAtRequest: numeric("margin_at_request", { precision: 9, scale: 6 }).notNull(),
    floorAtRequest: numeric("floor_at_request", { precision: 5, scale: 4 }).notNull(),

    /** 'pending' | 'approved' | 'rejected' | 'superseded' | 'cancelled' */
    status: text("status").notNull().default("pending"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** REQUIRED on reject; optional on approve. */
    decisionReason: text("decision_reason"),
    /** Set only on approval — the join to the governed decision. */
    authorizationId: uuid("authorization_id").references(
      () => belowFloorAuthorizations.id,
    ),

    // Slack message identity, so the projection can be re-synced after a
    // decision. Nexus stays authoritative if the update fails.
    slackChannelId: text("slack_channel_id"),
    slackMessageTs: text("slack_message_ts"),
    /** 'pending' | 'delivered' | 'failed' — orthogonal to `status`. */
    deliveryStatus: text("delivery_status").notNull().default("pending"),
    deliveryError: text("delivery_error"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * At most ONE live request per governed commercial scope. Structural, not
     * conventional: a second pending request cannot be inserted at all, so
     * duplicate Slack messages competing to authorize one tier is not a state
     * the system can reach.
     */
    uniqueIndex("below_floor_request_pending_idx")
      .on(t.quoteId, t.quoteVersionNumber, t.tierId)
      .where(sql`status = 'pending'`),
    index("below_floor_request_quote_idx").on(t.quoteId),
  ],
);

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
    freightMarkupPctDefault: numeric("freight_markup_pct_default", {
      precision: 5,
      scale: 4,
    })
      .notNull()
      .default("0.3000"),
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
    /**
     * Designated Slack channel for governed below-floor approval requests.
     *
     * GOVERNED CONFIGURATION, NOT A SECRET — it belongs here rather than in env
     * so an admin can change it without a deploy and the change is versioned
     * and audited like every other firm policy. The bot token and signing
     * secret remain environment secrets.
     *
     * MUST participate in `versionedFirmSettingsUpdate` carry-forward, or a
     * later margin-only edit silently clears the channel and approval requests
     * stop being delivered while nothing reports an error.
     */
    slackApprovalChannelId: text("slack_approval_channel_id"),
    // Slice 12 Step 3 — external-system defaults per v3 brief §5 +
    // Q4/Q5 dispositions. Configurable per firm; Step 7 (HubSpot
    // push) + Step 8 (NetSuite push) read the current row.
    //
    // Both carry-forward through `versionedFirmSettingsUpdate` per
    // CLAUDE.md "Versioned-table carry-forward audit" (HARD GATE
    // per v3 brief §5): once a new versioned row is inserted for a
    // margin edit, unchanged columns preserved from the prior row.
    // Default is the DPS Sales pipeline "Won - In production" INTERNAL
    // STAGE ID (not the label — labels are editable in the HubSpot UI;
    // ids are stable). Per Slice 12 Step 7b fix pass + Step 10 §0.5
    // reconciliation. Old default 'Closed Won' was a v3-brief §4.6
    // assumption that didn't match the actual pipeline shape.
    hubspotDealStageOnAccept: text("hubspot_deal_stage_on_accept")
      .notNull()
      .default("195607084"),
    netsuiteSoStatusOnCreate: text("netsuite_so_status_on_create")
      .notNull()
      .default("Pending Fulfillment"),
    // Slice 12 Step 8c-3 — NetSuite SO write-time defaults confirmed
    // via 2026-07-28 sandbox probe against SO2646:
    //   • orderStatus = 'B' (single-letter code for "Pending Fulfillment")
    //   • subsidiary = 2 (The DPS, Inc.; sandbox single-subsidiary)
    // Configurable per firm; markComplete reads the current row.
    netsuiteSubsidiaryId: text("netsuite_subsidiary_id")
      .notNull()
      .default("2"),
    // Q4 REVISED (CA 2026-07-28): NetSuite tax engine derives per-line
    // tax from customer + ship-to; hardcoding overrides correct
    // behavior on the exact lines most likely to need it (OTC/tooling
    // for out-of-state customers). Column stays as an override escape
    // hatch — null (default) means "let NetSuite derive"; admin sets
    // it only if the engine ever misbehaves.
    netsuiteDefaultTaxCodeId: text("netsuite_default_tax_code_id"),
    netsuiteSoOrderStatusCode: text("netsuite_so_order_status_code")
      .notNull()
      .default("B"),
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
    // Slice 12 Step 8c-2 — NetSuite SO field-fill inputs.
    // Names mirror HubSpot property names verbatim (dumped 2026-07-28
    // against Epicuren deal 40412634025). Enum-labeled values (project_source,
    // project_category, project_service_s_, priority, dealtype) store the
    // resolved label directly since HubSpot returns labels for most enum
    // properties. business_segment stores the raw enum id + a resolved
    // label alongside (id → label needs a properties/deals options fetch;
    // deferred to first-use).
    dealFolderUrl: text("deal_folder_url"),
    projectServiceS: text("project_service_s"),
    projectCategory: text("project_category"),
    sourcingLocation: text("sourcing_location"),
    businessSegmentId: text("business_segment_id"),
    businessSegmentLabel: text("business_segment_label"),
    clientPo: text("client_po"),
    invoiceDateEst: date("invoice_date_est"),
    productionShipDateEst: date("production_ship_date_est"),
    priority: text("priority"),
    dealType: text("deal_type"),
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

/**
 * Request idempotency for operator actions.
 *
 * Duplicate-submission protection cannot come from business-field uniqueness
 * on Freight destinations: two intentional commercial alternatives and one
 * accidentally repeated submission are byte-identical at creation time, since
 * a new destination carries no amounts yet. Uniqueness on
 * (shipment, destination, consignee) would reject the comparison workflow the
 * surface exists to support.
 *
 * Timing cannot separate them either — a rapid deliberate alternative is valid
 * and a delayed retry is still a duplicate — so the discriminator has to be
 * the REQUEST, not the data. The client mints one key per submission and
 * reuses it for every retry of that submission; a deliberate second Add mints
 * a new key and is free to create another option with the same destination.
 *
 * The key is claimed inside the same transaction that does the work, so a
 * concurrent request holding the same key blocks on the insert, then reads a
 * result that is already committed. Claiming separately would leave a window
 * where the loser sees a claimed key with no result yet.
 */
export const actionIdempotency = pgTable("action_idempotency", {
  /** Client-generated, unique per submission. */
  key: text("key").primaryKey(),
  /** Which action claimed it — replay of a key under a different action is a bug. */
  action: text("action").notNull(),
  /** The original success payload, replayed verbatim on a repeat. */
  result: jsonb("result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Live relationship to the acting user. Nullable, and nulled on user
     * deletion — that is correct for a live navigation link and is exactly why
     * it cannot be the only record of who acted.
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * Event-time actor snapshots — Gate 1A.
     *
     * The Pricing trace's stopping rule is "you stop when you reach a person"
     * (R10/R11). With identity held only in `user_id`, deleting one Nexus user
     * silently nulls it across every historical row, and every chain that
     * terminated in that person retroactively terminates in nothing. A trace
     * ending in "unknown" is not a thin terminal, it is a broken one.
     *
     * Provenance is a statement about what happened, and what happened does not
     * change when someone leaves. So identity is COPIED at write time rather
     * than joined at read time.
     *
     * `actorUserId` deliberately carries NO foreign key: an FK would reintroduce
     * the very coupling this removes. It exists for durable disambiguation when
     * two people share a display name.
     *
     * Nullable in this step by design. Old application code may still be
     * writing during deployment, so NOT NULL is deferred until every writer is
     * proven to populate them — see docs/audit-sweep/. Backfilling is only
     * possible while every current `user_id` still resolves.
     */
    actorUserId: uuid("actor_user_id"),
    actorDisplayName: text("actor_display_name").notNull(),
    /**
     * What KIND of actor this row terminates in — Gate 1A actor model.
     *
     * Gate 1B's trace stops when it reaches a person. Without this column, a
     * system-generated event is indistinguishable from a human event whose
     * actor went missing: both are a null. The trace would have to infer the
     * difference from an absence, and an absence cannot tell you whether
     * nobody acted or whether we merely lost track of who did.
     *
     * So the exception is recorded as intent rather than as a gap. A `system`
     * row terminates explicitly, as itself — not as a missing human.
     *
     *   human   actor_user_id required, actor_display_name required
     *   system  actor_user_id NULL,     actor_display_name is the system's
     *           own identity, never a fabricated person
     *
     * Enforced by a CHECK constraint on the shape rather than by making
     * actor_user_id NOT NULL, which would assert that every audit row
     * describes a person — the thing that is not true.
     */
    actorKind: auditActorKind("actor_kind").notNull(),
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
// ---------- item_group_categories (Step 7 · authority separation) ----------

/**
 * How a quote-local Item Group is classified. Skincare, Supplement, Hair care,
 * and six more.
 *
 * SEPARATE FROM `product_types` ON PURPOSE. These nine have no HubSpot origin,
 * no field schema and no relationship to a specification — they were never
 * product types in the sense the leaf rows are. Sharing a table with the leaf
 * Spec Schemas is what let an Item Group be presented as carrying a competing
 * leaf `Product Type`.
 *
 * The separation is structural rather than conventional: `createAssembly` used
 * to enforce it with a runtime `scope !== 'assembly'` check, and one check is
 * one place to forget. An FK into a table containing only categories cannot
 * reference a Spec Schema at all.
 *
 * Ids are the originals, verbatim, so no existing group's classification moved.
 */
export const itemGroupCategories = pgTable("item_group_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Display order. Previously a CASE expression in a product-type helper. */
  position: integer("position").notNull().default(0),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
    /** Step 7 · the Item Group's classification. The read authority. */
    itemGroupCategoryId: text("item_group_category_id").references(
      () => itemGroupCategories.id,
    ),
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
    // Slice 1 canonical quote attachment identity: candidate key for the
    // quote-consistent composite FK from quote_leaves. `id` remains the PK.
    uniqueIndex("assemblies_id_quote_idx").on(t.id, t.quoteId),
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
    /**
     * HubSpot's `hs_product_type` — stored as the RAW INTERNAL OPTION VALUE,
     * never a display label.
     *
     * THE ONLY leaf classification. Step 9 removed `product_type_id`, the
     * Nexus taxonomy that used to sit beside this one — two authorities for
     * one question, of which the operator-maintained half was unset on ~1,051
     * of 1,077 products. Nexus behaviour (which specification fields apply) is
     * DERIVED from this value through the governed mapping in
     * `product-structure/spec-schema-mapping.ts` and pinned per quote; it is
     * never a second thing an operator can set.
     *
     * INTERNAL VALUE, NOT LABEL. Three options diverge, and they are the three
     * largest categories:
     *
     *     label "Primary Packaging"   → value `Primary`
     *     label "Secondary Packaging" → value `Secondary`
     *     label "Logistics"           → value `Third Party Logistics`
     *
     * A value derived from the HubSpot UI's labels would miss about half the
     * catalogue and fail silently, so this column stores exactly what the API
     * returns.
     *
     * NULL means one of two genuinely different things, and they stay
     * distinguishable rather than being collapsed into a fabricated type:
     * either the product is Nexus-local (no `hubspot_product_id`), or HubSpot
     * itself has no classification for it (5 such products as of 2026-08-13).
     *
     * Not an enum: HubSpot may add options at any time, and a database enum
     * would reject a legal upstream value at ingestion. Fidelity to the source
     * outranks local validation here.
     */
    hubspotProductType: text("hubspot_product_type"),
    /**
     * Commercial classification — BV-012 §5. Defaults to `product`, so every
     * pre-existing entry keeps its meaning and nothing was reclassified by the
     * migration that added this.
     *
     * A `service` entry may be sold as a top-level Direct Service and may NOT
     * be attached as an Item Group member. That prohibition is enforced at the
     * write boundary by `evaluateAttachmentEligibility`, not by UI copy.
     */
    commercialKind: leafCommercialKind("commercial_kind")
      .notNull()
      .default("product"),
    /** NOT NULL exactly when `commercialKind === "service"` — DB CHECK. */
    serviceIdentity: directServiceIdentity("service_identity"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Biconditional: a service must name which service; a product must not
    // carry one. Either half alone permits a row a later reader must guess at.
    check(
      "leaves_service_identity_matches_kind",
      sql`(${t.commercialKind} = 'service') = (${t.serviceIdentity} IS NOT NULL)`,
    ),
    index("leaves_commercial_kind_idx")
      .on(t.commercialKind)
      .where(sql`archived = false`),
    // Exactly one library record per governed Direct Service identity.
    //
    // The five are CANONICAL LAUNCH RECORDS, not operator-created products:
    // each carries a NetSuite item mapping, and "which item is Filling /
    // Blending" must have one answer. Two competing records would make that
    // ambiguous at a Sales Order push, which is the least recoverable moment.
    //
    // NOT scoped to `archived = false`, deliberately — archiving one and
    // creating a replacement is exactly the two-records state this prevents.
    uniqueIndex("leaves_service_identity_unique_idx")
      .on(t.serviceIdentity)
      .where(sql`service_identity is not null`),
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
    // Slice 1 compatibility pointer. Contract makes this mandatory after every
    // legacy membership reconciles exactly; Direct quote_leaves need no legacy
    // projection and are unaffected.
    // quote_leaves.id is canonical; assembly_leaves.id remains the temporary
    // operational identity for current ASY-backed consumers.
    quoteLeafId: uuid("quote_leaf_id")
      .notNull()
      .references((): AnyPgColumn => quoteLeaves.id, { onDelete: "cascade" }),
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
    uniqueIndex("assembly_leaves_quote_leaf_idx").on(t.quoteLeafId),
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
    /**
     * Scope. NULL = Library master/default; NOT NULL = quote-owned authority.
     *
     * B-3. Without it, `version_number`, `is_current` and the effective dates
     * each had to mean two things — quote-owned rows are siblings, not a
     * version succession. Naming the scope lets every one of them mean exactly
     * one thing within it.
     */
    quoteId: uuid("quote_id").references(() => quotes.id, {
      onDelete: "cascade",
    }),
    /** Which Library default this quote-owned row was templated from. */
    templatedFromSpecId: uuid("templated_from_spec_id"),
    /**
     * The Product Type governing THESE values.
     *
     * Carried on the authority because the type IS the schema `spec_values`
     * are validated against. Freezing the values while inheriting a mutable
     * Library type would let a Library type change silently invalidate every
     * quote's specification. Library rows leave it NULL and defer to
     * `leaves.product_type_id`.
     */
    productTypeId: text("product_type_id").references(() => productTypes.id),
    /**
     * The PINNED Spec Schema. Step 4 · the authority cutover.
     *
     * Product Type (`leaves.hubspot_product_type`) is LIVE authority and is
     * what every surface displays. Spec Schema is Nexus behaviour derived from
     * it, and it is pinned here at attachment so a later HubSpot
     * reclassification cannot retroactively reinterpret values an operator
     * already authored.
     *
     * Six states, none interchangeable:
     *   'primary' | 'secondary' | 'tertiary'  a schema applies
     *   'no_schema'  specifications intentionally do not apply
     *   'unmapped'   classified, no governed disposition — never folded into
     *                no_schema, because one is an answer and the other is not
     *   'no_type'    authoritative Product Type is missing (NO TYPE SET)
     *   NULL         not pinned. Correct for Library rows, which are templates
     *                and defer; a bug on a quote-owned row.
     */
    specSchema: text("spec_schema"),
    /**
     * Provenance, NEVER display. The authoritative HubSpot internal value the
     * pin was derived from, so the pin stays explicable after HubSpot changes
     * and an `unmapped` pin is recoverable. Display reads the live value.
     */
    schemaDerivedFromType: text("schema_derived_from_type"),
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
    // Only a LIBRARY-scope row may be the Library default.
    uniqueIndex("leaf_specs_current_idx")
      .on(t.leafId)
      .where(sql`quote_id is null and is_current = true`),
    // One quote-owned authority per (quote, leaf) — so two appearances of the
    // same product in one quote cannot silently diverge, and quote-side edits
    // need no reference counting because exclusivity is structural.
    uniqueIndex("leaf_specs_quote_owned_idx")
      .on(t.quoteId, t.leafId)
      .where(sql`quote_id is not null`),
    index("leaf_specs_quote_leaf_idx").on(t.quoteId, t.leafId),
    // Historical version lookup (pin-time queries +
    // version-comparison views).
    index("leaf_specs_leaf_version_idx").on(t.leafId, t.versionNumber),
  ],
);

// ---------- quote_leaves (per-quote pinning; Phase A.1 v2) ----------

// Canonical quote-scoped commercial attachment identity. A nullable
// assembly_id supports both approved structural forms:
//   NULL     = Direct Component
//   NOT NULL = Product-member Component
// `leaf_spec_version_id` references the specific leaf_specs row pinned at send
// time; NULL for draft quotes (drafts auto-update; sent quotes stay pinned).
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
    assemblyId: uuid("assembly_id"),
    leafId: uuid("leaf_id")
      .notNull()
      .references(() => leaves.id, { onDelete: "restrict" }),
    leafSpecVersionId: uuid("leaf_spec_version_id").references(
      () => leafSpecs.id,
    ),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    quantity: numeric("quantity").notNull().default("1"),
    // Denormalised from leaves.commercial_kind and maintained BY THE DATABASE
    // (trigger quote_leaves_commercial_kind_sync, migration 0082). No writer
    // sets it — including this one — which is why it is absent from every
    // insert in the codebase and still NOT NULL.
    //
    // Safe as a copy because leaves.commercial_kind is immutable and this
    // column is held to its source by a composite FK.
    commercialKind: leafCommercialKind("commercial_kind")
      .notNull()
      .default("product"),
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
    index("quote_leaves_grouped_position_idx").on(
      t.quoteId,
      t.assemblyId,
      t.position,
      t.id,
    ),
    index("quote_leaves_direct_position_idx")
      .on(t.quoteId, t.position, t.id)
      .where(sql`assembly_id IS NULL`),
    foreignKey({
      columns: [t.assemblyId, t.quoteId],
      foreignColumns: [assemblies.id, assemblies.quoteId],
      name: "quote_leaves_assembly_quote_fk",
    }).onDelete("cascade"),
  ],
);

// ---------- Phase 2 — manually entered component freight ----------
// Logistics supplies the actual amount. Nexus never allocates it. The
// database migration installs a same-Quote constraint trigger across the leg,
// canonical Quote leaf, and tier because the leg reaches Quote through its
// group. Billable freight is derived and is intentionally not stored here.
export const freightLegComponentTierCosts = pgTable(
  "freight_leg_component_tier_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    freightLegId: uuid("freight_leg_id")
      .notNull()
      .references(() => freightLegs.id, { onDelete: "cascade" }),
    quoteLeafId: uuid("quote_leaf_id")
      .notNull()
      .references(() => quoteLeaves.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),
    actualFreightCost: numeric("actual_freight_cost", {
      precision: 12,
      scale: 2,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("freight_leg_component_tier_costs_identity_idx").on(
      t.freightLegId,
      t.quoteLeafId,
      t.tierId,
    ),
    index("freight_leg_component_tier_costs_leaf_idx").on(t.quoteLeafId),
    check(
      "freight_leg_component_tier_costs_nonnegative",
      sql`${t.actualFreightCost} IS NULL OR ${t.actualFreightCost} >= 0`,
    ),
  ],
);

// Immutable freight inputs associated with one commercial send snapshot.
// Source IDs are evidence rather than FKs so later draft edits/deletes cannot
// cascade into sent history.
export const quoteSnapshotFreightInputs = pgTable(
  "quote_snapshot_freight_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteSnapshotId: uuid("quote_snapshot_id")
      .notNull()
      .references(() => quoteSnapshots.id, { onDelete: "cascade" }),
    sourceFreightLegId: uuid("source_freight_leg_id").notNull(),
    sourceQuoteLeafId: uuid("source_quote_leaf_id").notNull(),
    sourceTierId: uuid("source_tier_id").notNull(),
    actualFreightCost: numeric("actual_freight_cost", {
      precision: 12,
      scale: 2,
    }).notNull(),
    effectiveUnits: integer("effective_units").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("quote_snapshot_freight_inputs_identity_idx").on(
      t.quoteSnapshotId,
      t.sourceFreightLegId,
      t.sourceQuoteLeafId,
      t.sourceTierId,
    ),
    check("quote_snapshot_freight_inputs_cost_nonnegative", sql`${t.actualFreightCost} >= 0`),
    check("quote_snapshot_freight_inputs_units_positive", sql`${t.effectiveUnits} > 0`),
  ],
);

// ---------- Phase 2 worksheet freight replacement ----------
// V1 is manual entry. V2 import drafts use the same tables and provenance.
// A subcategory is one SHIPMENT — a container, NOT an ASY-owned object.
//
// OD-017 · `assembly_id` is nullable. Commercial membership comes from
// `freight_subcategory_items.quote_leaf_id`; a Direct Component is a governed
// leaf with no assembly, so requiring one here forced an operator to invent an
// ASY purely to satisfy a column. The value is still recorded where a shipment
// genuinely belongs to a Finished Product — it just is not a prerequisite.
export const freightSubcategories = pgTable(
  "freight_subcategories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id").notNull().references(() => quotes.id, { onDelete: "cascade" }),
    assemblyId: uuid("assembly_id").references(() => assemblies.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    origin: text("origin"),
    carrierForwarder: text("carrier_forwarder"),
    incoterm: freightIncoterm("incoterm"),
    cargoReadyDate: date("cargo_ready_date"),
    journeyLabel: text("journey_label"),
    treatment: freightTreatment("treatment").notNull().default("bundled"),
    crossesInternationalBorder: boolean("crosses_international_border").notNull().default(false),
    selectedDestinationId: uuid("selected_destination_id"),
    selectionReason: text("selection_reason"),
    displayOrder: integer("display_order").notNull().default(0),
    source: freightFactSource("source").notNull().default("manual"),
    fieldProvenance: jsonb("field_provenance").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("freight_subcategories_quote_order_idx").on(t.quoteId, t.displayOrder),
    index("freight_subcategories_assembly_idx").on(t.assemblyId),
  ],
);

// Traceability only. No amount, markup, share, allocation, weight, or CBM.
export const freightSubcategoryItems = pgTable(
  "freight_subcategory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    freightSubcategoryId: uuid("freight_subcategory_id").notNull().references(() => freightSubcategories.id, { onDelete: "cascade" }),
    // OD-017 · membership is expressed through the governed commercial leaf, so
    // a Direct Component can ship without an assembly. The SUBCATEGORY remains
    // the shipment/destination container — only this association is re-keyed.
    // The identity contract is (subcategory, product), not (product): one leaf
    // may legitimately ship in more than one subcategory.
    quoteLeafId: uuid("quote_leaf_id").notNull().references((): AnyPgColumn => quoteLeaves.id, { onDelete: "cascade" }),
    // Legacy compatibility column. Read by nothing; NULL for a Direct Component.
    assemblyLeafId: uuid("assembly_leaf_id").references(() => assemblyLeaves.id, { onDelete: "cascade" }),
    source: freightFactSource("source").notNull().default("manual"),
    fieldProvenance: jsonb("field_provenance").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("freight_subcategory_items_identity_idx").on(t.freightSubcategoryId, t.quoteLeafId),
    index("freight_subcategory_items_quote_leaf_idx").on(t.quoteLeafId),
    index("freight_subcategory_items_leaf_idx").on(t.assemblyLeafId),
  ],
);

export const freightDestinations = pgTable(
  "freight_destinations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    freightSubcategoryId: uuid("freight_subcategory_id").notNull().references(() => freightSubcategories.id, { onDelete: "cascade" }),
    destination: text("destination").notNull(),
    consignee: text("consignee"),
    transitDays: text("transit_days"),
    quoteReference: text("quote_reference"),
    internalNotes: text("internal_notes"),
    sameValueAllBreaks: boolean("same_value_all_breaks").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    source: freightFactSource("source").notNull().default("manual"),
    fieldProvenance: jsonb("field_provenance").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("freight_destinations_id_subcategory_idx").on(t.id, t.freightSubcategoryId),
    index("freight_destinations_subcategory_order_idx").on(t.freightSubcategoryId, t.displayOrder),
  ],
);

export const freightDestinationBreaks = pgTable(
  "freight_destination_breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    freightDestinationId: uuid("freight_destination_id").notNull().references(() => freightDestinations.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id").notNull().references(() => quoteTiers.id, { onDelete: "cascade" }),
    freightAmount: numeric("freight_amount", { precision: 12, scale: 2 }),
    freightMarkupPct: numeric("freight_markup_pct", { precision: 5, scale: 4 }),
    mode: freightLegMode("mode"),
    shipmentNote: text("shipment_note"),
    cbm: numeric("cbm", { precision: 12, scale: 3 }),
    source: freightFactSource("source").notNull().default("manual"),
    fieldProvenance: jsonb("field_provenance").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("freight_destination_breaks_identity_idx").on(t.freightDestinationId, t.tierId),
    index("freight_destination_breaks_tier_idx").on(t.tierId),
    check("freight_destination_breaks_amount_nonnegative", sql`${t.freightAmount} IS NULL OR ${t.freightAmount} >= 0`),
    check("freight_destination_breaks_cbm_nonnegative", sql`${t.cbm} IS NULL OR ${t.cbm} >= 0`),
  ],
);

export const freightCustomsEntries = pgTable(
  "freight_customs_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    freightSubcategoryId: uuid("freight_subcategory_id").notNull().references(() => freightSubcategories.id, { onDelete: "cascade" }),
    sourceMode: freightCustomsSource("source_mode").notNull().default("invoice"),
    invoiceReference: text("invoice_reference"),
    entryDescription: text("entry_description"),
    source: freightFactSource("source").notNull().default("manual"),
    fieldProvenance: jsonb("field_provenance").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("freight_customs_entries_subcategory_idx").on(t.freightSubcategoryId)],
);

export const freightCustomsBreaks = pgTable(
  "freight_customs_breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    freightCustomsEntryId: uuid("freight_customs_entry_id").notNull().references(() => freightCustomsEntries.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id").notNull().references(() => quoteTiers.id, { onDelete: "cascade" }),
    chargeType: freightCustomsChargeType("charge_type").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    markupPct: numeric("markup_pct", { precision: 5, scale: 4 }),
    rateBase: numeric("rate_base", { precision: 12, scale: 2 }),
    ratePct: numeric("rate_pct", { precision: 7, scale: 6 }),
    detail: text("detail"),
    source: freightFactSource("source").notNull().default("manual"),
    fieldProvenance: jsonb("field_provenance").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("freight_customs_breaks_identity_idx").on(t.freightCustomsEntryId, t.chargeType, t.tierId),
    index("freight_customs_breaks_tier_idx").on(t.tierId),
    check("freight_customs_breaks_amount_nonnegative", sql`${t.amount} IS NULL OR ${t.amount} >= 0`),
  ],
);

// Operational metadata. It is audit-logged and excluded from commercial math.
export const freightDestinationTracking = pgTable(
  "freight_destination_tracking",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    freightDestinationId: uuid("freight_destination_id").notNull().references(() => freightDestinations.id, { onDelete: "cascade" }),
    etd: date("etd"),
    eta: date("eta"),
    actualDeliveryDate: date("actual_delivery_date"),
    source: freightFactSource("source").notNull().default("manual"),
    fieldProvenance: jsonb("field_provenance").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("freight_destination_tracking_destination_idx").on(t.freightDestinationId)],
);

// Complete immutable worksheet graph for one commercial send. The graph keeps
// the same subcategory/destination/break/member/customs/tracking grains and all
// per-field provenance without foreign keys back to mutable draft records.
export const quoteSnapshotFreightWorkbooks = pgTable(
  "quote_snapshot_freight_workbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteSnapshotId: uuid("quote_snapshot_id").notNull().references(() => quoteSnapshots.id, { onDelete: "cascade" }),
    workbook: jsonb("workbook").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("quote_snapshot_freight_workbooks_snapshot_idx").on(t.quoteSnapshotId)],
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
// Line-level fields (pricing provenance, legacy supplier,
// qty_per_sellable_unit, category,
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
    // OD-017 · governed cost-input identity. `quote_leaves.id` is the canonical
    // commercial SKU (OD-014) and exists for BOTH a Product-member Component and
    // a Direct Component. It is the sole identity every reader and writer uses.
    quoteLeafId: uuid("quote_leaf_id")
      .notNull()
      .references((): AnyPgColumn => quoteLeaves.id, { onDelete: "cascade" }),
    // Legacy. Nullable, written for ASY-backed compatibility, READ BY NOTHING.
    // A Direct Component has no junction row, so this is NULL for one. Dropped
    // in a later governed cleanup once a release proves it is dead.
    assemblyLeafId: uuid("assembly_leaf_id").references(
      () => assemblyLeaves.id,
      { onDelete: "cascade" },
    ),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),
    lineGroupId: uuid("line_group_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),

    // Line-level (duplicated across tier rows of the same line_group_id):
    // Slice 13 BV-001 — governed pricing provenance. HubSpot Company ID is
    // the stable identity; the name is snapshotted at selection time and is
    // never rewritten by later HubSpot renames. `supplier` remains strictly
    // legacy read-only compatibility evidence.
    pricingVendorHubspotCompanyId: text(
      "pricing_vendor_hubspot_company_id",
    ),
    pricingVendorNameSnapshot: text("pricing_vendor_name_snapshot"),
    pricingDate: date("pricing_date"),
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
    // One row per (quote_leaf, line, tier). Prevents duplicate cells.
    uniqueIndex("assembly_leaf_inputs_line_tier_idx").on(
      t.quoteLeafId,
      t.lineGroupId,
      t.tierId,
    ),
    index("assembly_leaf_inputs_quote_leaf_id_idx").on(t.quoteLeafId),
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
    // Stage 3 A · ONE of assemblyId / quoteLeafId, never both, never neither
    // (CHECK assembly_production_inputs_owner_xor, migration 0082). Nullable
    // here for the same reason migration 0077 made Client Target's owner
    // columns nullable: the value belongs to either a group or a top-level
    // direct unit, and which one is data rather than schema.
    assemblyId: uuid("assembly_id").references(() => assemblies.id, {
      onDelete: "cascade",
    }),
    // The other branch: a top-level Direct Service. Constrained to
    // SERVICE-classified leaves by a composite FK on
    // (quote_leaf_id, owner_commercial_kind) — a Direct Product's quote leaf
    // carries commercial_kind='product' and therefore has no referent.
    quoteLeafId: uuid("quote_leaf_id").references(() => quoteLeaves.id, {
      onDelete: "cascade",
    }),
    // GENERATED in the database and never written. Declared so Drizzle knows
    // the column exists; excluded from every insert shape because a writer
    // cannot set it — which is what makes a wrong value unrepresentable
    // rather than merely refused.
    ownerCommercialKind: leafCommercialKind("owner_commercial_kind").generatedAlwaysAs(
      sql`CASE WHEN "quote_leaf_id" IS NULL THEN NULL ELSE 'service'::"leaf_commercial_kind" END`,
    ),
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
    /**
     * LEGACY, unresolved. Predates the BV-011 Tooling/Artwork split.
     *
     * Never backfilled: no rule can say whether a combined amount is Tooling,
     * Artwork, or both, so any split would be fabricated. It still contributes
     * to unit economics exactly as before — but a separately-billed value here
     * BLOCKS NetSuite projection with a named remediation rather than being
     * guessed or skipped.
     */
    toolingArtworkTotal: numeric("tooling_artwork_total", {
      precision: 12,
      scale: 2,
    }),
    /** BV-011 `OTC - Tooling` — Inventory Item. */
    toolingTotal: numeric("tooling_total", { precision: 12, scale: 2 }),
    /** BV-011 `OTC - Artwork` — Non-inventory Item. */
    artworkTotal: numeric("artwork_total", { precision: 12, scale: 2 }),
    rdTotal: numeric("rd_total", { precision: 12, scale: 2 }),
    // Migration 0083. Its own column rather than a reuse of otherServiceTotal:
    // BV-011 maps Testing and Other to DIFFERENT accounting destinations, and
    // one column carrying both would discard the distinction a Sales Order
    // line needs. Not surfaced on the Item Group Production table.
    testingMicrosTotal: numeric("testing_micros_total", {
      precision: 12,
      scale: 2,
    }),
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
    // OD-017 · governed cost-input identity (see assembly_leaf_inputs).
    quoteLeafId: uuid("quote_leaf_id")
      .notNull()
      .references((): AnyPgColumn => quoteLeaves.id, { onDelete: "cascade" }),
    // Legacy compatibility column. Read by nothing; NULL for a Direct Component.
    assemblyLeafId: uuid("assembly_leaf_id").references(
      () => assemblyLeaves.id,
      { onDelete: "cascade" },
    ),
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
    primaryKey({ columns: [t.quoteLeafId, t.tierId] }),
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
    // OD-017 · governed cost-input identity (see assembly_leaf_inputs).
    quoteLeafId: uuid("quote_leaf_id")
      .notNull()
      .references((): AnyPgColumn => quoteLeaves.id, { onDelete: "cascade" }),
    // Legacy compatibility column. Read by nothing; NULL for a Direct Component.
    assemblyLeafId: uuid("assembly_leaf_id").references(
      () => assemblyLeaves.id,
      { onDelete: "cascade" },
    ),
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
    primaryKey({ columns: [t.quoteLeafId, t.tierId] }),
    index("assembly_leaf_targets_tier_id_idx").on(t.tierId),
  ],
);

// ---------- quote_client_targets (Client Target · 2026-08-17) ----------
//
// What the client said they need to pay, per TOP-LEVEL SELLABLE UNIT, with an
// optional per-tier override.
//
// ── WHY NOT `assembly_leaf_targets` ───────────────────────────────────────
//
// That table keys `(quote_leaf_id, tier_id)`, which is the right identity for
// a Direct Product — where the leaf IS the sellable unit — and the wrong one
// for an Item Group, where a leaf is an internal member nobody named a price
// for. There is no key on it that addresses an Item Group finished good at
// all, so storing one meant picking an arbitrary member, and the math layer
// then refused to use it (`competitiveStatus: null` on assemblies). It also
// cannot express "one target across all tiers", because `tier_id` is NOT NULL
// and in its primary key.
//
// It held ZERO rows, so correcting the identity cost no migration and broke no
// operator expectation. Full trace:
// `docs/validation/client-target-identity-trace.md`.
//
// ── THE KEY IS THE UNIT OF ACCOUNT ────────────────────────────────────────
//
// Exactly one of `assembly_id` / `quote_leaf_id` is set:
//
//   assembly_id   → an Item Group finished good
//   quote_leaf_id → a Direct Product (`quote_leaves.assembly_id IS NULL`)
//
// A target against an INTERNAL MEMBER leaf is refused at the write boundary. A
// CHECK cannot see another table, so that invariant is the action layer's —
// same posture as one-recommended-tier-per-quote.
//
// ── tier_id NULL IS A FACT, NOT AN ABSENCE ────────────────────────────────
//
// NULL means "the common target, applying to every tier". A set tier REPLACES
// it for that tier and does not stack — the same precedence as
// `tier_price_adj_pct` over `global_price_adj_pct`, deliberately, because
// operators have just learned that rule elsewhere on this quote.
//
// Resolution is `tier target ?? common target`, per tier. Nothing collapses it
// to one value per row.
//
// ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
//
// A BENCHMARK. It enters no price, no margin and no total: authoring one
// creates or modifies no GPA, tier adjustment, lift, direct price or Final
// Quoted Sell. It is internal — never reaching the customer view, the PDF or
// NetSuite — and the customer-view boundary verifier names it explicitly so
// that absence is enforced rather than merely current.
export const quoteClientTargets = pgTable(
  "quote_client_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    assemblyId: uuid("assembly_id").references(() => assemblies.id, {
      onDelete: "cascade",
    }),
    quoteLeafId: uuid("quote_leaf_id").references(
      (): AnyPgColumn => quoteLeaves.id,
      { onDelete: "cascade" },
    ),
    // NULL = the common target for every tier.
    tierId: uuid("tier_id").references(() => quoteTiers.id, {
      onDelete: "cascade",
    }),
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
    index("quote_client_targets_quote_idx").on(t.quoteId),
    // The business invariant is uniqueness of one COMMON target per sellable
    // unit and one EXPLICIT target per sellable unit per tier. Four partial
    // indexes because a plain unique index treats NULL tiers as distinct and
    // would admit several "common" rows for one unit.
    uniqueIndex("quote_client_targets_asy_common_uq")
      .on(t.assemblyId)
      .where(sql`assembly_id IS NOT NULL AND tier_id IS NULL`),
    uniqueIndex("quote_client_targets_asy_tier_uq")
      .on(t.assemblyId, t.tierId)
      .where(sql`assembly_id IS NOT NULL AND tier_id IS NOT NULL`),
    uniqueIndex("quote_client_targets_leaf_common_uq")
      .on(t.quoteLeafId)
      .where(sql`quote_leaf_id IS NOT NULL AND tier_id IS NULL`),
    uniqueIndex("quote_client_targets_leaf_tier_uq")
      .on(t.quoteLeafId, t.tierId)
      .where(sql`quote_leaf_id IS NOT NULL AND tier_id IS NOT NULL`),
    check(
      "quote_client_targets_one_unit",
      sql`(assembly_id IS NOT NULL AND quote_leaf_id IS NULL)
          OR (assembly_id IS NULL AND quote_leaf_id IS NOT NULL)`,
    ),
  ],
);

// ---------- quote_leaf_lifts (Phase 3 · Package 1) ----------
//
// Sparse applied surgical lifts per (canonical quote leaf, tier).
//
// Keyed on `quote_leaves.id`, NOT on `assembly_leaves.id`. Its two sparse
// siblings above key on the legacy junction, which is the condition OD-017
// records: a direct attachment (`quote_leaves.assembly_id IS NULL`) has no
// junction row and therefore cannot be authored against. `CostingLift` is
// already canonical, so a row here loads into one with no translation — no
// crossing, and so no crossing to get wrong.
//
// `lift_pct` NOT NULL and > 0 (CHECK in migration 0063): row existence IS the
// fact that a lift is in effect, exactly as with `assembly_leaf_overrides`.
// Multiplicative, matching `CostingLift.liftPct` — 0.0770 is +7.7%.
//
// A same-Quote trigger accompanies the table. Both FKs can be independently
// valid while naming different Quotes, which would price a cell that does not
// exist.
//
// Lifts are DRAFT-ONLY AUTHORING DATA, not a Pattern 52 freeze-list field.
// The freeze list holds values captured at a lifecycle transition; a lift is
// authored before one, and its EFFECT is frozen by the snapshot columns that
// are on the list. Writes are guarded by `requireDraft` at the action layer,
// consistent with every other authoring surface.
export const quoteLeafLifts = pgTable(
  "quote_leaf_lifts",
  {
    quoteLeafId: uuid("quote_leaf_id")
      .notNull()
      .references(() => quoteLeaves.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),
    liftPct: numeric("lift_pct", { precision: 6, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.quoteLeafId, t.tierId] }),
    index("quote_leaf_lifts_tier_id_idx").on(t.tierId),
  ],
);

// ---------- netsuite_item_groups (Slice 12 Step 8c-1) ----------

// Nexus's authoritative local cache of composition → NetSuite Item
// Group identity mappings. Identity is (customer_netsuite_id, base_sku,
// sorted [(ns_item_id, qty)]) per CA §4A amendment (2026-07-28): groups
// are per-CUSTOMER × composition. Two customers ordering an identical
// component set get separate groups (Aisha confirmed).
//
// composition_hash is SHA-256 hex of canonicalized inputs; global PK
// because the hash already includes customer + base SKU + composition.
//
// Description is WRITE-ONCE, NEVER RECONCILED (CA Q3 + Aisha "she can
// manually overwrite it" answer). Nexus writes the description at
// creation only; the find path is cache-only and never writes back to
// NetSuite. Groups are immutable from our side.
//
// netsuite_external_id: Nexus writes 'nxs-grp-<hash>' at group
// creation. 0 of 33 pre-existing sandbox groups populate this field,
// so Nexus owns it cleanly and can only ever find its own groups.
// Legacy-group reconciliation at cutover is out of scope (per CA §4A).
export const netsuiteItemGroups = pgTable(
  "netsuite_item_groups",
  {
    compositionHash: text("composition_hash").primaryKey(),
    netsuiteExternalId: text("netsuite_external_id").notNull().unique(),
    netsuiteInternalId: text("netsuite_internal_id").notNull(),
    customerNetsuiteId: text("customer_netsuite_id").notNull(),
    baseSku: text("base_sku").notNull(),
    itemidDisplay: text("itemid_display").notNull(),
    description: text("description"),
    firstUsedByQuoteId: uuid("first_used_by_quote_id").references(
      () => quotes.id,
      { onDelete: "set null" },
    ),
    firstUsedByUserId: uuid("first_used_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    firstUsedByDealId: text("first_used_by_deal_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Covers both "does this customer already have a group for this
    // SKU?" cache lookups AND the -G/-G2/-G3 collision scan.
    index("netsuite_item_groups_customer_base_sku_idx").on(
      t.customerNetsuiteId,
      t.baseSku,
    ),
  ],
);

// ---------- netsuite_customer_map (Slice 12 Step 8c-3, option B') ----------

// Per CA disposition 2026-07-28: Nexus resolves HubSpot company →
// NetSuite customer via a Nexus-owned mapping table, not a fuzzy
// name-match. Rationale: 9 real customers across all active projects
// (probe 2026-07-28); NetSuite has 0 custentity fields carrying
// HubSpot company id; company names in NetSuite carry DBA/suffix
// variance that would poison a name-match. A one-time admin backfill
// eliminates the resolver entirely.
//
// Aisha seeds this once via /admin/netsuite-customer-map; new rows
// added incrementally as new customers appear. Cache-hit is
// deterministic; miss BLOCKS markComplete with a specific message
// naming the HubSpot company + admin URL (CA discipline: never a
// silent picking).
//
// netsuite_customer_display_name is ADVISORY ONLY — human-legibility
// so admins recognize which customer is mapped. Never used as a match
// key. Same rule as Item Group description (Pattern 30 · immutability
// via draft-lock).
//
// No delete — mappings are historically anchored. An SO pushed against
// customer 131860 stays pushed. Edits go through the changed-audit
// flow (see admin actions / `netsuite_customer_map_changed` audit
// action).
export const netsuiteCustomerMap = pgTable(
  "netsuite_customer_map",
  {
    hubspotCompanyId: text("hubspot_company_id").primaryKey(),
    netsuiteCustomerId: text("netsuite_customer_id").notNull(),
    netsuiteCustomerDisplayName: text("netsuite_customer_display_name"),
    verifiedAt: timestamp("verified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Fast reverse lookup (any admin surface "which HubSpot company
    // is mapped to NS customer 131860?") in addition to the PK.
    index("netsuite_customer_map_ns_id_idx").on(t.netsuiteCustomerId),
  ],
);

// ---------- netsuite_so_pushes (Slice 12 Step 8c-3) ----------

// SO push idempotency + retry-audit source of truth. Per CA
// Amendment A: markComplete CHECKS this table BEFORE any NetSuite
// write (not just relying on the unique constraint to reject).
// #145 poisoning precedent applied.
//
// Retry convergence path (CA's "case I'll look hardest at"):
//   1. markComplete attempt 1: guards pass, groups created, SO create
//      succeeds (row inserted with status='succeeded'), freeze-tx
//      CRASHES.
//   2. markComplete attempt 2: reads this table, finds the succeeded
//      row for (quote_id, accepted_tier_id) → skips SO create entirely,
//      jumps to freeze-tx step 9 with the stored so_id. No duplicate SO.
//
// One snapshot-keyed attempt row freezes the first payload. A Quote-scoped
// succeeded unique index preserves Quote → Sales Order 1:1 independently of
// tier movement or retry timing.
//
// idempotency_key mirrors the NetSuite REST X-NetSuite-Idempotency-Key
// header value we sent — belt over CHECK-then-write. If the DB rollback
// occurred AFTER NS accepted the POST, retry's fresh POST with the
// same key returns the SAME so_id (NetSuite deduplicates by header).
export const netsuiteSoPushes = pgTable(
  "netsuite_so_pushes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    // FK RESTRICT — symmetric with quotes.accepted_tier_id per Slice 12
    // Step 10 §0.5 RECOMMEND 2. Prevents tier delete out-of-band from
    // stranding forensic push rows. App layer's assertDraft already
    // blocks tier delete on non-draft quotes; DB constraint is defense
    // in depth.
    acceptedTierId: uuid("accepted_tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "restrict" }),
    // Nullable only for pre-Phase-1 forensic rows. Every governed Phase-1
    // attempt supplies the accepted active sent snapshot before any NS write.
    quoteSnapshotId: uuid("quote_snapshot_id").references(
      () => quoteSnapshots.id,
      { onDelete: "restrict" },
    ),
    // Enum text: 'pending' | 'succeeded' | 'failed'
    status: text("status").notNull(),
    netsuiteSoId: text("netsuite_so_id"),
    netsuiteSoTranid: text("netsuite_so_tranid"),
    amountPushed: numeric("amount_pushed", { precision: 15, scale: 4 }),
    idempotencyKey: text("idempotency_key").notNull(),
    errorClass: text("error_class"),
    errorDetail: text("error_detail"),
    // Full payload snapshot for forensic + retry replay. Frozen at
    // attempt time; never mutated.
    payloadSnapshot: jsonb("payload_snapshot"),
    startedByUserId: uuid("started_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    // Partial unique — at most one SUCCEEDED push per (quote, tier).
    // Failed/pending rows accumulate across retry attempts.
    uniqueIndex("netsuite_so_pushes_success_unique_idx")
      .on(t.quoteId)
      .where(sql`status = 'succeeded'`),
    uniqueIndex("netsuite_so_pushes_snapshot_success_unique_idx")
      .on(t.quoteSnapshotId)
      .where(sql`status = 'succeeded' AND quote_snapshot_id IS NOT NULL`),
    // One LIVE attempt per snapshot. A closed attempt releases its claim.
    //
    // The predicate must stay identical to the durable-payload selector in
    // mark-complete.ts. An attempt that no longer pins the payload must also
    // no longer occupy the snapshot, or the re-elected attempt has nowhere to
    // be written. See migration 0065 and the selector's comment for why only
    // `failed + validation` qualifies (conclusively terminal AND measured
    // side-effect-free) and why this is not a blanket `status <> 'failed'`.
    uniqueIndex("netsuite_so_pushes_snapshot_attempt_unique_idx")
      .on(t.quoteSnapshotId)
      .where(
        sql`quote_snapshot_id IS NOT NULL AND NOT (status = 'failed' AND error_class = 'validation')`,
      ),
    // Fast CHECK-then-write lookup.
    index("netsuite_so_pushes_quote_tier_idx").on(
      t.quoteId,
      t.acceptedTierId,
    ),
  ],
);


/**
 * Firm-level NetSuite item mapping for the four FIXED Direct Service
 * identities. Migration 0081.
 *
 * `other_service` is excluded by CHECK, not by convention: it is the catch-all
 * and carries no single accounting meaning, so it takes a per-LINE selection
 * instead. A fifth row here "for symmetry" would be the generic default the
 * disposition prohibits, and a quiet one — a plausible row silently routing
 * every miscellaneous service to one item.
 *
 * NOT a Pattern 52 frozen surface. This is a routing table, not a commercial
 * term: what actually pushed is recorded on the Sales Order and in the
 * `quote_completed` audit row, so re-mapping later cannot retroactively
 * re-route anything already sent.
 */
export const netsuiteServiceItemMap = pgTable(
  "netsuite_service_item_map",
  {
    serviceIdentity: directServiceIdentity("service_identity").primaryKey(),
    /** NetSuite itemid. Human recognition only — NEVER what a write references. */
    netsuiteItemCode: text("netsuite_item_code").notNull(),
    /** The authoritative reference. Every write uses this, never the code. */
    netsuiteInternalId: text("netsuite_internal_id").notNull(),
    /** When the internal id was last CONFIRMED. Not a row-modified stamp. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id),
  },
  (t) => [
    check(
      "netsuite_service_item_map_not_other_service",
      sql`${t.serviceIdentity} <> 'other_service'`,
    ),
  ],
);

// ═══════════════════════════════════════════════════════════════════════
// THE FROZEN COMMERCIAL LINE SET  (migration 0087)
//
// What a quote actually offered, per line and per tier, recorded at send.
//
// Before this, nothing priced was frozen. `quote_snapshots` held the
// commercial terms and the PDF axes; every figure NetSuite received was
// RECOMPUTED at push time from a live costing bundle, and reproduced the
// accepted quote only because draft-lock stops cost edits and the commercial
// pin holds the rate. That is a convention — REG-4's "lines sum exactly to
// the accepted commercial total" was a claim about a recomputation rather
// than about a record.
//
// SEND freezes the whole line × tier matrix; ACCEPT selects a column. So the
// accepted commercial total is a SELECTION, never a second stored number:
//
//   tier_commercial_total WHERE tier_id = quotes.customer_accepted_tier_id
// ═══════════════════════════════════════════════════════════════════════

export const commercialLineKind = pgEnum("commercial_line_kind", [
  "item_group_member",
  "direct_product",
  "direct_service",
  "otc",
]);

export const commercialPricingState = pgEnum("commercial_pricing_state", [
  "priced",
  "quote_on_request",
]);

export const commercialAllocationState = pgEnum("commercial_allocation_state", [
  "allocated",
  "separately_billed",
]);

export const quoteSnapshotLines = pgTable(
  "quote_snapshot_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteSnapshotId: uuid("quote_snapshot_id")
      .notNull()
      .references(() => quoteSnapshots.id, { onDelete: "cascade" }),
    lineKind: commercialLineKind("line_kind").notNull(),
    /** The Item Group this line belongs to. NULL for top-level lines. */
    owningAssemblyId: uuid("owning_assembly_id"),
    quoteLeafId: uuid("quote_leaf_id"),
    /** AS PRINTED. A library rename must not change what a sent quote says. */
    displayName: text("display_name").notNull(),
    displaySku: text("display_sku"),
    serviceIdentity: directServiceIdentity("service_identity"),
    /**
     * The governed BV-011 destination for this line, fixed by the input it came
     * from. NULL means different things per kind, which is why it is nullable:
     * a product line resolves by SKU and has no destination at all, whereas an
     * OTC line with NULL here is the LEGACY combined Tooling/Artwork charge —
     * the state that blocks projection.
     *
     * Persisted rather than re-derived, so the frozen row is self-describing.
     * Re-deriving would mean string-matching `displayName` at push time, and a
     * copy change would then silently repoint an accounting destination.
     */
    bv011Destination: bv011Destination("bv011_destination"),
    /**
     * TRUE only for the legacy combined Tooling/Artwork charge.
     *
     * A null `bv011Destination` alone could not carry this: it also describes a
     * line frozen before the column existed, and conflating the two made the
     * readiness check tell an operator to resolve a Formulation service into
     * Tooling and Artwork. Same discipline as `pricingState` — an ambiguous
     * null replaced by an explicit statement.
     */
    legacyUnresolved: boolean("legacy_unresolved").notNull().default(false),
    /**
     * The frozen per-line item selection, for `OTC - Other Service` only.
     *
     * Distinct from `netsuiteItemId`, and the distinction is load-bearing:
     * this is what the operator CHOSE and it is frozen at send; that is what
     * was actually POSTED and it is written at push. They should agree, and
     * keeping both means a disagreement is detectable rather than absorbed.
     */
    selectedNetsuiteItemId: text("selected_netsuite_item_id"),
    selectedNetsuiteItemCode: text("selected_netsuite_item_code"),
    /** Resolved NetSuite item, written back at push. Posting provenance, not a commercial term. */
    netsuiteItemId: text("netsuite_item_id"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("qsl_snapshot_idx").on(t.quoteSnapshotId, t.position)],
);

export const quoteSnapshotLineTiers = pgTable(
  "quote_snapshot_line_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteSnapshotLineId: uuid("quote_snapshot_line_id")
      .notNull()
      .references(() => quoteSnapshotLines.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id").notNull(),
    tierLabel: text("tier_label").notNull(),
    /**
     * THIS LINE's quantity at this tier — not the tier's own, which lives on
     * `quoteSnapshotTierTotals`. A one-time fee is quantity 1 at every tier;
     * storing the tier's put a $140 charge on record as 1,000 units.
     *
     * `unitRate × quantity === lineAmount` holds IN THE DURABLE RECORD, which
     * is what lets REG-4 check the multiplication NetSuite performs on its own.
     *
     * It is NOT true by construction, and saying so here was wrong for as long
     * as the column was numeric(14,4). The projection computes the amount as
     * `rate × qty` at full precision and the freeze then rounded the two
     * INDEPENDENTLY — rate to 4dp, amount to 2dp from the unrounded product —
     * so the stored pair disagreed by up to `5×10⁻⁵ × quantity`: $0.04 on the
     * ABH tier-2 line, $0.86 at 20,000 units. REG-4 refused the send, correctly.
     *
     * The invariant is now ESTABLISHED rather than assumed: the freeze derives
     * the rate FROM the accepted amount and asserts exact integer-cent equality
     * before writing (see commercial-freeze.ts). Scale 8 is what makes that
     * derivation representable, and is proven to survive the provider — a
     * sandbox Sales Order posted 1.00000001 and 1.00000002 at quantity
     * 1,000,000 and NetSuite returned both rates intact with amounts one cent
     * apart. Precision 18 keeps the 10 integer digits numeric(14,4) had;
     * numeric(14,8) would have cut them to 6.
     */
    quantity: integer("quantity"),
    /**
     * Priced or not, STATED.
     *
     * A nullable rate alone would repeat the OD-027 ambiguity — "no price"
     * and "we failed to compute one" would be the same value. A DB CHECK
     * ties this to the nullity of both amount columns, so an unpriced cell
     * is a statement and a priced one cannot be half-written.
     */
    pricingState: commercialPricingState("pricing_state").notNull(),
    unitRate: numeric("unit_rate", { precision: 18, scale: 8 }),
    lineAmount: numeric("line_amount", { precision: 14, scale: 2 }),
    allocationState: commercialAllocationState("allocation_state"),
  },
  (t) => [
    index("qslt_by_line").on(t.quoteSnapshotLineId),
    unique("qslt_line_tier_unique").on(t.quoteSnapshotLineId, t.tierId),
  ],
);

export const quoteSnapshotTierTotals = pgTable(
  "quote_snapshot_tier_totals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteSnapshotId: uuid("quote_snapshot_id")
      .notNull()
      .references(() => quoteSnapshots.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id").notNull(),
    tierLabel: text("tier_label").notNull(),
    quantity: integer("quantity"),
    unitSubtotal: numeric("unit_subtotal", { precision: 14, scale: 2 }).notNull(),
    otcSubtotal: numeric("otc_subtotal", { precision: 14, scale: 2 }).notNull(),
    /**
     * What was OFFERED at this tier. NOT the accepted total — at send nothing
     * is accepted, and after acceptance three of four tiers still are not.
     */
    tierCommercialTotal: numeric("tier_commercial_total", {
      precision: 14,
      scale: 2,
    }).notNull(),
    /**
     * The PDF's "from" semantics. STORED, not derived: the rule deciding when
     * a total is provisional is presentation policy and may change, and the
     * artifact must reproduce what the customer was shown rather than what a
     * later rule would produce from the same lines.
     */
    totalIsProvisional: boolean("total_is_provisional").notNull(),
  },
  (t) => [unique("qstt_snapshot_tier_unique").on(t.quoteSnapshotId, t.tierId)],
);

// ═══════════════════════════════════════════════════════════════════════
// BV-011 DESTINATION → NETSUITE ITEM  (migration 0088)
//
// Keyed on the DESTINATION, not on the economic source.
//
// `netsuiteServiceItemMap` keyed on `service_identity`, which conflated what a
// fee MEANS (BV-011, fixed in code) with which record it POSTS TO (admin-
// governed). The conflation was already biting: `rd_total` and the
// `formulation` Direct Service both resolve to `OTC - Formulation`, so
// identity-keying needed two rows for one NetSuite item and they were free to
// drift apart. Destination-keying makes that one row, structurally.
//
// Admins configure the NetSuite record here. They do not configure the
// accounting meaning of a fee — that is `src/lib/netsuite/bv011-destinations.ts`.
// ═══════════════════════════════════════════════════════════════════════


export const netsuiteDestinationItemMap = pgTable(
  "netsuite_destination_item_map",
  {
    destination: bv011Destination("destination").primaryKey(),
    netsuiteItemCode: text("netsuite_item_code"),
    netsuiteInternalId: text("netsuite_internal_id"),
    /**
     * Last SUCCESSFUL resolution against NetSuite. NULL means never verified,
     * which is distinct from verified-and-missing (recorded by clearing the
     * ids). A transient NetSuite failure must leave both untouched:
     * indeterminate is not unmapped (#291 disposition).
     */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/**
 * Per-line NetSuite item for `OTC - Other Service` (migration 0090).
 *
 * The one BV-011 destination with no firm-wide record: it is the catch-all, so
 * two quotes can use it for unrelated charges and 0081 refuses it a firm row by
 * CHECK. The operator's choice IS the governance for the line, which makes it a
 * commercial decision about this quote and therefore frozen at send.
 */
export const quoteOtherServiceItems = pgTable(
  "quote_other_service_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    /** The Item Group whose `other_service_total` this is for. */
    assemblyId: uuid("assembly_id").references(() => assemblies.id, {
      onDelete: "cascade",
    }),
    /** The Direct Service leaf, when its identity is `other_service`. */
    quoteLeafId: uuid("quote_leaf_id").references(() => quoteLeaves.id, {
      onDelete: "cascade",
    }),
    /**
     * Both NOT NULL: a selection naming no item is not a selection. The absence
     * of the ROW is how "not chosen yet" is represented, so a half-filled row
     * would be a third state nothing needs.
     */
    netsuiteItemCode: text("netsuite_item_code").notNull(),
    netsuiteInternalId: text("netsuite_internal_id").notNull(),
    selectedAt: timestamp("selected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    selectedByUserId: uuid("selected_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("qosi_quote_idx").on(t.quoteId),
    check(
      "qosi_owner_xor",
      sql`(${t.assemblyId} IS NOT NULL) <> (${t.quoteLeafId} IS NOT NULL)`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────
// Per-charge commercial recovery (migration 0100)
//
// The operator-selected layer between internal cost truth and customer
// presentation. `recovery_charge` is a CLOSED set — a charge exists because
// it is governed, not because a field is numeric — so adding one is a
// migration, which the enum enforces.
//
// Note what is absent: filling/blending, CM assembly, bulk raw, packaging.
// Per-unit COGS is not a charge, it is the unit price, and that boundary is
// what stops recovery spreading to every numeric field.
//
// ABSENCE OF A ROW IS A VALUE. There is no `per_assembly` mode because it was
// never an election — it is the absence of one. A missing row means "nobody
// elected; read the legacy source", which keeps "nobody chose" apart from
// "someone chose the same thing". No backfill: 89 quotes and 29 snapshots
// resolve to exactly the behaviour that produced them with zero rows here.
// ─────────────────────────────────────────────────────────────────────────

export const recoveryMode = pgEnum("recovery_mode", [
  "included",
  "separate",
  "absorbed",
]);

export const recoveryCharge = pgEnum("recovery_charge", [
  "container_freight",
  "duty_tariffs",
  "tooling",
  "project_setup",
  "artwork_plate",
  "rd_formulation",
  "testing_micros",
  "other_service",
  "tooling_artwork_legacy",
]);

export const quoteChargeRecovery = pgTable(
  "quote_charge_recovery",
  {
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    chargeKey: recoveryCharge("charge_key").notNull(),
    mode: recoveryMode("mode").notNull(),
    electedAt: timestamp("elected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    electedByUserId: uuid("elected_by_user_id").references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.quoteId, t.chargeKey] })],
);

// The durable record, mirrored inside the send transaction so a sent revision
// can never inherit a later revision's election.
export const recoveryTreatment = pgEnum("recovery_treatment", [
  "unit_price",
  "separate_line",
  "absorbed",
]);

export const recoveryTreatmentSource = pgEnum("recovery_treatment_source", [
  "election",
  "legacy",
]);

/**
 * The frozen recovery INSTRUCTION — what Accounting acts on.
 *
 * Distinct from `quoteSnapshotChargeRecovery`, which freezes the ELECTION. A
 * legacy-placed charge has NO election row — absence of a row is the model's
 * load-bearing state — so an elections-keyed table records nothing for the
 * great majority of charges, and every live quote today is in exactly that
 * state. Freezing only elections would freeze nothing.
 *
 * One row per placed charge per (owner, tier), because placement is decided
 * there and a quote can hold one charge at several owners with different
 * treatments. One row per charge would have to pick, and picking would write a
 * false instruction.
 */
export const quoteSnapshotRecoveryInstructions = pgTable(
  "quote_snapshot_recovery_instructions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteSnapshotId: uuid("quote_snapshot_id")
      .notNull()
      .references(() => quoteSnapshots.id, { onDelete: "cascade" }),
    chargeKey: recoveryCharge("charge_key").notNull(),
    /** Assembly or quote-leaf id as text — the two are different tables and a
     * single FK cannot address both. Traceability, not a join key. */
    ownerRef: text("owner_ref").notNull(),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),

    treatment: recoveryTreatment("treatment").notNull(),
    treatmentSource: recoveryTreatmentSource("treatment_source").notNull(),

    /** What DPS pays. */
    cost: numeric("cost", { precision: 14, scale: 2 }).notNull(),
    /** What DPS intends to recover. NULL when no governed rate resolved — not
     * 0, which would say the charge recovers nothing (BV-013). */
    governedRecovery: numeric("governed_recovery", { precision: 14, scale: 2 }),
    /** What Accounting bills separately. 0 for an amortized charge, and that 0
     * IS the instruction rather than an absence. */
    separateInvoiceAmount: numeric("separate_invoice_amount", {
      precision: 14,
      scale: 2,
    }),
    /** The basis, present only where the recovery is FIXED: an ELECTED
     * unit-price placement, whose governed recovery is added after the pricing
     * ladder. NULL for a separately-billed charge, which was not spread over
     * anything, and NULL for a legacy allocated fee, whose recovered amount
     * moves with the quote-level adjustment — 1400 becomes 1400 x (1 + gpa). */
    amortizedPerUnit: numeric("amortized_per_unit", { precision: 14, scale: 6 }),
    tierQuantity: integer("tier_quantity"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("quote_snapshot_recovery_instructions_unique").on(
      t.quoteSnapshotId,
      t.chargeKey,
      t.ownerRef,
      t.tierId,
    ),
  ],
);

export const quoteSnapshotChargeRecovery = pgTable(
  "quote_snapshot_charge_recovery",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => quoteSnapshots.id, { onDelete: "cascade" }),
    chargeKey: recoveryCharge("charge_key").notNull(),
    mode: recoveryMode("mode").notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.chargeKey] })],
);

// ─── G4 · Customer presentation profile ─────────────────────────────────────
//
// What the operator has decided the customer will SEE. Not what the quote
// costs, not what it recommends, not what it says — only which of those facts
// are presented, and in what shape.
//
// ── THE OWNERSHIP LINE, AND WHY IT IS DRAWN HERE ────────────────────────────
//
// Four authorities described this record differently, and picking the easiest
// to wire would have created a second source of truth for a customer-facing
// fact. Edward's disposition (`docs/g4-presentation-profile-disposition.md`)
// splits by what KIND of fact each one is:
//
//   recommendation   → quote_tiers.recommended        (a quote fact)
//   note content     → quotes.customer_facing_notes   (a quote fact)
//   visibility · itemization · layout · shape → here  (presentation facts)
//
// Two of those were live questions. `quote_tiers.recommended` already existed
// with its own audit trail, so duplicating it here would have meant two columns
// answering "which tier do we recommend". `quotes.customer_facing_notes`
// already existed, was already authored on Setup, and already printed verbatim
// above How to accept — so a `customer_note` column here would have given one
// printed sentence two owners and two authoring surfaces, with nothing in the
// schema saying which one the customer receives. Both were caught by the §0.5
// pass before any DDL was written (`docs/g4-schema-verification.md`).
//
// Card 2 edits both kinds of fact. It says so, using the existing provenance
// grammar, rather than presenting a governed quote fact as a presentation
// choice.
//
// So: nothing economic, nothing contractual, nothing identifying, no
// recommendation and no note text. The schema is the enforcement.
//
// ── VERSIONING ──────────────────────────────────────────────────────────────
//
// Keyed `(quote_id, quote_version)` because `reviseQuote` bumps
// `version_number` on the SAME quotes row. Without the version in the key a
// revision would silently inherit nothing and the surface would fall back to
// defaults — an operator revising a sent quote would lose every presentation
// choice the customer has already seen.
//
// `reviseQuote` therefore copies this row forward transactionally, and edits
// after that point write only the NEW version. Copying forward is the easy
// half; never writing through to the record the customer already saw is the
// half that matters.
export const presentationProfile = pgTable(
  "presentation_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    quoteVersion: integer("quote_version").notNull(),

    // The existing pgEnums, deliberately. `pdf_layout` and `detail_level`
    // already exist and are already used by quotes.*_snapshot and
    // quote_snapshots. Minting a parallel vocabulary here would give one
    // concept two spellings at the type level.
    layout: pdfLayout("layout").notNull().default("tier_table"),
    detailLevel: detailLevel("detail_level").notNull().default("itemized"),

    // Required iff layout = 'single_tier' — enforced below rather than
    // remembered. ON DELETE SET NULL rather than CASCADE: deleting a tier must
    // not delete the presentation record for the whole quote.
    presentedTierId: uuid("presented_tier_id").references(() => quoteTiers.id, {
      onDelete: "set null",
    }),

    // Disclosure, never economics. `include_fee_lines = false` collapses the
    // ITEMIZATION and never removes the charge: the fold sentence still states
    // the total. "Hide the fee lines" and "omit the fees" are one edit apart
    // and the second is a customer-facing misstatement, so the distinction is
    // asserted by falsification in the tests rather than trusted here.
    includeFeeLines: boolean("include_fee_lines").notNull().default(true),
    includeTerms: boolean("include_terms").notNull().default(true),
    includeAddendum: boolean("include_addendum").notNull().default(false),
    // Whether the note PRINTS. What it SAYS is quotes.customer_facing_notes.
    includeNote: boolean("include_note").notNull().default(true),

    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("presentation_profile_quote_version_idx").on(
      t.quoteId,
      t.quoteVersion,
    ),
    check(
      "presentation_profile_presented_tier_required",
      sql`${t.layout} <> 'single_tier' OR ${t.presentedTierId} IS NOT NULL`,
    ),
  ],
);

// "Tiers shown" — the one presentation fact the reference's Card 2 needs that
// no existing column carries. Per-tier because that is what the control is: a
// toggle per tier, not a count and not a range.
//
// Absence means shown. A tier with no row here is presented, so adding a tier
// to a quote cannot silently hide it from a customer.
export const presentationProfileTier = pgTable(
  "presentation_profile_tier",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    quoteVersion: integer("quote_version").notNull(),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => quoteTiers.id, { onDelete: "cascade" }),
    shown: boolean("shown").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("presentation_profile_tier_idx").on(
      t.quoteId,
      t.quoteVersion,
      t.tierId,
    ),
  ],
);
