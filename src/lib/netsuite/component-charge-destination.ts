/**
 * WHERE A COMPONENT-OWNED ONE-TIME CHARGE POSTS — the accounting authority.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────
 *
 * Component charge economics were governed all the way through Send — costed,
 * elected, priced by charge type, frozen as instructions — and then stopped.
 * `projection-readiness` refused every one of them with
 * `component_destination_ungoverned`, because no map said which BV-011
 * destination a component charge posts to. The refusal was correct: the
 * economics were governed and the accounting identity was not.
 *
 * O3 was the first order to reach it. Its Tooling and Label Print Plates
 * charges are separately billed, so they need their own accounting lines, and
 * there was nothing to tell NetSuite what those lines are.
 *
 * ── TWO LAYERS, BECAUSE ONE CHARGE TYPE IS NOT ONE DESTINATION ──────────
 *
 * Four of the five component charge types name exactly one BV-011 destination,
 * so they are a direct map.
 *
 * `tooling` is not. It is authored as "Tooling & dies" — "cutting die, mould or
 * collar for this component" — and BV-011 governs a cutting die and a mould as
 * DIFFERENT destinations. One map entry would book every die as a mould or
 * every mould as a die. That is the shape BV-011 §4.2 already records for the
 * legacy `Tooling / artwork` column, which is non-elective for the same reason.
 *
 * So a Tooling instance carries its own classification, and the classification
 * names the destination. It is recorded by the operator, never inferred: not
 * from the owner, the SKU, the component type, the label or the amount. A
 * bottle's tooling is USUALLY a mould, and "usually" is not an accounting
 * authority — the one case where it is wrong would post to the wrong account
 * with nothing saying so.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────
 *
 * Not a recovery decision. `included` and `separate` decide whether a separate
 * accounting line EXISTS; this decides what identity that line uses when it
 * does. An `included` charge needs no destination to be sendable, and assigning
 * one would not make it emit — the two authorities are independent and stay so.
 */

import type { Bv011Destination } from "@/lib/netsuite/bv011-destinations";
import type { ComponentChargeKey } from "@/lib/commercial-recovery/registry";

/**
 * Every accounting classification a Tooling charge may carry.
 *
 * Deliberately closed and deliberately small. A third value is a new accounting
 * destination, which is a BV-011 decision rather than a code change.
 */
export const TOOLING_CLASSIFICATIONS = ["mould_collar", "cutting_die"] as const;
export type ToolingClassification = (typeof TOOLING_CLASSIFICATIONS)[number];

export const TOOLING_CLASSIFICATION_LABELS: Record<ToolingClassification, string> = {
  mould_collar: "Mould / collar",
  cutting_die: "Cutting die",
};

/** The classification's destination. One place, so the two cannot drift. */
export const TOOLING_CLASSIFICATION_DESTINATION: Record<
  ToolingClassification,
  Bv011Destination
> = {
  // NOT `otc_tooling`. That destination carries an unresolved conflict — BV-011
  // §1.b records it Inventory while its sandbox item OTC-0005 is NonInvtPart —
  // and a new governed path must not be built on a contested one. `otc_mould`
  // maps to OTC-0006 "OTC - Mold", which the firm's chart of accounts already
  // holds as a distinct item.
  mould_collar: "otc_mould",
  cutting_die: "otc_dies",
};

/**
 * Charge type -> destination, for the types that name exactly one.
 *
 * `tooling` is ABSENT, and its absence is the point: it is the one type whose
 * destination depends on a fact the type does not carry. A `Partial` rather
 * than a total record, so adding a component charge type does not silently
 * acquire a destination by default — an unmapped type refuses, which is the
 * BV-013 posture (unknown is not a guess).
 */
export const COMPONENT_CHARGE_DESTINATION: Partial<
  Record<ComponentChargeKey, Bv011Destination>
> = {
  print_plates: "otc_print_plates",
  artwork_plate: "otc_artwork",
  samples: "otc_samples",
  other_service: "otc_other_service",
};

export type ComponentDestinationResolution =
  | { kind: "resolved"; destination: Bv011Destination }
  /** The type needs an instance classification and has none. Operator-fixable. */
  | { kind: "needs_classification"; chargeKey: "tooling" }
  /** No governed destination for this type at all. Not operator-fixable. */
  | { kind: "ungoverned"; chargeKey: string };

/**
 * The destination for one component charge instance.
 *
 * Total over the three outcomes, so a caller cannot treat "needs a fact from
 * the operator" and "nothing governs this" as one state — they send a person to
 * different places, and collapsing them is how a fixable refusal reads as a
 * dead end.
 *
 * NEVER falls back to `otc_tooling`. An unclassified Tooling charge refuses.
 */
export function componentChargeDestination(input: {
  chargeKey: string;
  toolingClassification?: ToolingClassification | null;
}): ComponentDestinationResolution {
  if (input.chargeKey === "tooling") {
    const c = input.toolingClassification;
    if (c && c in TOOLING_CLASSIFICATION_DESTINATION) {
      return { kind: "resolved", destination: TOOLING_CLASSIFICATION_DESTINATION[c] };
    }
    return { kind: "needs_classification", chargeKey: "tooling" };
  }
  const direct = (COMPONENT_CHARGE_DESTINATION as Record<string, Bv011Destination | undefined>)[
    input.chargeKey
  ];
  return direct
    ? { kind: "resolved", destination: direct }
    : { kind: "ungoverned", chargeKey: input.chargeKey };
}
