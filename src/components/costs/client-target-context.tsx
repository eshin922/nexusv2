"use client";

/**
 * Client Target on Costs — read-only, factual, and answering one question.
 *
 * *"Are these costs going to work?"* The operator has just entered packaging,
 * production and freight; the thing they want to know is whether what those
 * costs imply lands anywhere near what the client said they need to pay.
 *
 * ── WHY IT IS NOT IN THE COST-STACK COLUMN ────────────────────────────────
 *
 * That column is a WHOLE-QUOTE figure per tier — its own tooltip says so:
 * "All products in this tier, per unit … not the per-SKU blended average".
 * Client Target belongs to one sellable unit. Putting a per-unit target beside
 * a quote-wide sell would compare two different things and read as though they
 * were the same one, which is the unit-of-account error the whole Client
 * Target model exists to avoid.
 *
 * So this is its own strip, one row per SELLABLE UNIT, against that unit's own
 * governed Base Sell.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 *
 * No authority: Setup is the only place a target is authored, and there is no
 * input here. No mutation and no shortcut into one. No verdict — being above
 * the client's number is commercially relevant and may still be the correct
 * quote, so the copy is directional and factual and stops there. Margin, floor
 * and target policy are a different axis and are not combined with this one.
 */

import { useMemo } from "react";

import {
  clientTargetFacts,
  describeGap,
  indexClientTargets,
  resolveClientTarget,
  type ClientTargetRow,
} from "@/lib/client-target";
import { selectActiveTierId, selectSkuRollups } from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });

export function ClientTargetContext({
  clientTargets,
  tiers,
}: {
  clientTargets: ReadonlyArray<ClientTargetRow>;
  tiers: ReadonlyArray<{ id: string; label: string }>;
}) {
  const activeTierId = useCostingStore(selectActiveTierId);
  const skuRollups = useCostingStore(selectSkuRollups);

  // The tier this reads against. Falls back to the first tier only when none is
  // active yet — the Costs surface picks one on mount, so this is the gap
  // before that lands rather than a default anybody sees.
  const tierId = activeTierId ?? tiers[0]?.id ?? null;
  const tierLabel = tiers.find((t) => t.id === tierId)?.label ?? null;

  const rows = useMemo(() => {
    if (tierId === null) return [];
    const byUnit = indexClientTargets(clientTargets);
    return (
      skuRollups
        // TOP-LEVEL ONLY. The sellable unit is an Item Group finished good or a
        // Direct Product; a member leaf carries no target and gets no row.
        .filter((r) => r.parentSkuId === null)
        .map((r) => {
          const { value: target } = resolveClientTarget(byUnit.get(r.skuId), tierId);
          if (target === null) return null;
          const pt = r.perTier.find((p) => p.tierId === tierId);
          // GOVERNED Base Sell — the sell before any pricing decision, read
          // from the engine's rollup rather than assembled here. It is the
          // right comparator on Costs precisely because no pricing decision
          // has been made yet.
          const baseSell = pt?.sellBeforeAdjustmentPerUnit ?? null;
          const facts = clientTargetFacts({
            target,
            quotedSellPerUnit: baseSell,
            costPerUnit: pt?.contributionCostPerUnit ?? null,
          });
          return {
            id: r.skuId,
            name: r.productName ?? r.skuLabel,
            target,
            baseSell,
            gap: facts?.gapAbs ?? null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
    );
  }, [clientTargets, skuRollups, tierId]);

  // Nothing targeted, nothing to say. An empty scaffold here would be a
  // section asserting that a comparison exists when none does.
  if (rows.length === 0) return null;

  return (
    <section className="ct-costs">
      <div className="ct-costs-head">
        <h3>Client target</h3>
        <span className="ct-costs-meta">
          against base sell{tierLabel && ` · ${tierLabel}`} · internal
        </span>
      </div>
      {rows.map((r) => (
        <div className="ct-costs-row" key={r.id}>
          <span className="ct-costs-name">{r.name}</span>
          <span className="ct-costs-figs">
            <span className="ct-costs-fig">
              <span className="k">Client target</span>
              <span className="v">{usd(r.target)}</span>
            </span>
            <span className="ct-costs-fig">
              <span className="k">Base sell</span>
              <span className="v">
                {r.baseSell === null ? "—" : usd(r.baseSell)}
              </span>
            </span>
            <span className="ct-costs-gap">
              {/* Factual and directional. Never "competitive". */}
              {describeGap(r.gap) ?? "no base sell yet"}
            </span>
          </span>
        </div>
      ))}
    </section>
  );
}
