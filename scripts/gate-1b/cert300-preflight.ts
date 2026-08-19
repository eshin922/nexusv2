/**
 * CERT-300 walk pre-flight — READ ONLY.
 *
 * Answers the two questions that decide the ORDER of the certification walk,
 * because the two kinds of destination resolve at different moments:
 *
 *   · a FIRM-LEVEL mapping (`unmapped_destination`) is read LIVE at push time,
 *     so it can be entered in Settings → NetSuite after the re-send;
 *   · a PER-LINE `OTC - Other Service` selection is read from the FROZEN row,
 *     so it must be chosen on Costs BEFORE the re-send or the new snapshot is
 *     born un-pushable.
 *
 * Writes nothing, resolves nothing against NetSuite, and posts nothing.
 */
import { and, eq, isNull } from "drizzle-orm";

import { assessProjectionReadiness, describeBlockers } from "@/lib/netsuite/projection-readiness";

import { db } from "@/db";
import {
  quoteSnapshotLineTiers,
  quoteSnapshotLines,
  quoteSnapshotTierTotals,
  quoteSnapshots,
  quotes,
  quoteTiers,
} from "@/db/schema";

const QUOTE_ID = process.argv[2] ?? "97d25286-2c42-4a72-8979-89f1a5c2cf26";

const [quote] = await db
  .select({
    id: quotes.id,
    status: quotes.status,
    versionNumber: quotes.versionNumber,
    scenarioLabel: quotes.scenarioLabel,
    detailLevelSnapshot: quotes.detailLevelSnapshot,
    acceptedTierId: quotes.acceptedTierId,
    customerAcceptedTierId: quotes.customerAcceptedTierId,
  })
  .from(quotes)
  .where(eq(quotes.id, QUOTE_ID));

if (!quote) {
  console.log(`no quote ${QUOTE_ID}`);
  process.exit(1);
}

console.log("── quote ─────────────────────────────────────────────");
console.log(quote);

const tiers = await db
  .select({ id: quoteTiers.id, label: quoteTiers.label, qty: quoteTiers.qty })
  .from(quoteTiers)
  .where(eq(quoteTiers.quoteId, QUOTE_ID))
  .orderBy(quoteTiers.qty);
console.log("── tiers ─────────────────────────────────────────────");
console.table(tiers);

const [snapshot] = await db
  .select({
    id: quoteSnapshots.id,
    sentAt: quoteSnapshots.createdAt,
    detailLevel: quoteSnapshots.detailLevel,
  })
  .from(quoteSnapshots)
  .where(and(eq(quoteSnapshots.quoteId, QUOTE_ID), isNull(quoteSnapshots.supersededAt)));

if (!snapshot) {
  console.log("no current frozen snapshot");
  process.exit(0);
}
console.log("── current snapshot ──────────────────────────────────");
console.log(snapshot);

const totals = await db
  .select({
    tierId: quoteSnapshotTierTotals.tierId,
    tierLabel: quoteSnapshotTierTotals.tierLabel,
    total: quoteSnapshotTierTotals.tierCommercialTotal,
    provisional: quoteSnapshotTierTotals.totalIsProvisional,
  })
  .from(quoteSnapshotTierTotals)
  .where(eq(quoteSnapshotTierTotals.quoteSnapshotId, snapshot.id));
console.log("── frozen tier totals ────────────────────────────────");
console.table(totals);

const lines = await db
  .select({
    id: quoteSnapshotLines.id,
    position: quoteSnapshotLines.position,
    kind: quoteSnapshotLines.lineKind,
    name: quoteSnapshotLines.displayName,
    sku: quoteSnapshotLines.displaySku,
    destination: quoteSnapshotLines.bv011Destination,
    legacyUnresolved: quoteSnapshotLines.legacyUnresolved,
    serviceIdentity: quoteSnapshotLines.serviceIdentity,
    selectedItemId: quoteSnapshotLines.selectedNetsuiteItemId,
    postedItemId: quoteSnapshotLines.netsuiteItemId,
    owningAssemblyId: quoteSnapshotLines.owningAssemblyId,
  })
  .from(quoteSnapshotLines)
  .where(eq(quoteSnapshotLines.quoteSnapshotId, snapshot.id))
  .orderBy(quoteSnapshotLines.position);

console.log("── frozen lines ──────────────────────────────────────");
console.table(
  lines.map((l) => ({
    pos: l.position,
    kind: l.kind,
    name: l.name.slice(0, 34),
    sku: l.sku,
    destination: l.destination,
    selected: l.selectedItemId,
    posted: l.postedItemId,
    group: l.owningAssemblyId ? l.owningAssemblyId.slice(0, 8) : null,
  })),
);

const tierRows = await db
  .select({
    lineId: quoteSnapshotLineTiers.quoteSnapshotLineId,
    tierLabel: quoteSnapshotLineTiers.tierLabel,
    quantity: quoteSnapshotLineTiers.quantity,
    rate: quoteSnapshotLineTiers.unitRate,
    amount: quoteSnapshotLineTiers.lineAmount,
    state: quoteSnapshotLineTiers.pricingState,
  })
  .from(quoteSnapshotLineTiers)
  .innerJoin(
    quoteSnapshotLines,
    eq(quoteSnapshotLines.id, quoteSnapshotLineTiers.quoteSnapshotLineId),
  )
  .where(eq(quoteSnapshotLines.quoteSnapshotId, snapshot.id));

const byLine = new Map(lines.map((l) => [l.id, l] as const));
console.log("── frozen line × tier (accepted-tier rows first) ─────");
console.table(
  tierRows
    .map((r) => ({
      name: (byLine.get(r.lineId)?.name ?? "?").slice(0, 30),
      kind: byLine.get(r.lineId)?.kind,
      tier: r.tierLabel,
      qty: r.quantity,
      rate: r.rate,
      amount: r.amount,
      state: r.state,
    }))
    .sort((a, b) => (a.tier ?? "").localeCompare(b.tier ?? "")),
);

// The decisive question for walk ordering.
const perLinePending = lines.filter(
  (l) =>
    l.destination === "otc_other_service" &&
    (l.selectedItemId ?? "").trim() === "",
);
const destinations = [...new Set(lines.map((l) => l.destination).filter(Boolean))];

console.log("── verdict ───────────────────────────────────────────");
console.log("destinations present:", destinations);
console.log(
  "per-line OTC - Other Service lines still unresolved:",
  perLinePending.length,
  perLinePending.map((l) => l.name),
);
console.log(
  perLinePending.length === 0
    ? "→ nothing blocks the re-send; firm mappings can follow it."
    : "→ choose these items on Costs BEFORE re-sending, or the new snapshot is born un-pushable.",
);

// ── condition 4 · the REAL gate, not an eyeball ──────────────────────────
//
// Readiness is what actually refuses the push, so it is what gets asked. A
// hand-check of the columns above could agree with itself while the gate
// disagreed for a reason the columns do not show.
console.log("\n── projection readiness (the gate itself) ────────────");
const readiness = await assessProjectionReadiness(QUOTE_ID);
if (readiness.ready) {
  console.log("READY · acceptedTier", readiness.acceptedTierId, "· total", readiness.tierCommercialTotal);
  console.table(
    readiness.lines.map((l) => ({
      kind: l.kind,
      name: l.displayName.slice(0, 28),
      destination: l.destination,
      nsItemId: l.netsuiteItemId,
      nsItemCode: l.netsuiteItemCode,
      amountCents: l.amountCents,
      owningAssembly: l.owningAssemblyId ? l.owningAssemblyId.slice(0, 8) : null,
    })),
  );
} else {
  console.log("NOT READY · blockers:");
  for (const b of readiness.blockers) console.log("  ·", b.kind);
  for (const line of describeBlockers(readiness.blockers)) console.log("    ", line);
  const kinds = new Set(readiness.blockers.map((b) => b.kind));
  const onlyExpected = [...kinds].every((k) => k === "no_accepted_tier");
  console.log(
    onlyExpected
      ? "-> EXPECTED: the only blocker is the deliberately unaccepted tier state."
      : "-> STOP: a blocker beyond the unaccepted-tier state is present.",
  );
}

process.exit(0);
