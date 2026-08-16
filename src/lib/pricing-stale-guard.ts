/**
 * Staleness guards for the staged pricing commit.
 *
 * A staged commercial decision is made against a state the operator could see.
 * If that state moved before Apply, committing anyway is last-write-wins on a
 * price — the quote silently becomes something nobody reviewed.
 *
 * TWO GUARDS, because the operator's remedy differs and a single "something
 * changed" refusal would not tell them which surface to go back to:
 *
 *   PRICING AUTHORITY — the levers. Global rate, tier rates, surgical lifts,
 *   direct prices. Someone else's pricing decision landed on this quote.
 *
 *   ECONOMIC BASIS — what the price was built ON. Packaging, production, bulk
 *   raw, freight, duty and tariff. The Costs surface moved underneath.
 *
 * `pg_snapshot_xmax` was considered for the second and rejected: it is a
 * database-wide transaction counter, so it advances on any commit anywhere and
 * would refuse an Apply because an unrelated quote was saved. A guard that
 * fires constantly is a guard operators learn to ignore.
 */

// ── economic basis ────────────────────────────────────────────────────────
//
// NOT DEFINED HERE. `costBaseFingerprint` in `pricing-cost-base.ts` already
// does this job: it digests everything the engine consumes EXCEPT the four
// levers, sorts every collection by its own identity so row order cannot move
// it, and its header already records why the bundle revision is the wrong
// instrument. It is wired into the staging context at both ends.
//
// I wrote a second one before finding it. Two fingerprints over the same
// question is how they drift, and the duplicate is deleted rather than kept
// "for the server side" — the server imports the same function.
//
// What was genuinely missing was SERVER-SIDE ENFORCEMENT of it, and the
// pricing-authority guard below, which did not exist in any form.

// ── pricing authority ─────────────────────────────────────────────────────

/**
 * The levers, as the client last saw them committed.
 *
 * Sent with the staged set so Apply can refuse when someone else's pricing
 * decision landed in between. Maps are carried as sorted entry pairs so the
 * comparison is order-independent and JSON-safe over the action boundary.
 */
export type PricingAuthorityBaseline = {
  globalAdj: string;
  tierAdj: ReadonlyArray<readonly [string, string]>;
  lifts: ReadonlyArray<readonly [string, string]>;
  overrides: ReadonlyArray<readonly [string, string]>;
};

const entries = (m: ReadonlyMap<string, string>) =>
  [...m.entries()].sort(([a], [b]) => a.localeCompare(b));

export function pricingAuthorityBaseline(state: {
  globalAdj: string;
  tierAdj: ReadonlyMap<string, string>;
  lifts: ReadonlyMap<string, string>;
  overrides: ReadonlyMap<string, string>;
}): PricingAuthorityBaseline {
  return {
    globalAdj: String(Number(state.globalAdj)),
    tierAdj: entries(state.tierAdj),
    lifts: entries(state.lifts),
    overrides: entries(state.overrides),
  };
}

export type StaleVerdict =
  | { stale: false }
  | { stale: true; kind: "pricing_authority"; moved: string[] }
  | { stale: true; kind: "economic_basis" };

/**
 * Compare what the operator staged against what is persisted now.
 *
 * Pricing authority is checked FIRST and reported field by field: it is the
 * more likely collision on a shared quote, and naming which lever moved is what
 * lets the operator decide whether their decision still stands.
 */
export function detectStale(args: {
  baseline: PricingAuthorityBaseline | null;
  persisted: PricingAuthorityBaseline;
  previewFingerprint: string | null;
  currentFingerprint: string;
}): StaleVerdict {
  const { baseline, persisted, previewFingerprint, currentFingerprint } = args;

  // Absent baseline means a caller that predates the guard. Refusing would
  // break every such caller; this is a contract addition, and the callers that
  // send nothing are simply not protected yet.
  if (baseline !== null) {
    const same = (
      a: ReadonlyArray<readonly [string, string]>,
      b: ReadonlyArray<readonly [string, string]>,
    ) =>
      a.length === b.length &&
      a.every(([k, v], i) => b[i]![0] === k && Number(b[i]![1]) === Number(v));

    const moved: string[] = [];
    if (Number(baseline.globalAdj) !== Number(persisted.globalAdj))
      moved.push("the quote-wide adjustment");
    if (!same(baseline.tierAdj, persisted.tierAdj)) moved.push("a tier adjustment");
    if (!same(baseline.lifts, persisted.lifts)) moved.push("a surgical lift");
    if (!same(baseline.overrides, persisted.overrides)) moved.push("a direct price");
    if (moved.length > 0) return { stale: true, kind: "pricing_authority", moved };
  }

  if (previewFingerprint !== null && previewFingerprint !== currentFingerprint) {
    return { stale: true, kind: "economic_basis" };
  }
  return { stale: false };
}

/** Operator-facing refusal text. The two classes send them to different surfaces. */
export function staleMessage(verdict: Extract<StaleVerdict, { stale: true }>): string {
  if (verdict.kind === "economic_basis") {
    return (
      "The costs behind this quote changed while you were deciding, so these " +
      "prices were calculated against figures that are no longer current. " +
      "Re-check Costs, then re-stage."
    );
  }
  const what = verdict.moved.join(", ");
  return (
    `Pricing on this quote changed while you were deciding — ${what} ` +
    "moved since you staged. Reload to see the current pricing, then re-stage."
  );
}
