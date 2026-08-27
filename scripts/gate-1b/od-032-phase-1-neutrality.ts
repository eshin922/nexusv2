/**
 * OD-032 phase 1 — the neutrality harness. READ ONLY.
 *
 * Phase 1 moves recovery elections onto a generated `charge_instance_id` and
 * changes nothing else. Its success criterion is that **nothing moved**, which
 * is the rare case where a phase can be proved directly against the live
 * population rather than argued for.
 *
 * ── WHAT IT CAPTURES, AND WHY EACH FIELD IS HERE ─────────────────────────
 *
 * Per quote, per tier, per charge:
 *
 *   mode        the resolved placement — the operator-visible outcome
 *   source      election | legacy — NOT redundant with mode, see below
 *   cost        what DPS pays; invariant under every election
 *   recovery    what the charge recovers, per placement bucket
 *   totals      tier revenue / cost / blended margin
 *
 * `source` IS THE FIELD A PLACEMENT-ONLY DIFF WOULD MISS. Legacy and elected
 * charges with the SAME placement are priced differently: a legacy charge sits
 * in the unit rate and the quote-level adjustment reaches it, while an elected
 * one recovers its governed rate and the adjustment does not re-mark it up. So
 * a `legacy → election` flip with an unchanged mode is a silent repricing that
 * a mode comparison reports as identical. It is exactly the shape a migration
 * that "just re-keys rows" would produce if it accidentally materialised an
 * election where absence used to mean legacy.
 *
 * ── THREE OUTCOMES, NOT TWO (Pattern 60) ─────────────────────────────────
 *
 * A quote that fails to load is recorded as `unresolved` with its reason, never
 * folded into "no charges". A capture where both sides fail identically is not
 * evidence of neutrality — it is evidence of nothing, and collapsing the two
 * would let a migration that broke every quote report a clean diff.
 *
 *   resolved     the engine answered
 *   absent       the engine answered, and this quote has no charges
 *   unresolved   the engine could not answer  ← never counted as agreement
 *
 * ── SEQUENTIAL BY CONSTRUCTION ───────────────────────────────────────────
 *
 * `getQuoteCosting` fans out internally. Running 107 of them concurrently is
 * the pool-saturation shape documented in CLAUDE.md, so the loop is serial and
 * deliberately so — this is a correctness instrument, not a fast one.
 *
 *   usage: od-032-phase-1-neutrality <out.json>
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getQuoteCosting } from "@/app/actions/costing";
import { writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) {
  console.error("usage: od-032-phase-1-neutrality <out.json>");
  process.exit(1);
}

type ChargeCapture = {
  chargeKey: string;
  placement: string;
  source: string;
  ownerKind: string;
  cost: number;
  recoverableSell: number | null;
};

type TierCapture = {
  tierLabel: string;
  totalRevenue: number | null;
  totalCost: number | null;
  blendedMarginPct: number | null;
};

type QuoteCapture =
  | { kind: "resolved"; quoteId: string; status: string; charges: ChargeCapture[]; tiers: TierCapture[] }
  | { kind: "absent"; quoteId: string; status: string; tiers: TierCapture[] }
  | { kind: "unresolved"; quoteId: string; status: string; reason: string };

const quotes = (await db.execute(sql`
  SELECT id, status FROM quotes ORDER BY id
`)) as unknown as Array<{ id: string; status: string }>;

console.error(`[neutrality] population = ${quotes.length} quotes (full, not a sample)`);

const captures: QuoteCapture[] = [];
let resolved = 0, absent = 0, unresolved = 0;

for (const q of quotes) {
  let r;
  try {
    r = await getQuoteCosting(q.id);
  } catch (e) {
    captures.push({ kind: "unresolved", quoteId: q.id, status: q.status, reason: `threw: ${(e as Error).message.slice(0, 160)}` });
    unresolved++;
    continue;
  }
  if (!r.ok) {
    // AUTHORITATIVE refusal is still "could not resolve" for this instrument's
    // purposes: it produced no projection to compare.
    captures.push({ kind: "unresolved", quoteId: q.id, status: q.status, reason: `${r.error.code}: ${r.error.message.slice(0, 140)}` });
    unresolved++;
    continue;
  }

  const data = r.data as unknown as {
    skuRollups?: Array<{ skuId: string; perTier?: Array<{ tierId: string; constructed?: { charges?: Array<Record<string, unknown>> } }> }>;
    quoteRollup?: Array<{ label?: string; totalRevenue?: number | null; totalCost?: number | null; blendedMarginPct?: number | null }>;
  };

  const charges: ChargeCapture[] = [];
  for (const sku of data.skuRollups ?? []) {
    for (const pt of sku.perTier ?? []) {
      for (const c of pt.constructed?.charges ?? []) {
        charges.push({
          chargeKey: String(c.chargeKey),
          placement: String(c.placement),
          source: String(c.source),
          ownerKind: String(c.ownerKind),
          cost: Number(c.cost),
          recoverableSell: c.recoverableSell === null || c.recoverableSell === undefined ? null : Number(c.recoverableSell),
        });
      }
    }
  }
  // Deterministic order — the capture must not depend on traversal order, or
  // a diff reports movement that is only sorting.
  charges.sort((a, b) =>
    (a.chargeKey + a.ownerKind + a.placement + a.source + a.cost).localeCompare(
      b.chargeKey + b.ownerKind + b.placement + b.source + b.cost,
    ),
  );

  const tiers: TierCapture[] = (data.quoteRollup ?? [])
    .map((t) => ({
      tierLabel: String(t.label ?? ""),
      totalRevenue: t.totalRevenue ?? null,
      totalCost: t.totalCost ?? null,
      blendedMarginPct: t.blendedMarginPct ?? null,
    }))
    .sort((a, b) => a.tierLabel.localeCompare(b.tierLabel));

  if (charges.length === 0) {
    captures.push({ kind: "absent", quoteId: q.id, status: q.status, tiers });
    absent++;
  } else {
    captures.push({ kind: "resolved", quoteId: q.id, status: q.status, charges, tiers });
    resolved++;
  }
}

// Frozen behaviour, captured straight from the table. Sent quotes' instructions
// are the record Accounting acts on; a migration must not move them.
const instructions = await db.execute(sql`
  SELECT s.quote_id, i.charge_key, i.owner_ref, i.tier_id, i.treatment,
         i.treatment_source, i.cost, i.governed_recovery, i.separate_invoice_amount
    FROM quote_snapshot_recovery_instructions i
    JOIN quote_snapshots s ON s.id = i.quote_snapshot_id
   ORDER BY s.quote_id, i.charge_key, i.owner_ref, i.tier_id
`);

const payload = { captures, instructions, counts: { resolved, absent, unresolved, total: quotes.length } };
writeFileSync(out, JSON.stringify(payload, null, 2));

console.error(`[neutrality] resolved=${resolved} absent=${absent} unresolved=${unresolved} total=${quotes.length}`);
console.error(`[neutrality] frozen instruction rows = ${(instructions as unknown as unknown[]).length}`);
console.error(`[neutrality] wrote ${out}`);
process.exit(0);
