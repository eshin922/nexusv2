"use server";

import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, firmSettings, projects, quotes } from "@/db/schema";
import { writeAuditEntry, writeAuditEntryReturningId } from "@/lib/audit";
import { requireAdminAction } from "@/lib/admin-guard";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { getQuoteCosting } from "./costing";
import type { QuoteMarginStatus } from "@/lib/costing";

// Firm-level policy admin actions. The /admin layout already gates
// access via requireAdmin, but each action calls it again — defense in
// depth. Action endpoints are reachable without going through the
// layout.

function pctDisplayToDecimalString(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return (n / 100).toString();
}

function trimOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function parseIntOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export type FirmSettingsRow = typeof firmSettings.$inferSelect;

export async function listFirmSettingsHistory(): Promise<
  ActionResult<FirmSettingsRow[]>
> {
  return runAction(async () => {
    await requireAdminAction();
    const rows = await db
      .select()
      .from(firmSettings)
      .orderBy(desc(firmSettings.effectiveFrom));
    return rows;
  });
}

// Slice RI.7 — versioned-insert helper. RI.7 adds 9 new firm_settings
// columns alongside the existing target/floor margin pair. Every
// versioned update must carry forward all columns from the prior
// current row; otherwise a vendor_identity edit would null out
// target_margin_pct (and vice versa). Helper centralizes the
// carry-forward + new-row insert + audit-log so both updateFirmSettings
// (margin policy) and updateFirmSettingsCustomerFacingDefaults (vendor
// + commercial defaults) stay consistent.
//
// The `overrides` arg specifies which columns the caller is editing;
// the helper merges them over the prior row, closes the prior row,
// inserts the new row, and writes the audit log entry with structured
// diff. Caller supplies the effective_from date (typically today) and
// the audit_log diff_json shape (subset of changed columns).
async function versionedFirmSettingsUpdate(args: {
  adminUserId: string;
  effectiveFromStr: string;
  overrides: Partial<typeof firmSettings.$inferInsert>;
  auditDiff: { from: Record<string, unknown> | null; to: Record<string, unknown> };
}): Promise<FirmSettingsRow> {
  const { adminUserId, effectiveFromStr, overrides, auditDiff } = args;
  return await db.transaction(async (tx) => {
    const [prior] = await tx
      .select()
      .from(firmSettings)
      .where(isNull(firmSettings.effectiveUntil))
      .orderBy(desc(firmSettings.effectiveFrom))
      .limit(1);

    if (prior) {
      await tx
        .update(firmSettings)
        .set({ effectiveUntil: effectiveFromStr })
        .where(eq(firmSettings.id, prior.id));
    }

    // Carry-forward: start from prior row's columns, override with
    // caller's edits. id / effective_from / effective_until /
    // updated_by_user_id / updated_at all explicitly set to new values.
    const newRow: typeof firmSettings.$inferInsert = {
      // Margin (carry-forward; updateFirmSettings overrides these)
      targetMarginPct: prior?.targetMarginPct ?? "0.3500",
      floorMarginPct: prior?.floorMarginPct ?? "0.2500",
      freightMarkupPctDefault: prior?.freightMarkupPctDefault ?? "0.3000",
      // slice-pricing-surface-redesign Step 2 — policy gates carry
      // forward (default true preserves current production behavior).
      // Future per-firm admin UI will edit these via a Pricing-policy
      // sub-action that supplies overrides; existing margin / CFD
      // update paths leave them unchanged.
      allowOverride: prior?.allowOverride ?? true,
      allowAcceptRisk: prior?.allowAcceptRisk ?? true,
      // Vendor identity (carry-forward; CFD action overrides these)
      vendorName: prior?.vendorName ?? null,
      vendorTagline: prior?.vendorTagline ?? null,
      vendorAddress: prior?.vendorAddress ?? null,
      // Customer-facing commercial defaults (carry-forward)
      quoteNumberPrefix: prior?.quoteNumberPrefix ?? null,
      tcsDefault: prior?.tcsDefault ?? null,
      paymentTermsDefault: prior?.paymentTermsDefault ?? null,
      leadTimeDefault: prior?.leadTimeDefault ?? null,
      incotermsDefault: prior?.incotermsDefault ?? null,
      daysValidDefault: prior?.daysValidDefault ?? null,
      // Slice 12 Step 3 — HARD GATE per CLAUDE.md "Versioned-table
      // carry-forward audit". Two new external-integration defaults
      // added on firm_settings (v3 brief §5); both carry forward on
      // every versioned update so a margin-only edit doesn't silently
      // reset them. Column defaults ('Closed Won' / 'Pending
      // Fulfillment') seed the current active row on migration.
      hubspotDealStageOnAccept:
        prior?.hubspotDealStageOnAccept ?? "Closed Won",
      netsuiteSoStatusOnCreate:
        prior?.netsuiteSoStatusOnCreate ?? "Pending Fulfillment",
      // Slack approval channel — SAME HARD GATE. Without this line a
      // margin-only edit inserts a new row with a NULL channel, approval
      // requests silently stop being delivered, and nothing reports an error.
      // Regression: tests/unit/firm-settings-slack-channel-carry-forward.test.ts
      slackApprovalChannelId: prior?.slackApprovalChannelId ?? null,
      // Override with caller's edits
      ...overrides,
      // Versioning fields (always new)
      effectiveFrom: effectiveFromStr,
      effectiveUntil: null,
      updatedByUserId: adminUserId,
    };

    const [created] = await tx.insert(firmSettings).values(newRow).returning();

    await writeAuditEntry({
      userId: adminUserId,
      entityType: "firm_settings",
      entityId: created.id,
      action: "firm_settings_updated",
      diffJson: auditDiff,
    }, tx);

    return created;
  });
}

// Validation: floor < target, both > 0, both < 1. Postgres also enforces
// numeric(5,4) bounds; client validation prevents the obvious mistakes
// (typing 35 vs 0.35) before the action fires.
export async function updateFirmSettings(
  formData: FormData,
): Promise<ActionResult<FirmSettingsRow>> {
  return runAction(async () => {
    const admin = await requireAdminAction();

    const target = pctDisplayToDecimalString(formData.get("targetMarginPct"));
    const floor = pctDisplayToDecimalString(formData.get("floorMarginPct"));
    const effectiveFromStr = String(formData.get("effectiveFrom") ?? "").trim();

    if (target === null) {
      throw new ActionGuardError(ERR.VALIDATION, "Target margin is required.");
    }
    if (floor === null) {
      throw new ActionGuardError(ERR.VALIDATION, "Floor margin is required.");
    }
    const targetN = Number(target);
    const floorN = Number(floor);
    if (!(targetN > 0 && targetN < 1)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Target margin must be between 0% and 100% (exclusive).",
      );
    }
    if (!(floorN > 0 && floorN < 1)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Floor margin must be between 0% and 100% (exclusive).",
      );
    }
    if (!(floorN < targetN)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Floor margin must be less than target margin.",
      );
    }
    if (effectiveFromStr === "") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Effective-from date is required.",
      );
    }
    // YYYY-MM-DD shape validation; Postgres date column will reject
    // anything else but the friendlier message helps.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFromStr)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Effective-from must be a YYYY-MM-DD date.",
      );
    }

    // Capture prior margin values for audit before the carry-forward
    // helper overwrites them.
    const [prior] = await db
      .select()
      .from(firmSettings)
      .where(isNull(firmSettings.effectiveUntil))
      .orderBy(desc(firmSettings.effectiveFrom))
      .limit(1);

    const inserted = await versionedFirmSettingsUpdate({
      adminUserId: admin.id,
      effectiveFromStr,
      overrides: {
        targetMarginPct: target,
        floorMarginPct: floor,
      },
      auditDiff: {
        from: prior
          ? {
              targetMarginPct: prior.targetMarginPct,
              floorMarginPct: prior.floorMarginPct,
              effectiveFrom: prior.effectiveFrom,
            }
          : null,
        to: {
          targetMarginPct: target,
          floorMarginPct: floor,
          effectiveFrom: effectiveFromStr,
        },
      },
    });

    // Open quote tabs won't auto-refresh (per architectural decision —
    // admin changes are rare; PMs reload to pick them up). Revalidate
    // the admin page itself so the form rehydrates with the new
    // current row.
    revalidatePath("/admin/firm-settings");

    return inserted;
  });
}

// Slice RI.8 step 3 — portfolio bands + re-band preview engine.
//
// Round 5 firm-settings page surfaces "portfolio effect" (live count of
// sent quotes by margin band) and a re-band preview when the admin
// proposes new target/floor numbers ("4 quotes change band. 0 newly
// drop below floor."). Both consume the same per-quote blended-margin
// list — the bands are just a cheap re-bucket under different
// thresholds; blended margins themselves are policy-independent.
//
// What we compute: every non-draft quote that's still active (not
// superseded/lost) gets its blended margin via getQuoteCosting. Bucket
// under current target/floor for the live read; same list re-bucketed
// for the preview.
//
// Performance: getQuoteCosting fires ~10 queries per quote (see
// CLAUDE.md "getCostingBundle parallel-query discipline"). Iteration
// is SEQUENTIAL — the inner fan-out already saturates pool slots; an
// outer Promise.all would balloon demand past pool capacity.
//
// At Nexus scale (~50 sent quotes typical) sequential is fine; at
// that scale it completes in seconds, not minutes. If portfolio grows
// substantially (200+ sent quotes), introduce a cached blended_margin
// column refreshed at sendQuote / costing-recompute time. UX_BACKLOG
// item logged on first encountering the cost. For now: pragmatic
// straight-line compute.
export type PortfolioQuoteRow = {
  quoteId: string;
  projectName: string;
  scenarioLabel: string;
  versionNumber: number;
  status: string;
  /**
   * 0.0..1.0, or NULL when the quote has no revenue and therefore no margin.
   *
   * Null is NOT a zero-margin quote. It is a quote that has not been assessed,
   * and it is excluded from every band below rather than defaulted into one.
   */
  blendedMarginPct: number | null;
  /**
   * Why the margin is null, when it is. Carried alongside rather than inferred
   * from the margin, because "no margin" has two meanings and the banding
   * below has to tell them apart.
   */
  marginStatus: QuoteMarginStatus;
};

export type PortfolioBands = {
  totalQuotes: number;
  good: number; // >= target
  belowTarget: number; // floor <= m < target
  belowFloor: number; // < floor
  /**
   * No revenue and no cost — nothing entered. Carries no commercial judgement.
   *
   * Reported rather than absorbed, so that
   * `good + belowTarget + belowFloor + unassessed + costWithoutRevenue ===
   * totalQuotes` holds. The alternative — shrinking `totalQuotes` to the
   * assessed population — would make the portfolio silently smaller than the
   * portfolio.
   */
  unassessed: number;
  /**
   * No revenue, but cost incurred. A certain loss.
   *
   * Counted separately from `unassessed` because folding it in would file a
   * quote that is losing money under "nothing entered yet" — the single most
   * misleading place to put it on a page about margin policy.
   */
  costWithoutRevenue: number;
  quotes: PortfolioQuoteRow[];
};

// Internal: get all in-scope quotes with computed blended margins.
// In-scope = status IN ('sent','accepted') — drafts excluded (they
// change before send), superseded/lost excluded (out-of-flow).
async function getPortfolioQuotes(): Promise<PortfolioQuoteRow[]> {
  const rows = await db
    .select({
      quoteId: quotes.id,
      scenarioLabel: quotes.scenarioLabel,
      versionNumber: quotes.versionNumber,
      status: quotes.status,
      projectName: projects.dealName,
    })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(
      and(
        // status IN ('sent','accepted') — drafts/superseded/lost excluded
        ne(quotes.status, "draft"),
        ne(quotes.status, "superseded"),
        ne(quotes.status, "lost"),
      ),
    );

  // Sequential — each getQuoteCosting fans out internally; outer
  // Promise.all would saturate the pool (see CLAUDE.md).
  const out: PortfolioQuoteRow[] = [];
  for (const r of rows) {
    const result = await getQuoteCosting(r.quoteId);
    if (!result.ok) continue; // skip quotes that fail to cost (orphaned)
    out.push({
      quoteId: r.quoteId,
      projectName: r.projectName,
      scenarioLabel: r.scenarioLabel,
      versionNumber: r.versionNumber,
      status: r.status,
      blendedMarginPct: result.data.quoteSummary.blendedMarginPct,
      marginStatus: result.data.quoteSummary.blendedMarginStatus,
    });
  }
  return out;
}

function bucketQuotes(
  quotesIn: PortfolioQuoteRow[],
  target: number,
  floor: number,
): {
  good: number;
  belowTarget: number;
  belowFloor: number;
  unassessed: number;
  costWithoutRevenue: number;
} {
  let good = 0;
  let belowTarget = 0;
  let belowFloor = 0;
  let unassessed = 0;
  let costWithoutRevenue = 0;
  for (const q of quotesIn) {
    // A quote with no margin is not a quote with a bad margin. Counting these
    // as belowFloor — which is what `null >= floor` being false used to do —
    // reported the firm as breaching its own policy on quotes nobody had
    // priced yet.
    //
    // The two no-margin states are counted apart. Both are excluded from the
    // bands, because neither has a margin to band; but one is an empty quote
    // and the other is a loss, and a page about margin policy is the last
    // place to let those look alike.
    if (q.marginStatus === "COST_WITHOUT_REVENUE") costWithoutRevenue++;
    else if (q.blendedMarginPct === null) unassessed++;
    else if (q.blendedMarginPct >= target) good++;
    else if (q.blendedMarginPct >= floor) belowTarget++;
    else belowFloor++;
  }
  return { good, belowTarget, belowFloor, unassessed, costWithoutRevenue };
}

export async function getFirmPortfolioBands(): Promise<
  ActionResult<PortfolioBands>
> {
  return runAction(async () => {
    await requireAdminAction();
    const [fs] = await db
      .select()
      .from(firmSettings)
      .where(isNull(firmSettings.effectiveUntil))
      .orderBy(desc(firmSettings.effectiveFrom))
      .limit(1);
    if (!fs) {
      throw new ActionGuardError(
        ERR.NOT_FOUND,
        "firm_settings has no current row.",
      );
    }
    const quotesList = await getPortfolioQuotes();
    const target = Number(fs.targetMarginPct);
    const floor = Number(fs.floorMarginPct);
    const { good, belowTarget, belowFloor, unassessed, costWithoutRevenue } =
      bucketQuotes(quotesList, target, floor);
    return {
      totalQuotes: quotesList.length,
      good,
      belowTarget,
      belowFloor,
      unassessed,
      costWithoutRevenue,
      quotes: quotesList,
    };
  });
}

// Re-band preview shape: under hypothetical new target/floor, what
// counts change band, and which specific quotes are newly below
// target / below floor. Sample lists capped at 5 for "view all" UX.
export type RebandPreview = {
  currentTargetPct: number;
  currentFloorPct: number;
  newTargetPct: number;
  newFloorPct: number;
  currentBands: { good: number; belowTarget: number; belowFloor: number };
  newBands: { good: number; belowTarget: number; belowFloor: number };
  // Bucket transitions for "N change band" header
  changingBandCount: number;
  newlyBelowTargetCount: number;
  newlyBelowFloorCount: number;
  // Sample affected quotes (cap 5) with their transition.
  //
  // `blendedMarginPct: number` is narrowed from the row's `number | null`
  // deliberately: only a quote that HAS a margin can transition between bands,
  // so an unassessed quote can never appear in these lists. Saying that in the
  // type means the view renders the number without a null check, rather than
  // inventing a display value for a case that cannot occur.
  newlyBelowTarget: Array<
    PortfolioQuoteRow & {
      blendedMarginPct: number;
      fromBand: "good";
      toBand: "belowTarget";
    }
  >;
  newlyBelowFloor: Array<
    PortfolioQuoteRow & {
      blendedMarginPct: number;
      fromBand: "good" | "belowTarget";
      toBand: "belowFloor";
    }
  >;
};

/**
 * Bands a margin. Takes a `number`, not `number | null`, on purpose: banding is
 * defined over the real line, and a quote without a margin is not this
 * function's problem to absorb. Callers exclude those before asking.
 */
function bandOf(
  m: number,
  target: number,
  floor: number,
): "good" | "belowTarget" | "belowFloor" {
  if (m >= target) return "good";
  if (m >= floor) return "belowTarget";
  return "belowFloor";
}

export async function previewFirmSettingsReband(
  newTargetDecimal: string,
  newFloorDecimal: string,
): Promise<ActionResult<RebandPreview>> {
  return runAction(async () => {
    await requireAdminAction();

    const newTarget = Number(newTargetDecimal);
    const newFloor = Number(newFloorDecimal);
    if (!Number.isFinite(newTarget) || !Number.isFinite(newFloor)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Target/floor must be finite decimals.",
      );
    }

    const [fs] = await db
      .select()
      .from(firmSettings)
      .where(isNull(firmSettings.effectiveUntil))
      .orderBy(desc(firmSettings.effectiveFrom))
      .limit(1);
    if (!fs) {
      throw new ActionGuardError(
        ERR.NOT_FOUND,
        "firm_settings has no current row.",
      );
    }
    const curTarget = Number(fs.targetMarginPct);
    const curFloor = Number(fs.floorMarginPct);
    const quotesList = await getPortfolioQuotes();

    const currentBands = bucketQuotes(quotesList, curTarget, curFloor);
    const newBands = bucketQuotes(quotesList, newTarget, newFloor);

    // Per-quote transitions for affected lists + change count.
    let changingBandCount = 0;
    const newlyBelowTarget: RebandPreview["newlyBelowTarget"] = [];
    const newlyBelowFloor: RebandPreview["newlyBelowFloor"] = [];

    for (const q of quotesList) {
      const m = q.blendedMarginPct;
      // No margin, no band, and therefore no transition. A change to the
      // firm's target or floor cannot move a quote that has not been
      // assessed against either.
      if (m === null) continue;

      const from = bandOf(m, curTarget, curFloor);
      const to = bandOf(m, newTarget, newFloor);
      if (from !== to) changingBandCount++;

      if (from === "good" && to === "belowTarget" && newlyBelowTarget.length < 5) {
        newlyBelowTarget.push({
          ...q,
          blendedMarginPct: m,
          fromBand: "good",
          toBand: "belowTarget",
        });
      }
      if (
        to === "belowFloor" &&
        (from === "good" || from === "belowTarget") &&
        newlyBelowFloor.length < 5
      ) {
        newlyBelowFloor.push({
          ...q,
          blendedMarginPct: m,
          fromBand: from,
          toBand: "belowFloor",
        });
      }
    }

    return {
      currentTargetPct: curTarget,
      currentFloorPct: curFloor,
      newTargetPct: newTarget,
      newFloorPct: newFloor,
      currentBands,
      newBands,
      changingBandCount,
      newlyBelowTargetCount: Math.max(0, newBands.belowTarget - currentBands.belowTarget),
      newlyBelowFloorCount: Math.max(0, newBands.belowFloor - currentBands.belowFloor),
      newlyBelowTarget,
      newlyBelowFloor,
    };
  });
}

// Slice RI.7 — vendor identity + customer-facing commercial defaults.
// Per docs/ri7-brief-amendment.md §3.10.a-g. Same versioning pattern as
// updateFirmSettings (close prior row, insert new row with carry-forward).
//
// Single action handles all 9 new RI.7 firm_settings fields:
//   - vendor_name / vendor_tagline / vendor_address (firm identity;
//     renders live on customer view)
//   - quote_number_prefix (consumed by sendQuote at send-time)
//   - tcs_default / payment_terms_default / lead_time_default /
//     incoterms_default / days_valid_default (snapshotted onto each
//     quote at sendQuote per DEC-7)
//
// Each field is optional in the form — empty input → NULL in the new
// row (matches the carry-forward, which inherits prior value if not
// in overrides).
//
// Validation: days_valid_default must be a positive integer if provided;
// percent / decimal-shape checks not applicable (all text fields).
export async function updateFirmSettingsCustomerFacingDefaults(
  formData: FormData,
): Promise<ActionResult<FirmSettingsRow>> {
  return runAction(async () => {
    const admin = await requireAdminAction();

    const vendorName = trimOrNull(formData.get("vendorName"));
    const vendorTagline = trimOrNull(formData.get("vendorTagline"));
    const vendorAddress = trimOrNull(formData.get("vendorAddress"));
    const quoteNumberPrefix = trimOrNull(formData.get("quoteNumberPrefix"));
    const tcsDefault = trimOrNull(formData.get("tcsDefault"));
    const paymentTermsDefault = trimOrNull(formData.get("paymentTermsDefault"));
    const leadTimeDefault = trimOrNull(formData.get("leadTimeDefault"));
    const incotermsDefault = trimOrNull(formData.get("incotermsDefault"));
    const daysValidDefault = parseIntOrNull(formData.get("daysValidDefault"));
    const effectiveFromStr = String(formData.get("effectiveFrom") ?? "").trim();

    if (daysValidDefault !== null && !(daysValidDefault > 0)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Days valid must be a positive integer.",
      );
    }
    if (effectiveFromStr === "") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Effective-from date is required.",
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFromStr)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Effective-from must be a YYYY-MM-DD date.",
      );
    }

    // Capture prior values for the audit diff.
    const [prior] = await db
      .select()
      .from(firmSettings)
      .where(isNull(firmSettings.effectiveUntil))
      .orderBy(desc(firmSettings.effectiveFrom))
      .limit(1);

    const newValues = {
      vendorName,
      vendorTagline,
      vendorAddress,
      quoteNumberPrefix,
      tcsDefault,
      paymentTermsDefault,
      leadTimeDefault,
      incotermsDefault,
      daysValidDefault,
    };

    const inserted = await versionedFirmSettingsUpdate({
      adminUserId: admin.id,
      effectiveFromStr,
      overrides: newValues,
      auditDiff: {
        from: prior
          ? {
              vendorName: prior.vendorName,
              vendorTagline: prior.vendorTagline,
              vendorAddress: prior.vendorAddress,
              quoteNumberPrefix: prior.quoteNumberPrefix,
              tcsDefault: prior.tcsDefault,
              paymentTermsDefault: prior.paymentTermsDefault,
              leadTimeDefault: prior.leadTimeDefault,
              incotermsDefault: prior.incotermsDefault,
              daysValidDefault: prior.daysValidDefault,
              effectiveFrom: prior.effectiveFrom,
            }
          : null,
        to: { ...newValues, effectiveFrom: effectiveFromStr },
      },
    });

    revalidatePath("/admin/firm-settings");

    return inserted;
  });
}
