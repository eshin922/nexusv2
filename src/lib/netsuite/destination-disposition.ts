/**
 * WHAT TO DO ABOUT A FROZEN LINE'S ACCOUNTING DESTINATION — the decision alone.
 *
 * ── WHY IT IS ITS OWN FUNCTION ──────────────────────────────────────────
 *
 * `assessProjectionReadiness` reads a quote, joins four tables and walks every
 * frozen line. So the destination decision inside it could only be tested by
 * standing up a whole quote, which meant in practice it was tested by reading
 * the source — and reading the source is exactly how a defect survives that
 * looks right and is not. The prior discriminator compared a frozen
 * customer-facing name against an operator-facing label; it read plausibly and
 * was never once true.
 *
 * Pulled out, the decision is a pure function of five structural facts, and
 * every era it has to tell apart can be stated as a case.
 *
 * ── IT DECIDES; IT DOES NOT SPEAK ───────────────────────────────────────
 *
 * No copy here, and no label lookup. The caller turns a disposition into a
 * sentence. That separation IS the D2 requirement: a change to customer copy
 * or to an operator label cannot reach a disposition it cannot see.
 *
 * ── THE FOUR NULLS ──────────────────────────────────────────────────────
 *
 * A null destination describes four unrelated states, and the whole job is
 * telling them apart:
 *
 *   the line resolves by SKU              a product line owes no destination
 *   the legacy combined Tooling/Artwork   no rule can split it
 *   frozen before this model existed      knowable, simply never captured
 *   the resolution ran and produced none  and said why
 *
 * Only the last carries a reason, and the third is identified BY THE ABSENCE
 * of one. That is why no backfill was written for the reason column: inventing
 * a reason for a historical row would erase the one signal that distinguishes
 * it, and it would be an invented fact besides.
 */
import type { Bv011Destination } from "@/lib/netsuite/bv011-destinations";

/** Why the projection could not resolve a destination, as it froze the answer. */
export type FrozenUnresolvedReason =
  | "tooling_classification_missing"
  | "component_type_ungoverned"
  | null;

export type DestinationDisposition =
  /** A destination is present and mapped. Nothing blocks this line. */
  | { kind: "ready"; destination: Bv011Destination }
  /**
   * Present, governed, and no NetSuite item is mapped to it. A configuration
   * problem an admin fixes once, in Settings — NOT a quote problem, and it must
   * never be reported as one.
   */
  | { kind: "unmapped_destination"; destination: Bv011Destination }
  /**
   * A Tooling charge nobody classified. An operator can state this in one
   * click, and then the quote must be re-sent so the answer is frozen onto the
   * new version.
   */
  | { kind: "tooling_classification_missing" }
  /**
   * The charge type names no governed BV-011 destination. Not closable from the
   * quote at all, so the remedy is not a re-send.
   */
  | { kind: "component_destination_ungoverned" }
  /**
   * Frozen before destinations were recorded. A re-send captures one, which is
   * the whole remedy — and the disposition a component line could not reach
   * while the branch above claimed every one of them first.
   */
  | { kind: "destination_not_recorded" };

/**
 * The disposition for one frozen line.
 *
 * `isMapped` is passed rather than looked up, because the mapping table is a
 * database read and this must stay pure. The caller already holds the map.
 */
export function disposeDestination(input: {
  destination: Bv011Destination | null;
  /** As frozen by the projection. Null on any line predating that model. */
  unresolvedReason: FrozenUnresolvedReason;
  isMapped: boolean;
}): DestinationDisposition {
  if (input.destination !== null) {
    // A resolved destination is a resolved destination, whatever produced the
    // line. A component charge WITH one posts like any other.
    return input.isMapped
      ? { kind: "ready", destination: input.destination }
      : { kind: "unmapped_destination", destination: input.destination };
  }

  // No destination. The reason — or its absence — says which era this is.
  if (input.unresolvedReason === "tooling_classification_missing") {
    return { kind: "tooling_classification_missing" };
  }
  if (input.unresolvedReason === "component_type_ungoverned") {
    return { kind: "component_destination_ungoverned" };
  }

  // No reason recorded: the resolution never ran on this line, because it did
  // not exist when the line froze.
  //
  // NEVER a fallback to `otc_tooling`. It is a real destination with a real
  // item, so defaulting would post cutting dies to the mould account silently —
  // the exact error the classification exists to prevent, reintroduced as a
  // convenience.
  return { kind: "destination_not_recorded" };
}
