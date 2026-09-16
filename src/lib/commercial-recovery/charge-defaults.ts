/**
 * Product Type → suggested component charges.
 *
 * A SUGGESTION LAYER, and nothing else. Every value this module produces is an
 * offer an operator confirms or declines; none of it decides that a charge
 * applies, where it posts, or whether it could post.
 *
 * ── THREE STATES, AND THE THIRD IS THE POINT ─────────────────────────────
 *
 * `needs_review` and `none_expected` are NOT the same answer, and a surface
 * that renders both as "no suggestions" destroys the difference at exactly the
 * moment it matters. One says the firm decided; the other says nobody has
 * looked yet. An operator reading an empty list deserves to know which.
 *
 * This is the same distinction `resolveSpecSchema` draws between `no_schema`
 * and `unmapped`, for the same reason, and it is drawn the same way: as
 * separate kinds that no consumer can collapse by accident.
 *
 * ── WHAT THIS MODULE MUST NEVER RETURN ───────────────────────────────────
 *
 * A tooling classification. Mould/collar versus cutting die selects a
 * different NetSuite destination, and `componentChargeDestination` refuses an
 * unclassified tooling charge rather than defaulting. A suggestion carrying
 * one would make that accounting choice from a product category.
 *
 * A NetSuite item. `other_service` and `otc_testing` choose their item PER
 * LINE, frozen at send. Anything here would be a second answer to a question
 * the frozen selection already answers.
 *
 * A readiness verdict. Whether a charge is APPLICABLE and whether its
 * destination is mapped and verified are different questions with different
 * owners; see `ChargeSuggestion` below.
 *
 * ── AND WHEN IT IS READ ──────────────────────────────────────────────────
 *
 * Only when composing the offer for a component being ADDED. Never when
 * rendering a charge that already exists on a quote. That is what makes an
 * operator's choices survive a later change to the defaults: their charges are
 * rows they authored, and nothing re-derives them. `chargeDefaultsAreReadOnlyAtAuthoringTime`
 * in the tests pins it.
 */
import type { ComponentChargeKey } from "./registry";

/**
 * One suggested charge.
 *
 * `preselected` is a STARTING POSITION for a checkbox, not an assertion that
 * the charge applies. The operator confirms; nothing here is a decision.
 *
 * Deliberately carries no `toolingClassification`, no `netsuiteItem`, and no
 * readiness field. Their absence is the contract — see the module header.
 */
export type ChargeSuggestion = {
  chargeKey: ComponentChargeKey;
  preselected: boolean;
  /** Why this rule exists, as the admin who set it wrote it. */
  note: string | null;
};

/** The reviewed verdict for one product type, as stored. */
export type ChargeProfileRow = {
  productTypeValue: string;
  verdict: "defaults" | "none_expected";
  reviewedByEmail: string | null;
  reviewedAt: Date;
  note: string | null;
};

export type ChargeDefaultRow = {
  productTypeValue: string;
  chargeKey: ComponentChargeKey;
  preselected: boolean;
  note: string | null;
};

/**
 * What the surface should say.
 *
 * Four kinds, none interchangeable. `contradiction` exists because the
 * database cannot express "none_expected implies no rules" in a CHECK — it
 * spans two tables — so the invariant is enforced in the action layer and this
 * resolver REPORTS a violation rather than silently preferring one side.
 * Preferring either would hide a state that should never occur, and hiding it
 * is how it would persist.
 */
export type ChargeDefaultsResolution =
  /** Nobody has reviewed this product type. NOT "no charges". */
  | { kind: "needs_review"; productTypeValue: string }
  /** Reviewed, and the answer is that none are expected. A finished answer. */
  | {
      kind: "none_expected";
      productTypeValue: string;
      reviewedByEmail: string | null;
      reviewedAt: Date;
      note: string | null;
    }
  /** Reviewed, with suggestions to offer. */
  | {
      kind: "suggestions";
      productTypeValue: string;
      suggestions: ChargeSuggestion[];
      reviewedByEmail: string | null;
      reviewedAt: Date;
    }
  /** The invariant is violated. Surfaced, never resolved by preference. */
  | { kind: "contradiction"; productTypeValue: string; detail: string };

/**
 * Resolve what to offer for a product type.
 *
 * A pure function of rows that were already read, so the decision is testable
 * without a database and cannot acquire a second implementation in a query.
 *
 * `productTypeValue` of `null` — a product with no authoritative
 * classification at all — is `needs_review` under its own name rather than an
 * error: an unclassified product is a real state, and the surface should ask
 * for a classification rather than report a fault.
 */
export function resolveChargeDefaults(input: {
  productTypeValue: string | null;
  profile: ChargeProfileRow | null;
  rules: readonly ChargeDefaultRow[];
}): ChargeDefaultsResolution {
  const value = input.productTypeValue ?? "";

  if (!input.profile) {
    // Rules without a profile cannot happen through the FK, but a caller that
    // passed mismatched rows would otherwise silently look reviewed.
    if (input.rules.length > 0) {
      return {
        kind: "contradiction",
        productTypeValue: value,
        detail: `${input.rules.length} rule(s) with no reviewed profile`,
      };
    }
    return { kind: "needs_review", productTypeValue: value };
  }

  const mine = input.rules.filter((r) => r.productTypeValue === input.profile!.productTypeValue);

  if (input.profile.verdict === "none_expected") {
    if (mine.length > 0) {
      return {
        kind: "contradiction",
        productTypeValue: value,
        detail: `verdict is none_expected but ${mine.length} rule(s) exist`,
      };
    }
    return {
      kind: "none_expected",
      productTypeValue: value,
      reviewedByEmail: input.profile.reviewedByEmail,
      reviewedAt: input.profile.reviewedAt,
      note: input.profile.note,
    };
  }

  // verdict === "defaults". An empty rule set here is ALSO a contradiction:
  // "there are defaults" and "there are none" cannot both be true, and
  // reporting it as `none_expected` would invent a finished answer nobody gave.
  if (mine.length === 0) {
    return {
      kind: "contradiction",
      productTypeValue: value,
      detail: "verdict is defaults but no rules exist",
    };
  }

  return {
    kind: "suggestions",
    productTypeValue: value,
    // Stable order, so two operators adding the same component see the same
    // list in the same sequence.
    suggestions: [...mine]
      .sort((a, b) => a.chargeKey.localeCompare(b.chargeKey))
      .map((r) => ({
        chargeKey: r.chargeKey,
        preselected: r.preselected,
        note: r.note,
      })),
    reviewedByEmail: input.profile.reviewedByEmail,
    reviewedAt: input.profile.reviewedAt,
  };
}

/**
 * Operator-facing copy for a resolution that offers nothing.
 *
 * Exported so the two empty states cannot drift into the same sentence in two
 * different surfaces — which is the practical way the distinction gets lost.
 */
export function describeEmptyResolution(
  r: ChargeDefaultsResolution,
): string | null {
  switch (r.kind) {
    case "needs_review":
      return "No charge defaults have been reviewed for this product type yet.";
    case "none_expected":
      return "Reviewed: no one-time charges are expected for this product type.";
    case "contradiction":
      return "Charge defaults for this product type are inconsistent and need an admin.";
    case "suggestions":
      return null;
    default: {
      const unhandled: never = r;
      throw new Error(`[charge-defaults] unhandled resolution: ${JSON.stringify(unhandled)}`);
    }
  }
}
