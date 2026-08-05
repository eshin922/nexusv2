import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  firmSettings,
  markupDefaults,
  assemblies,
  assemblyLeaves,
  assemblyLeafInputs,
  quoteCommercialMarkupPins,
  quoteCommercialSettingsPins,
  quoteLeaves,
  quoteTiers,
  quotes,
} from "@/db/schema";
import {
  resolveCommercialSettingsForLifecycle,
  type CommercialSettingsResolution,
} from "./commercial-settings-contract";

export type QuoteCommercialPinPlan = {
  targetMarginPct: string;
  floorMarginPct: string;
  markupRows: Array<{
    quoteLeafId: string;
    tierId: string;
    category: string;
    chosenRung: string;
    markupPct: string;
    sourceUserId: string | null;
    sourceSetAt: Date;
  }>;
};

/**
 * Resolve every send-time markup outcome onto the canonical attachment key.
 * This deliberately fails closed before artifact creation when a legacy
 * grouped membership is missing, cross-Quote, or drifting.
 */
export async function prepareQuoteCommercialPin(
  quoteId: string,
): Promise<QuoteCommercialPinPlan> {
  const [firmRows, defaults, attachments, tiers, compatibilityRows, inputCategories] =
    await Promise.all([
      db
        .select()
        .from(firmSettings)
        .where(isNull(firmSettings.effectiveUntil))
        .orderBy(desc(firmSettings.effectiveFrom))
        .limit(1),
      db.select().from(markupDefaults),
      db
        .select({ id: quoteLeaves.id })
        .from(quoteLeaves)
        .where(eq(quoteLeaves.quoteId, quoteId)),
      db
        .select({ id: quoteTiers.id })
        .from(quoteTiers)
        .where(eq(quoteTiers.quoteId, quoteId)),
      db
        .select({
          membershipId: assemblyLeaves.id,
          assemblyQuoteId: assemblies.quoteId,
          membershipAssemblyId: assemblyLeaves.assemblyId,
          membershipLeafId: assemblyLeaves.leafId,
          canonicalQuoteId: quoteLeaves.quoteId,
          canonicalAssemblyId: quoteLeaves.assemblyId,
          canonicalLeafId: quoteLeaves.leafId,
        })
        .from(assemblyLeaves)
        .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
        .leftJoin(quoteLeaves, eq(quoteLeaves.id, assemblyLeaves.quoteLeafId))
        .where(eq(assemblies.quoteId, quoteId)),
      db
        .select({
          quoteLeafId: assemblyLeaves.quoteLeafId,
          tierId: assemblyLeafInputs.tierId,
          category: assemblyLeafInputs.category,
        })
        .from(assemblyLeafInputs)
        .innerJoin(
          assemblyLeaves,
          eq(assemblyLeaves.id, assemblyLeafInputs.assemblyLeafId),
        )
        .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
        .where(eq(assemblies.quoteId, quoteId)),
    ]);

  const firm = firmRows[0];
  if (!firm) throw new Error("No active firm settings row.");

  for (const row of compatibilityRows) {
    if (!row.canonicalQuoteId) {
      throw new Error(
        `Canonical attachment identity is missing for legacy membership ${row.membershipId}.`,
      );
    }
    if (
      row.assemblyQuoteId !== quoteId ||
      row.canonicalQuoteId !== quoteId ||
      row.assemblyQuoteId !== row.canonicalQuoteId ||
      row.membershipAssemblyId !== row.canonicalAssemblyId ||
      row.membershipLeafId !== row.canonicalLeafId
    ) {
      throw new Error(
        `Canonical attachment identity crosses or drifts from Quote ${quoteId} for legacy membership ${row.membershipId}.`,
      );
    }
  }

  const defaultByCategory = new Map(defaults.map((row) => [row.category, row]));
  const categoriesByCoordinate = new Map<string, Set<string>>();
  for (const attachment of attachments) {
    for (const tier of tiers) {
      categoriesByCoordinate.set(
        `${attachment.id}:${tier.id}`,
        new Set([
          ...defaults.map((row) => row.category),
          "Manufacturing",
          "Raw ingredients",
        ]),
      );
    }
  }
  for (const input of inputCategories) {
    categoriesByCoordinate
      .get(`${input.quoteLeafId}:${input.tierId}`)
      ?.add(input.category ?? "Other");
  }

  const markupRows: QuoteCommercialPinPlan["markupRows"] = [];
  for (const attachment of attachments) {
    for (const tier of tiers) {
      for (const category of categoriesByCoordinate.get(`${attachment.id}:${tier.id}`) ?? []) {
        const setting = defaultByCategory.get(category) ?? defaultByCategory.get("Other");
        if (!setting) {
          throw new Error(
            `Commercial markup '${category}' has neither an exact setting nor a provenance-bearing Other fallback.`,
          );
        }
        markupRows.push({
          quoteLeafId: attachment.id,
          tierId: tier.id,
          category,
          chosenRung: setting.category,
          markupPct: setting.defaultMarkupPct,
          sourceUserId: setting.updatedByUserId,
          sourceSetAt: setting.updatedAt,
        });
      }
    }
  }

  return {
    targetMarginPct: firm.targetMarginPct,
    floorMarginPct: firm.floorMarginPct,
    markupRows,
  };
}

export async function resolveQuoteCommercialSettings(
  quoteId: string,
): Promise<CommercialSettingsResolution> {
  const [quoteRows, firmRows, liveMarkupRows, pinRows] = await Promise.all([
    db.select({ status: quotes.status, freightMarkupPct: quotes.freightMarkupPct }).from(quotes).where(eq(quotes.id, quoteId)).limit(1),
    db.select().from(firmSettings).where(isNull(firmSettings.effectiveUntil)).orderBy(desc(firmSettings.effectiveFrom)).limit(1),
    db.select().from(markupDefaults),
    db.select().from(quoteCommercialSettingsPins).where(and(eq(quoteCommercialSettingsPins.quoteId, quoteId), isNull(quoteCommercialSettingsPins.supersededAt))).limit(1),
  ]);
  const quote = quoteRows[0];
  const firm = firmRows[0];
  if (!quote) throw new Error("Quote not found while resolving commercial settings.");
  if (!firm) throw new Error("No active firm settings row.");

  const live = {
    targetMarginPct: Number(firm.targetMarginPct),
    floorMarginPct: Number(firm.floorMarginPct),
    freightMarkupPct: Number(quote.freightMarkupPct),
    markupDefaults: Object.fromEntries(
      liveMarkupRows.map((row) => [row.category, Number(row.defaultMarkupPct)]),
    ),
  };
  const pin = pinRows[0];
  if (!pin) {
    return resolveCommercialSettingsForLifecycle({ status: quote.status, live, pinned: null });
  }

  const rows = await db
    .select({ category: quoteCommercialMarkupPins.category, pct: quoteCommercialMarkupPins.markupPct })
    .from(quoteCommercialMarkupPins)
    .where(eq(quoteCommercialMarkupPins.pinId, pin.id));
  // Collapse per-(leaf, tier, category) pin rows to per-category.
  //
  // Safe because `prepareQuoteCommercialPin` resolves every coordinate
  // against `markup_defaults`, so all rows sharing a category carry the
  // same value by construction. See the grain note on
  // `quoteCommercialMarkupPins` in src/db/schema.ts.
  //
  // ⚠️ The throw below is a TRIPWIRE, not dead code. It is unreachable
  // from the current writer and must stay. If a future writer makes
  // markup vary per leaf or per tier, this fires — and the correct
  // response is to widen this resolver to return per-coordinate values,
  // NOT to remove the guard. Without it, a sent quote would silently
  // resolve to whichever conflicting markup happened to be read last.
  const pinnedMarkup: Record<string, number> = {};
  for (const row of rows) {
    const pct = Number(row.pct);
    const prior = pinnedMarkup[row.category];
    if (prior !== undefined && prior !== pct) {
      throw new Error(`Pinned markup category '${row.category}' has inconsistent outcomes.`);
    }
    pinnedMarkup[row.category] = pct;
  }
  return resolveCommercialSettingsForLifecycle({
    status: quote.status,
    live,
    pinned: {
      targetMarginPct: Number(pin.targetMarginPct),
      floorMarginPct: Number(pin.floorMarginPct),
      freightMarkupPct: Number(pin.freightMarkupPct),
      markupDefaults: pinnedMarkup,
    },
  });
}
