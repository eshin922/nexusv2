"use server";

import { and, asc, count, eq, gt, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  auditLog,
  freightCustomerArrangesMeta,
  freightLegGroups,
  freightLegs,
  freightLegTiers,
  quotes,
  quoteTiers,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  quoteByIdDraft,
  quoteForLeg,
  quoteForLegGroup,
} from "@/lib/quote-guards";
import { reconcileWarnings } from "./warnings";

// ---------------------------------------------------------------------------
// Slice R6.2 commit 2 — freight action layer rewrite against the
// multi-leg journey schema (freight_leg_groups / freight_legs /
// freight_leg_tiers / freight_customer_arranges_meta). Replaces the
// pre-R6.2 line-group action surface entirely.
//
// Surface map (each action below has a single semantic responsibility,
// matching the prototype + designer notes' affordance grain):
//
//   ─ Leg-group lifecycle
//   addLegGroup            · create a new journey container on a quote
//   updateLegGroupMetadata · journey label / display_order
//   deleteLegGroup         · cascade-delete (legs + leg-tiers + meta)
//
//   ─ Leg lifecycle
//   addLeg                 · create a leg + seed per-tier rate rows
//   updateLegMetadata      · head fields (direction, mode, carrier,
//                            incoterm, dates, treatment, label,
//                            origin/destination, crosses_border)
//   updateLegMarkup        · per-component pill override; audit-keyed
//                            `freight_leg_markup_updated` with
//                            diff_json.component discriminator (Gap 3)
//   updateLegCustoms       · duty_pct / tariff_pct JSONB write;
//                            `freight_leg_customs_updated` with from/to
//                            per changed key only (Gap 14)
//   moveLeg                · swap display_order with prev/next sibling
//                            within the same group (Gap 9 entry-order
//                            policy; drag-grip ships v1.1)
//   deleteLeg              · cascade-delete (leg-tiers + meta)
//
//   ─ Per-tier rate
//   updateLegTierCell      · total_freight + units_in_shipment override
//
//   ─ Customer-arranges meta (Gap 18 — own table for independent
//                              audit lifecycles per field)
//   updateCustomerArrangesMeta · customer_contact / audit_note upsert
//
// Validation rules per Gap 5 (warn-not-reject for date pairs +
// cross-leg sequential; hard-reject for out-of-range percents;
// nullable until Mark-Accepted for total_freight). Markup pcts
// range 0.0000 - 9.9999 (numeric(5,4) precision).
// ---------------------------------------------------------------------------

// ---- Snapshot types returned to client for controlled re-hydration ----

export type FreightLegGroupSnapshot = {
  id: string;
  quoteId: string;
  label: string;
  displayOrder: number;
};

export type FreightLegSnapshot = {
  id: string;
  legGroupId: string;
  direction: "inbound" | "outbound";
  label: string | null;
  origin: string | null;
  destination: string | null;
  crossesInternationalBorder: boolean;
  treatment: "bundled" | "pass_through";
  mode: FreightLegModeValue | null;
  carrier: string | null;
  incoterm: IncotermValue | null;
  cargoReadyDate: string | null;
  vesselEtd: string | null;
  freightMarkupPct: string;
  dutyMarkupPct: string;
  tariffMarkupPct: string;
  customs: { duty_pct?: number; tariff_pct?: number };
  displayOrder: number;
};

export type FreightLegTierSnapshot = {
  id: string;
  freightLegId: string;
  tierId: string;
  totalFreight: string | null;
  unitsInShipment: number | null;
};

export type FreightCustomerArrangesMetaSnapshot = {
  freightLegId: string;
  customerContact: string | null;
  auditNote: string | null;
};

// ---- Enum vocabularies (mirror DB enums one-for-one) ----

const FREIGHT_LEG_MODES = [
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
] as const;
type FreightLegModeValue = (typeof FREIGHT_LEG_MODES)[number];

const INCOTERMS = ["DDP", "DAP", "FOB", "EXW", "FCA", "CIF"] as const;
type IncotermValue = (typeof INCOTERMS)[number];

const DIRECTIONS = ["inbound", "outbound"] as const;
type DirectionValue = (typeof DIRECTIONS)[number];

const TREATMENTS = ["bundled", "pass_through"] as const;
type TreatmentValue = (typeof TREATMENTS)[number];

// numeric(5,4) precision: ±9.9999. Per Gap 5 disposition the action
// layer enforces 0 ≤ markup ≤ 9.9999 (covers Cally's tariff-anomaly
// zero-markup case + forwarder edge weirdness).
const MARKUP_MIN = 0;
const MARKUP_MAX = 9.9999;
const CUSTOMS_PCT_MIN = 0;
const CUSTOMS_PCT_MAX = 9.9999;

// ---- helpers ----

type Diff = Record<string, { from: unknown; to: unknown }>;

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

function trimOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function parseNumericOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? s : null;
}

function parseIntOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: FormDataEntryValue | null): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "on";
}

function parseDirection(v: FormDataEntryValue | null): DirectionValue {
  const s = trimOrNull(v);
  return s === "inbound" ? "inbound" : "outbound";
}

function parseTreatment(v: FormDataEntryValue | null): TreatmentValue {
  const s = trimOrNull(v);
  return s === "pass_through" ? "pass_through" : "bundled";
}

function parseLegMode(
  v: FormDataEntryValue | null,
): FreightLegModeValue | null {
  const s = trimOrNull(v);
  if (!s) return null;
  return (FREIGHT_LEG_MODES as readonly string[]).includes(s)
    ? (s as FreightLegModeValue)
    : null;
}

function parseIncoterm(v: FormDataEntryValue | null): IncotermValue | null {
  const s = trimOrNull(v);
  if (!s) return null;
  return (INCOTERMS as readonly string[]).includes(s)
    ? (s as IncotermValue)
    : null;
}

// PostgreSQL date columns: "YYYY-MM-DD" strings. Empty / invalid → null.
function parseDateOrNull(v: FormDataEntryValue | null): string | null {
  const s = trimOrNull(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

// Markup pct: form arrives as percent display ("30" for 30%). Store
// as decimal ("0.3000"). Enforces 0 ≤ value ≤ 9.9999 per Gap 5.
function parseMarkupPct(v: FormDataEntryValue | null): string {
  const s = String(v ?? "").trim();
  if (s === "") return "0.3000";
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "Markup pct must be a number.",
    );
  }
  const dec = n / 100;
  if (dec < MARKUP_MIN || dec > MARKUP_MAX) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `Markup pct out of range (0 - 999.99%).`,
    );
  }
  return dec.toString();
}

// Customs pct: form arrives as percent display ("5.8" for 5.8%).
// JSONB stores as decimal (0.058). Range 0 - 9.9999.
function parseCustomsPct(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "Customs pct must be a number.",
    );
  }
  const dec = n / 100;
  if (dec < CUSTOMS_PCT_MIN || dec > CUSTOMS_PCT_MAX) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `Customs pct out of range (0 - 999.99%).`,
    );
  }
  return dec;
}

function numericEquals(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Number(a) === Number(b);
}

// ---- read helpers ----

// Counts leg-groups for the quote. Used by tier-preset confirm
// dialog warning (mirrors the legacy countFreightLinesForQuote shape).
export async function countFreightLegGroupsForQuote(
  quoteId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(freightLegGroups)
    .where(eq(freightLegGroups.quoteId, quoteId));
  return row?.count ?? 0;
}

// Counts (leg, tier) rate rows with non-null total_freight or
// units_in_shipment — for the tier-preset dialog "data loss" signal.
export async function countFreightLegTiersWithDataForQuote(
  quoteId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(freightLegTiers)
    .innerJoin(freightLegs, eq(freightLegs.id, freightLegTiers.freightLegId))
    .innerJoin(
      freightLegGroups,
      eq(freightLegGroups.id, freightLegs.legGroupId),
    )
    .where(
      and(
        eq(freightLegGroups.quoteId, quoteId),
        sql`(${freightLegTiers.totalFreight} IS NOT NULL OR ${freightLegTiers.unitsInShipment} IS NOT NULL)`,
      ),
    );
  return row?.count ?? 0;
}

// ---- leg-group actions ----

// Create a new leg-group on a quote. Optional label; defaults to
// "Outbound · journey N" where N is (existing groups + 1).
export async function addLegGroup(
  formData: FormData,
): Promise<ActionResult<FreightLegGroupSnapshot>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

    const user = await ensureUser();
    const quote = await quoteByIdDraft(quoteId);

    const labelParam = trimOrNull(formData.get("label"));
    const existing = await db
      .select({ max: max(freightLegGroups.displayOrder) })
      .from(freightLegGroups)
      .where(eq(freightLegGroups.quoteId, quoteId));
    const displayOrder = (existing[0]?.max ?? -1) + 1;
    const label = labelParam ?? `Outbound · journey ${displayOrder + 1}`;

    const [inserted] = await db
      .insert(freightLegGroups)
      .values({ quoteId, label, displayOrder })
      .returning();

    await logAudit({
      userId: user.id,
      entityType: "freight_leg_group",
      entityId: inserted.id,
      action: "created",
      diffJson: { quote_id: quoteId, label, display_order: displayOrder },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      id: inserted.id,
      quoteId: inserted.quoteId,
      label: inserted.label,
      displayOrder: inserted.displayOrder,
    };
  });
}

export async function updateLegGroupMetadata(
  formData: FormData,
): Promise<ActionResult<FreightLegGroupSnapshot>> {
  return runAction(async () => {
    const legGroupId = String(formData.get("legGroupId") ?? "").trim();
    if (!legGroupId)
      throw new ActionGuardError(ERR.VALIDATION, "legGroupId required");

    const user = await ensureUser();
    const { quote, group } = await quoteForLegGroup(legGroupId);

    const newLabel = trimOrNull(formData.get("label")) ?? group.label;

    if (newLabel === group.label) {
      return {
        id: group.id,
        quoteId: group.quoteId,
        label: group.label,
        displayOrder: group.displayOrder,
      };
    }

    await db
      .update(freightLegGroups)
      .set({ label: newLabel, updatedAt: new Date() })
      .where(eq(freightLegGroups.id, legGroupId));

    await logAudit({
      userId: user.id,
      entityType: "freight_leg_group",
      entityId: legGroupId,
      action: "updated",
      diffJson: { label: { from: group.label, to: newLabel } },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      id: group.id,
      quoteId: group.quoteId,
      label: newLabel,
      displayOrder: group.displayOrder,
    };
  });
}

export async function deleteLegGroup(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const legGroupId = String(formData.get("legGroupId") ?? "").trim();
    if (!legGroupId)
      throw new ActionGuardError(ERR.VALIDATION, "legGroupId required");

    const user = await ensureUser();
    const { quote, group } = await quoteForLegGroup(legGroupId);

    // Snapshot the cascade footprint before the FK cascade fires —
    // matches the pattern from Slice 5.5 deleteSku.
    const legsRows = await db
      .select({ id: freightLegs.id })
      .from(freightLegs)
      .where(eq(freightLegs.legGroupId, legGroupId));
    const legIds = legsRows.map((r) => r.id);
    let cascadedLegTiers = 0;
    if (legIds.length > 0) {
      const [row] = await db
        .select({ count: count() })
        .from(freightLegTiers)
        .where(sql`${freightLegTiers.freightLegId} = ANY(${legIds})`);
      cascadedLegTiers = row?.count ?? 0;
    }

    await db
      .delete(freightLegGroups)
      .where(eq(freightLegGroups.id, legGroupId));

    await logAudit({
      userId: user.id,
      entityType: "freight_leg_group",
      entityId: legGroupId,
      action: "deleted",
      diffJson: {
        label: group.label,
        cascade: {
          legs: legIds.length,
          leg_tiers: cascadedLegTiers,
        },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);
  });
}

// ---- leg actions ----

// Create a new leg in an existing group. The form arrives with the
// full leg head + optional initial per-tier rates. Per Gap 10 the
// add-leg modal can carry either an explicit leg-group association
// or rely on auto-create (handled in the calling component).
//
// Per-tier rate rows for active tiers are seeded as NULL placeholders
// so the per-tier rate table renders on the leg immediately after add;
// PMs fill values into existing rows rather than creating new ones.
export async function addLeg(
  formData: FormData,
): Promise<ActionResult<FreightLegSnapshot>> {
  return runAction(async () => {
    const legGroupId = String(formData.get("legGroupId") ?? "").trim();
    if (!legGroupId)
      throw new ActionGuardError(ERR.VALIDATION, "legGroupId required");

    const user = await ensureUser();
    const { quote } = await quoteForLegGroup(legGroupId);

    const direction = parseDirection(formData.get("direction"));
    const label = trimOrNull(formData.get("label"));
    const origin = trimOrNull(formData.get("origin"));
    const destination = trimOrNull(formData.get("destination"));
    const crossesBorder = parseBool(
      formData.get("crossesInternationalBorder"),
    );
    const treatment = parseTreatment(formData.get("treatment"));
    const mode = parseLegMode(formData.get("mode"));
    const carrier = trimOrNull(formData.get("carrier"));
    const incoterm = parseIncoterm(formData.get("incoterm"));
    const cargoReadyDate = parseDateOrNull(formData.get("cargoReadyDate"));
    const vesselEtd = parseDateOrNull(formData.get("vesselEtd"));
    // Markup pcts default 0.3000 when omitted; parseMarkupPct returns
    // "0.3000" on empty input.
    const freightMarkupPct = parseMarkupPct(formData.get("freightMarkupPct"));
    const dutyMarkupPct = parseMarkupPct(formData.get("dutyMarkupPct"));
    const tariffMarkupPct = parseMarkupPct(formData.get("tariffMarkupPct"));
    const dutyPctRaw = parseCustomsPct(formData.get("dutyPct"));
    const tariffPctRaw = parseCustomsPct(formData.get("tariffPct"));
    const customs: Record<string, number> = {};
    if (dutyPctRaw !== null) customs.duty_pct = dutyPctRaw;
    if (tariffPctRaw !== null) customs.tariff_pct = tariffPctRaw;

    // Gap 5 — required-fields gate per incoterm class.
    if (incoterm === "DDP" || incoterm === "DAP") {
      if (!cargoReadyDate) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Cargo ready date is required on DDP / DAP legs.",
        );
      }
      if (!vesselEtd) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Vessel ETD is required on DDP / DAP legs.",
        );
      }
    }

    // Gap 9 — display_order is entry sequence; pick (max + 1) within group.
    const orderRow = await db
      .select({ max: max(freightLegs.displayOrder) })
      .from(freightLegs)
      .where(eq(freightLegs.legGroupId, legGroupId));
    const displayOrder = (orderRow[0]?.max ?? -1) + 1;

    const [inserted] = await db
      .insert(freightLegs)
      .values({
        legGroupId,
        direction,
        label,
        origin,
        destination,
        crossesInternationalBorder: crossesBorder,
        treatment,
        mode,
        carrier,
        incoterm,
        cargoReadyDate,
        vesselEtd,
        freightMarkupPct,
        dutyMarkupPct,
        tariffMarkupPct,
        customs,
        displayOrder,
      })
      .returning();

    // Seed per-tier rate rows for every active tier on the quote.
    // Optional per-tier seed values from the Add Leg modal arrive as
    // `tierRate_<tierId>` formdata entries — PMs typically know rates
    // up-front from the forwarder quote and enter them in the modal.
    // Non-positive / non-finite values silently fall back to null so
    // PMs can still leave a tier blank from the modal.
    const tiers = await db
      .select({ id: quoteTiers.id })
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quote.id))
      .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt));
    let seededCount = 0;
    if (tiers.length > 0) {
      await db.insert(freightLegTiers).values(
        tiers.map((t) => {
          const raw = parseNumericOrNull(formData.get(`tierRate_${t.id}`));
          const n = raw === null ? null : Number(raw);
          const totalFreight =
            n !== null && Number.isFinite(n) && n >= 0 ? raw : null;
          if (totalFreight !== null) seededCount += 1;
          return {
            freightLegId: inserted.id,
            tierId: t.id,
            totalFreight,
            unitsInShipment: null,
          };
        }),
      );
    }

    await logAudit({
      userId: user.id,
      entityType: "freight_leg",
      entityId: inserted.id,
      action: "created",
      diffJson: {
        leg_group_id: legGroupId,
        direction,
        treatment,
        mode,
        incoterm,
        crosses_international_border: crossesBorder,
        tier_count: tiers.length,
        tier_rates_seeded: seededCount,
        display_order: displayOrder,
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return shapeLegSnapshot(inserted);
  });
}

// Update leg head metadata. Single semantic action for the body grid
// fields — direction, label, origin/destination, crosses_border,
// treatment, mode, carrier, incoterm, cargo_ready_date, vessel_etd.
// Per-component markup pcts have their own action (separate audit
// keys per Gap 3); customs JSONB has its own (Gap 14).
export async function updateLegMetadata(
  formData: FormData,
): Promise<ActionResult<FreightLegSnapshot>> {
  return runAction(async () => {
    const legId = String(formData.get("legId") ?? "").trim();
    if (!legId) throw new ActionGuardError(ERR.VALIDATION, "legId required");

    const user = await ensureUser();
    const { quote, leg } = await quoteForLeg(legId);

    const next: Record<string, unknown> = {};
    if (formData.has("direction"))
      next.direction = parseDirection(formData.get("direction"));
    if (formData.has("label"))
      next.label = trimOrNull(formData.get("label"));
    if (formData.has("origin"))
      next.origin = trimOrNull(formData.get("origin"));
    if (formData.has("destination"))
      next.destination = trimOrNull(formData.get("destination"));
    if (formData.has("crossesInternationalBorder"))
      next.crossesInternationalBorder = parseBool(
        formData.get("crossesInternationalBorder"),
      );
    if (formData.has("treatment"))
      next.treatment = parseTreatment(formData.get("treatment"));
    if (formData.has("mode"))
      next.mode = parseLegMode(formData.get("mode"));
    if (formData.has("carrier"))
      next.carrier = trimOrNull(formData.get("carrier"));
    if (formData.has("incoterm"))
      next.incoterm = parseIncoterm(formData.get("incoterm"));
    if (formData.has("cargoReadyDate"))
      next.cargoReadyDate = parseDateOrNull(formData.get("cargoReadyDate"));
    if (formData.has("vesselEtd"))
      next.vesselEtd = parseDateOrNull(formData.get("vesselEtd"));

    // Gap 5 — required-fields gate when incoterm transitions to DDP/DAP.
    const effectiveIncoterm = (next.incoterm ?? leg.incoterm) as
      | IncotermValue
      | null;
    if (effectiveIncoterm === "DDP" || effectiveIncoterm === "DAP") {
      const effCargoReady =
        next.cargoReadyDate !== undefined
          ? (next.cargoReadyDate as string | null)
          : leg.cargoReadyDate;
      const effEtd =
        next.vesselEtd !== undefined
          ? (next.vesselEtd as string | null)
          : leg.vesselEtd;
      if (!effCargoReady) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Cargo ready date is required on DDP / DAP legs.",
        );
      }
      if (!effEtd) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Vessel ETD is required on DDP / DAP legs.",
        );
      }
    }

    // Build diff against current row; skip if no-op.
    const before: Record<string, unknown> = {
      direction: leg.direction,
      label: leg.label,
      origin: leg.origin,
      destination: leg.destination,
      crosses_international_border: leg.crossesInternationalBorder,
      treatment: leg.treatment,
      mode: leg.mode,
      carrier: leg.carrier,
      incoterm: leg.incoterm,
      cargo_ready_date: leg.cargoReadyDate,
      vessel_etd: leg.vesselEtd,
    };
    const diffKeyMap: Record<string, string> = {
      direction: "direction",
      label: "label",
      origin: "origin",
      destination: "destination",
      crossesInternationalBorder: "crosses_international_border",
      treatment: "treatment",
      mode: "mode",
      carrier: "carrier",
      incoterm: "incoterm",
      cargoReadyDate: "cargo_ready_date",
      vesselEtd: "vessel_etd",
    };

    const diff: Diff = {};
    for (const [k, v] of Object.entries(next)) {
      const auditKey = diffKeyMap[k];
      if (before[auditKey] !== v) {
        diff[auditKey] = { from: before[auditKey], to: v };
      }
    }

    if (Object.keys(diff).length === 0) {
      return shapeLegSnapshot(leg);
    }

    await db
      .update(freightLegs)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(freightLegs.id, legId));

    // Slice 9.5 — reconcile validation warnings on action commit.
    const cascade = await reconcileWarnings({ quoteId: quote.id });

    await logAudit({
      userId: user.id,
      entityType: "freight_leg",
      entityId: legId,
      action: "updated",
      diffJson:
        cascade.inserted + cascade.resolved + cascade.evaluated > 0
          ? { ...diff, cascaded_warnings: cascade }
          : diff,
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    const [refreshed] = await db
      .select()
      .from(freightLegs)
      .where(eq(freightLegs.id, legId))
      .limit(1);
    return shapeLegSnapshot(refreshed);
  });
}

// Per-component markup pill override. Per Gap 3 disposition: single
// audit action `freight_leg_markup_updated` with diff_json.component
// discriminator (`freight` | `duty` | `tariff`); from/to in decimals.
// Per Gap 13 the on-blur path: empty → revert (no-op); range checked.
export async function updateLegMarkup(
  formData: FormData,
): Promise<ActionResult<FreightLegSnapshot>> {
  return runAction(async () => {
    const legId = String(formData.get("legId") ?? "").trim();
    const component = String(formData.get("component") ?? "").trim();
    if (!legId) throw new ActionGuardError(ERR.VALIDATION, "legId required");
    if (
      component !== "freight" &&
      component !== "duty" &&
      component !== "tariff"
    ) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Unsupported markup component: ${component}`,
      );
    }

    const user = await ensureUser();
    const { quote, leg } = await quoteForLeg(legId);

    const newPct = parseMarkupPct(formData.get("value"));
    const colKey =
      component === "freight"
        ? "freightMarkupPct"
        : component === "duty"
          ? "dutyMarkupPct"
          : "tariffMarkupPct";
    const beforePct = leg[colKey];

    if (numericEquals(beforePct, newPct)) {
      return shapeLegSnapshot(leg);
    }

    await db
      .update(freightLegs)
      .set({ [colKey]: newPct, updatedAt: new Date() })
      .where(eq(freightLegs.id, legId));

    await logAudit({
      userId: user.id,
      entityType: "freight_leg",
      entityId: legId,
      action: "freight_leg_markup_updated",
      diffJson: {
        component,
        from: beforePct,
        to: newPct,
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    const [refreshed] = await db
      .select()
      .from(freightLegs)
      .where(eq(freightLegs.id, legId))
      .limit(1);
    return shapeLegSnapshot(refreshed);
  });
}

// Customs JSONB update. Per Gap 14: log `freight_leg_customs_updated`
// with from/to per CHANGED key only; never log the full JSONB blob.
// Both keys nullable — empty form value clears that key.
export async function updateLegCustoms(
  formData: FormData,
): Promise<ActionResult<FreightLegSnapshot>> {
  return runAction(async () => {
    const legId = String(formData.get("legId") ?? "").trim();
    if (!legId) throw new ActionGuardError(ERR.VALIDATION, "legId required");

    const user = await ensureUser();
    const { quote, leg } = await quoteForLeg(legId);

    const currentCustoms = (leg.customs as {
      duty_pct?: number;
      tariff_pct?: number;
    }) ?? {};
    const next: { duty_pct?: number; tariff_pct?: number } = {
      ...currentCustoms,
    };
    const diff: Diff = {};

    if (formData.has("dutyPct")) {
      const v = parseCustomsPct(formData.get("dutyPct"));
      if (v === null) delete next.duty_pct;
      else next.duty_pct = v;
      if (currentCustoms.duty_pct !== next.duty_pct) {
        diff.duty_pct = {
          from: currentCustoms.duty_pct ?? null,
          to: next.duty_pct ?? null,
        };
      }
    }
    if (formData.has("tariffPct")) {
      const v = parseCustomsPct(formData.get("tariffPct"));
      if (v === null) delete next.tariff_pct;
      else next.tariff_pct = v;
      if (currentCustoms.tariff_pct !== next.tariff_pct) {
        diff.tariff_pct = {
          from: currentCustoms.tariff_pct ?? null,
          to: next.tariff_pct ?? null,
        };
      }
    }

    if (Object.keys(diff).length === 0) {
      return shapeLegSnapshot(leg);
    }

    await db
      .update(freightLegs)
      .set({ customs: next, updatedAt: new Date() })
      .where(eq(freightLegs.id, legId));

    // Slice 9.5 — reconcile validation warnings.
    const cascade = await reconcileWarnings({ quoteId: quote.id });

    await logAudit({
      userId: user.id,
      entityType: "freight_leg",
      entityId: legId,
      action: "freight_leg_customs_updated",
      diffJson:
        cascade.inserted + cascade.resolved + cascade.evaluated > 0
          ? { ...diff, cascaded_warnings: cascade }
          : diff,
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    const [refreshed] = await db
      .select()
      .from(freightLegs)
      .where(eq(freightLegs.id, legId))
      .limit(1);
    return shapeLegSnapshot(refreshed);
  });
}

// Per-(leg, tier) rate cell. PM enters total freight $; optional
// units_in_shipment override (yield mismatch). Either value can be
// null (PM clears the input).
export async function updateLegTierCell(
  formData: FormData,
): Promise<ActionResult<FreightLegTierSnapshot>> {
  return runAction(async () => {
    const rowId = String(formData.get("rowId") ?? "").trim();
    if (!rowId) throw new ActionGuardError(ERR.VALIDATION, "rowId required");

    const user = await ensureUser();
    const rows = await db
      .select({
        row: freightLegTiers,
        leg: freightLegs,
        group: freightLegGroups,
        quote: quotes,
      })
      .from(freightLegTiers)
      .innerJoin(freightLegs, eq(freightLegs.id, freightLegTiers.freightLegId))
      .innerJoin(
        freightLegGroups,
        eq(freightLegGroups.id, freightLegs.legGroupId),
      )
      .innerJoin(quotes, eq(quotes.id, freightLegGroups.quoteId))
      .where(eq(freightLegTiers.id, rowId))
      .limit(1);
    if (rows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Leg rate cell not found");
    const { row, quote } = rows[0];
    if (quote.status !== "draft") {
      throw new ActionGuardError(
        ERR.QUOTE_NOT_DRAFT,
        `Quote is ${quote.status} and not editable.`,
      );
    }

    const newTotalFreight = parseNumericOrNull(formData.get("totalFreight"));
    const newUnitsInShipment = parseIntOrNull(formData.get("unitsInShipment"));

    const diff: Diff = {};
    if (!numericEquals(row.totalFreight, newTotalFreight)) {
      diff.total_freight = {
        from: row.totalFreight,
        to: newTotalFreight,
      };
    }
    if (row.unitsInShipment !== newUnitsInShipment) {
      diff.units_in_shipment = {
        from: row.unitsInShipment,
        to: newUnitsInShipment,
      };
    }

    if (Object.keys(diff).length === 0) {
      return {
        id: row.id,
        freightLegId: row.freightLegId,
        tierId: row.tierId,
        totalFreight: row.totalFreight,
        unitsInShipment: row.unitsInShipment,
      };
    }

    await db
      .update(freightLegTiers)
      .set({
        totalFreight: newTotalFreight,
        unitsInShipment: newUnitsInShipment,
        updatedAt: new Date(),
      })
      .where(eq(freightLegTiers.id, rowId));

    const cascade = await reconcileWarnings({ quoteId: quote.id });

    await logAudit({
      userId: user.id,
      entityType: "freight_leg_tier",
      entityId: rowId,
      action: "updated",
      diffJson:
        cascade.inserted + cascade.resolved + cascade.evaluated > 0
          ? { ...diff, cascaded_warnings: cascade }
          : diff,
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      id: rowId,
      freightLegId: row.freightLegId,
      tierId: row.tierId,
      totalFreight: newTotalFreight,
      unitsInShipment: newUnitsInShipment,
    };
  });
}

// Reorder legs within a leg-group by swapping display_order with the
// prev or next sibling. Per Gap 9 entry-order is the v1 policy;
// drag-grip ships v1.1.
export async function moveLeg(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const legId = String(formData.get("legId") ?? "").trim();
    const direction = String(formData.get("direction") ?? "") as
      | "up"
      | "down";
    if (!legId) throw new ActionGuardError(ERR.VALIDATION, "legId required");
    if (direction !== "up" && direction !== "down") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "direction must be 'up' or 'down'",
      );
    }

    const user = await ensureUser();
    const { quote, leg } = await quoteForLeg(legId);

    const siblings = await db
      .select({ id: freightLegs.id, displayOrder: freightLegs.displayOrder })
      .from(freightLegs)
      .where(eq(freightLegs.legGroupId, leg.legGroupId))
      .orderBy(asc(freightLegs.displayOrder));
    const idx = siblings.findIndex((s) => s.id === legId);
    const swap =
      direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
    if (!swap) return;

    await db.transaction(async (tx) => {
      await tx
        .update(freightLegs)
        .set({ displayOrder: swap.displayOrder, updatedAt: new Date() })
        .where(eq(freightLegs.id, legId));
      await tx
        .update(freightLegs)
        .set({ displayOrder: leg.displayOrder, updatedAt: new Date() })
        .where(eq(freightLegs.id, swap.id));
    });

    await logAudit({
      userId: user.id,
      entityType: "freight_leg",
      entityId: legId,
      action: "reordered",
      diffJson: {
        display_order: { from: leg.displayOrder, to: swap.displayOrder },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);
  });
}

export async function deleteLeg(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const legId = String(formData.get("legId") ?? "").trim();
    if (!legId) throw new ActionGuardError(ERR.VALIDATION, "legId required");

    const user = await ensureUser();
    const { quote, leg } = await quoteForLeg(legId);

    // Cascade snapshot — count leg-tiers + customer-arranges-meta
    // that will FK-cascade-delete with the leg.
    const [tierCountRow] = await db
      .select({ count: count() })
      .from(freightLegTiers)
      .where(eq(freightLegTiers.freightLegId, legId));
    const cascadedLegTiers = tierCountRow?.count ?? 0;
    const metaRows = await db
      .select({ count: count() })
      .from(freightCustomerArrangesMeta)
      .where(eq(freightCustomerArrangesMeta.freightLegId, legId));
    const cascadedMeta = metaRows[0]?.count ?? 0;

    await db.delete(freightLegs).where(eq(freightLegs.id, legId));

    await logAudit({
      userId: user.id,
      entityType: "freight_leg",
      entityId: legId,
      action: "deleted",
      diffJson: {
        leg_group_id: leg.legGroupId,
        label: leg.label,
        mode: leg.mode,
        incoterm: leg.incoterm,
        cascade: {
          leg_tiers: cascadedLegTiers,
          customer_arranges_meta: cascadedMeta,
        },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);
  });
}

// ---- customer-arranges meta ----

// Upsert customer-arranges metadata for a leg. Per Gap 18 the
// customer-arranges meta lives in its own table so customer_contact
// + audit_note have independent audit-log lifecycles. v1 schema has
// `cargo_ready_date` promoted to the leg head (Pushback 3 resolution);
// the meta table only carries the two fields here.
export async function updateCustomerArrangesMeta(
  formData: FormData,
): Promise<ActionResult<FreightCustomerArrangesMetaSnapshot>> {
  return runAction(async () => {
    const legId = String(formData.get("legId") ?? "").trim();
    if (!legId) throw new ActionGuardError(ERR.VALIDATION, "legId required");

    const user = await ensureUser();
    const { quote } = await quoteForLeg(legId);

    const newContact = trimOrNull(formData.get("customerContact"));
    const newAudit = trimOrNull(formData.get("auditNote"));

    const existingRows = await db
      .select()
      .from(freightCustomerArrangesMeta)
      .where(eq(freightCustomerArrangesMeta.freightLegId, legId))
      .limit(1);
    const existing = existingRows[0] ?? null;

    const diff: Diff = {};
    if (!existing || existing.customerContact !== newContact) {
      diff.customer_contact = {
        from: existing?.customerContact ?? null,
        to: newContact,
      };
    }
    if (!existing || existing.auditNote !== newAudit) {
      diff.audit_note = {
        from: existing?.auditNote ?? null,
        to: newAudit,
      };
    }

    if (Object.keys(diff).length === 0 && existing) {
      return {
        freightLegId: legId,
        customerContact: existing.customerContact,
        auditNote: existing.auditNote,
      };
    }

    if (existing) {
      await db
        .update(freightCustomerArrangesMeta)
        .set({
          customerContact: newContact,
          auditNote: newAudit,
          updatedAt: new Date(),
        })
        .where(eq(freightCustomerArrangesMeta.freightLegId, legId));
    } else {
      await db.insert(freightCustomerArrangesMeta).values({
        freightLegId: legId,
        customerContact: newContact,
        auditNote: newAudit,
      });
    }

    await logAudit({
      userId: user.id,
      entityType: "freight_customer_arranges_meta",
      entityId: legId,
      action: existing ? "updated" : "created",
      diffJson: diff,
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      freightLegId: legId,
      customerContact: newContact,
      auditNote: newAudit,
    };
  });
}

// ---- internal: shape a leg row to the snapshot type ----

function shapeLegSnapshot(
  leg: typeof freightLegs.$inferSelect,
): FreightLegSnapshot {
  return {
    id: leg.id,
    legGroupId: leg.legGroupId,
    direction: leg.direction,
    label: leg.label,
    origin: leg.origin,
    destination: leg.destination,
    crossesInternationalBorder: leg.crossesInternationalBorder,
    treatment: leg.treatment,
    mode: leg.mode,
    carrier: leg.carrier,
    incoterm: leg.incoterm,
    cargoReadyDate: leg.cargoReadyDate,
    vesselEtd: leg.vesselEtd,
    freightMarkupPct: leg.freightMarkupPct,
    dutyMarkupPct: leg.dutyMarkupPct,
    tariffMarkupPct: leg.tariffMarkupPct,
    customs:
      (leg.customs as { duty_pct?: number; tariff_pct?: number }) ?? {},
    displayOrder: leg.displayOrder,
  };
}

// gt is imported but referenced indirectly (compatibility export for
// future warning queries; remove if eslint flags as unused).
void gt;
