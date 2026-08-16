/**
 * Staged pricing intent, held so that a remount cannot silently delete it.
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────────
 *
 * Two operators, one quote. A stages a Tier 4 adjustment; B commits a
 * quote-wide change. In one run of that scenario A's staged decision vanished
 * — no chip, no refusal, nothing written. In a second run of the same steps it
 * survived and Apply was correctly refused as PRICING_STALE.
 *
 * The staging sets are seeded from the store at MOUNT and move only on
 * stage / reset / apply-success. Nothing reconciles them from the server, so
 * no incoming update can overwrite them — which is why run two behaved. The
 * only remaining way for the chips to empty with nothing written is a REMOUNT,
 * where `useState(seed)` runs again against a store that has meanwhile
 * reconciled to the remote state. Both sets come back equal, the diff is
 * empty, and the operator's decision is gone without a word.
 *
 * The evidence is a neighbouring piece of mount-seeded state. The quote-wide
 * input's draft is `useState(String(fromStore))`. In the run that lost the
 * work it read 30 before Apply and 35 after — a value nobody typed. In the run
 * that kept the work it stayed at 35 while the store said 40. Only a remount
 * reseeds a draft; only a remount explains both.
 *
 * What triggered the remount is NOT established. The browser was under load at
 * the time (two renderer timeouts in the same window). That uncertainty is
 * exactly why the repair targets the invariant rather than the trigger: any
 * remount, from any cause, must not cost the operator a decision they made.
 *
 * ── WHAT IS PRESERVED, AND WHY BOTH HALVES ────────────────────────────────
 *
 * The snapshot carries the working set AND the committed baseline it was
 * staged against. Restoring only the working set would leave the operator's
 * intent sitting on a baseline that had meanwhile advanced, and the chip list
 * — a diff of the two — would invent changes nobody staged. Carrying both
 * restores the exact state the tab was in, which is what makes the existing
 * stale guard still fire: the baseline is the tab's belief at staging time,
 * the server compares it to what is persisted now, and refuses.
 *
 * That is the preferred outcome — intent visible, Apply refused, nothing
 * silent — reached by making a remount indistinguishable from no remount.
 *
 * Session-scoped and per-quote, so it cannot leak between quotes or outlive
 * the tab.
 */

import type { PricingSet } from "./pricing-staging";

const VERSION = 1;

const keyFor = (quoteId: string) => `nexus.pricing.staged.v${VERSION}.${quoteId}`;

export type StagedSnapshot = {
  /** The tab's belief about what was committed when it began staging. */
  committed: PricingSet;
  /** The operator's intent, including everything not yet applied. */
  working: PricingSet;
};

/**
 * sessionStorage, when there is one.
 *
 * Absent during SSR, and it throws rather than returns null in a few browser
 * privacy modes — so every access is guarded. Persistence failing must never
 * take the surface down with it: the cost of losing the snapshot is the defect
 * this module fixes, and the cost of throwing here is the whole page.
 */
function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function writeStagedSnapshot(quoteId: string, snap: StagedSnapshot): void {
  const s = storage();
  if (s === null) return;
  try {
    s.setItem(keyFor(quoteId), JSON.stringify(snap));
  } catch {
    // Quota, or a storage that accepts reads and refuses writes. Nothing to do
    // and nothing worth telling the operator — they lose the remount safety
    // net, not the surface.
  }
}

export function clearStagedSnapshot(quoteId: string): void {
  const s = storage();
  if (s === null) return;
  try {
    s.removeItem(keyFor(quoteId));
  } catch {
    /* see writeStagedSnapshot */
  }
}

/** Null when absent, unreadable, or not the shape this version writes. */
export function readStagedSnapshot(quoteId: string): StagedSnapshot | null {
  const s = storage();
  if (s === null) return null;
  let raw: string | null;
  try {
    raw = s.getItem(keyFor(quoteId));
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return validate(JSON.parse(raw));
  } catch {
    return null;
  }
}

const isRecordOfNumbers = (v: unknown): v is Record<string, number> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((n) => typeof n === "number" && Number.isFinite(n));

const asSet = (v: unknown): PricingSet | null => {
  if (typeof v !== "object" || v === null) return null;
  const c = v as Record<string, unknown>;
  if (!isRecordOfNumbers(c.lifts)) return null;
  if (!isRecordOfNumbers(c.overrides)) return null;
  if (!isRecordOfNumbers(c.tierAdj)) return null;
  if (typeof c.globalAdj !== "number" || !Number.isFinite(c.globalAdj)) return null;
  return {
    lifts: c.lifts,
    overrides: c.overrides,
    tierAdj: c.tierAdj,
    globalAdj: c.globalAdj,
  };
};

/**
 * Structural validation, not a formality.
 *
 * This reads a value a previous build wrote, so the shape is not guaranteed by
 * the type system the way an in-process value is. A malformed snapshot must
 * read as "no snapshot" and let the store seed the surface normally —
 * restoring half a set would be a worse failure than restoring none.
 */
export function validate(parsed: unknown): StagedSnapshot | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  const committed = asSet(o.committed);
  const working = asSet(o.working);
  if (committed === null || working === null) return null;
  return { committed, working };
}

/**
 * Which sets a mounting provider should start from.
 *
 * Pure, and separated from the provider so the invariant can be falsified
 * without a browser: given a snapshot holding staged intent and a store seed
 * that has already reconciled to another operator's write, the resolved
 * working set must still carry the intent.
 *
 * A snapshot with nothing staged is ignored — it says only that this tab once
 * looked at the quote, and deferring to it would resurrect a baseline the
 * store has since moved past for no benefit.
 */
export function resolveInitialSets(args: {
  storeSeed: PricingSet;
  snapshot: StagedSnapshot | null;
  /** `diffSets`, injected so this module owns no opinion about equality. */
  hasStagedWork: (committed: PricingSet, working: PricingSet) => boolean;
}): { committed: PricingSet; working: PricingSet; restored: boolean } {
  const { storeSeed, snapshot, hasStagedWork } = args;
  if (snapshot === null) {
    return { committed: storeSeed, working: storeSeed, restored: false };
  }
  if (!hasStagedWork(snapshot.committed, snapshot.working)) {
    return { committed: storeSeed, working: storeSeed, restored: false };
  }
  return {
    committed: snapshot.committed,
    working: snapshot.working,
    restored: true,
  };
}
