// R12 load-bearing 22 — the cost base a staged decision was evaluated against.
//
// ── THE HAZARD, IN THE DESIGNER'S WORDS ───────────────────────────────────
//
// R12 §7: "Is Pricing single-owner? **Its levers are. Its base is not.**"
//
// Every lever on this page — quote-wide adjustment, per-tier adjustment,
// surgical lift, direct price — is a commercial act belonging to the PM. The
// cost base underneath is not: Purchasing, Production and Logistics each own
// sections of it.
//
// So: a PM stages three lifts, Logistics updates a freight leg, the PM
// applies — **against which costs?** The staged figures were computed from a
// snapshot. If that snapshot is stale the PM is committing a decision they did
// not actually make, and nothing on screen said so.
//
//   "Apply must check that the cost base has not moved since staging began,
//    and say so if it has rather than committing silently against different
//    numbers." — flagged as a REQUIRED guard, not a nice-to-have.
//
// ── WHAT COUNTS AS THE BASE ───────────────────────────────────────────────
//
// Everything the engine consumes EXCEPT the four levers. Including a lever
// would make the fingerprint change every time the operator staged something,
// which is the one moment it must not — the guard would fire on the operator's
// own act and mean nothing.
//
// ── WHY A CONTENT FINGERPRINT AND NOT THE BUNDLE REVISION ─────────────────
//
// `HydrateSnapshot.revision` moves on every reconcile, including the ones this
// page causes. A revision-based guard would refuse Apply after the operator's
// own edit settled — a false refusal, which trains people to ignore the real
// one. The fingerprint moves only when a NUMBER the price depends on moves.

import type { QuoteCostingInput } from "./costing";

/** Six decimals: far below a cent, far above float noise at this depth. */
const q = (n: number | null | undefined): number =>
  n === null || n === undefined ? 0 : Math.round(n * 1e6) / 1e6;

/**
 * A stable digest of everything the price depends on that the PM does not own.
 *
 * Order-independent by construction: every collection is sorted by its own
 * identity before being written. Row order out of Postgres is not a fact about
 * the quote, and a fingerprint that moved with it would refuse Apply for a
 * reason nobody could explain.
 */
export function costBaseFingerprint(input: QuoteCostingInput): string {
  const parts: string[] = [];

  parts.push(
    `firm:${q(input.firmSettings.targetMarginPct)}:${q(input.firmSettings.floorMarginPct)}`,
  );
  // The quote's own target override is policy, not a lever — it changes what
  // compliant MEANS, so a staged decision evaluated under one target must not
  // be committed under another.
  parts.push(`target:${q(input.quote.targetMarginPct)}`);
  parts.push(`frtmk:${q(input.quote.freightMarkupPct)}`);

  for (const k of Object.keys(input.markupDefaults).sort()) {
    parts.push(`mk:${k}:${q(input.markupDefaults[k])}`);
  }

  // Tier quantity is a cost driver: every per-unit allocation divides by it.
  for (const t of [...input.tiers].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(`tier:${t.id}:${q(t.qty)}`);
  }

  // Population and shape. A leaf appearing or leaving changes what is blended.
  for (const s of [...input.skus].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(`sku:${s.id}:${s.skuRole}:${s.parentSkuId ?? ""}:${q(s.qtyPerParent)}`);
  }

  for (const p of [...input.packaging].sort((a, b) =>
    `${a.quoteSkuId}${a.tierId}${a.lineGroupId}`.localeCompare(
      `${b.quoteSkuId}${b.tierId}${b.lineGroupId}`,
    ),
  )) {
    parts.push(
      `pkg:${p.quoteSkuId}:${p.tierId}:${p.lineGroupId}:${q(p.unitCost)}:${q(p.qtyPerSellableUnit)}:${p.category ?? ""}:${q(p.markupPct)}`,
    );
  }

  for (const pr of [...input.production].sort((a, b) =>
    `${a.quoteSkuId}${a.tierId}`.localeCompare(`${b.quoteSkuId}${b.tierId}`),
  )) {
    parts.push(
      `prod:${pr.quoteSkuId}:${pr.tierId}:${q(pr.fillingBlendingCost)}:${q(pr.cmAssemblyTotal)}:${q(pr.setupFeeTotal)}:${q(pr.toolingArtworkTotal)}:${q(pr.rdTotal)}:${q(pr.otherServiceTotal)}:${q(pr.bulkRawCost)}:${q(pr.actualUnitsProduced)}:${pr.customerShipsRaws ? 1 : 0}:${pr.allocateServiceFeesToCost ? 1 : 0}`,
    );
  }

  // Both freight models. A quote carrying legs resolves through them; one
  // carrying shipment breaks resolves through the worksheet, and which one is
  // authoritative is itself decided by whether breaks exist.
  for (const l of [...input.freightLegs].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(
      `leg:${l.id}:${l.legGroupId}:${l.treatment}:${l.incoterm ?? ""}:` +
        `${l.crossesInternationalBorder ? 1 : 0}:${q(l.dutyMarkupPct)}:${q(l.tariffMarkupPct)}:` +
        // Customs rates are a cost input someone else owns; a duty change
        // between staging and Apply moves every landed price on the leg.
        `${JSON.stringify(l.customs)}`,
    );
  }
  for (const lt of [...input.freightLegTiers].sort((a, b) =>
    `${a.freightLegId}${a.tierId}`.localeCompare(`${b.freightLegId}${b.tierId}`),
  )) {
    parts.push(`legtier:${lt.freightLegId}:${lt.tierId}:${q(lt.totalFreight)}:${q(lt.unitsInShipment)}`);
  }
  for (const c of [...(input.freightComponentTierCosts ?? [])].sort((a, b) =>
    `${a.freightLegId}${a.quoteLeafId}${a.tierId}`.localeCompare(
      `${b.freightLegId}${b.quoteLeafId}${b.tierId}`,
    ),
  )) {
    parts.push(
      `frtc:${c.freightLegId}:${c.quoteLeafId}:${c.tierId}:${q(c.actualFreightCost)}:${q(c.effectiveUnits)}`,
    );
  }
  for (const b of [...(input.freightShipmentBreaks ?? [])].sort((a, b2) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b2)),
  )) {
    parts.push(`brk:${JSON.stringify(b)}`);
  }

  // Client targets are a benchmark, never a price — but they DO decide the
  // competitive verdict a PM may have staged against, so a move is material.
  for (const t of [...input.cellTargets].sort((a, b) =>
    `${a.quoteSkuId}${a.tierId}`.localeCompare(`${b.quoteSkuId}${b.tierId}`),
  )) {
    parts.push(`tgt:${t.quoteSkuId}:${t.tierId}:${q(t.clientTargetPricePerUnit)}`);
  }

  // DELIBERATELY ABSENT: `cellOverrides`, `lifts`, `globalPriceAdjPct` and
  // per-tier adjustments. Those are the levers. Including one would move the
  // fingerprint on the operator's own staging act, and the guard would fire at
  // exactly the moment it must stay silent.
  return djb2(parts.join("|"));
}

/**
 * A short, stable digest. Not cryptographic and does not need to be — it
 * compares a value against itself minutes later on one client.
 */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  // A second pass over the reversed string, so two inputs differing only by a
  // transposition far apart do not collide as readily as djb2 alone allows.
  let g = 52711;
  for (let i = s.length - 1; i >= 0; i--) g = ((g << 5) + g + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}-${(g >>> 0).toString(36)}-${s.length.toString(36)}`;
}
