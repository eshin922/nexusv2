/**
 * How a payment term may be PRESENTED, given what authority stands behind it.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * `customer-terms.ts` already resolved the hard half correctly: it returns a
 * discriminated outcome distinguishing a governed customer term from four
 * distinct ways of failing to find one, and `sendQuote` fails closed on all
 * four. What it could not do was stop the DRAFT surfaces printing the
 * firm-wide default in the same visual register as a verified commitment.
 *
 * The resolver computed `paymentTermsSource: "frozen" | "governed" |
 * "provisional"` and carried it onto the view for exactly this purpose, and
 * its own comment says a draft "may render provisionally, CLEARLY MARKED".
 * Nothing ever consumed it — the flag had zero readers — so every draft printed
 * `firm_settings.payment_terms_default` as though the customer had agreed to
 * it. An operator reading "50% deposit, 50% on shipment" against a Net 90
 * customer had nothing on screen telling them the difference.
 *
 * ── THE SHAPE IS THE GUARANTEE ────────────────────────────────────────────
 *
 * This is a DISCRIMINATED UNION rather than a record with a `verified: boolean`
 * beside a `value`, because the boolean form can be ignored: a renderer reads
 * `.value`, prints it, and the flag sits there unread — which is precisely the
 * defect being repaired, reintroduced one layer up.
 *
 * The unverified arm therefore has no `value` field at all. Its string is
 * `provisionalValue`, so a surface that tries to print a term without deciding
 * what to do about the unverified case does not type-check. The compiler, not
 * a convention, is what keeps the two surfaces honest.
 */

/** Why a customer's governed term could not be read. */
export type PaymentTermsUnresolvedReason =
  | "no_company"
  | "no_lineage"
  | "no_terms_on_customer"
  | "netsuite_unavailable";

export type PaymentTermsPresentation =
  | {
      kind: "verified";
      /** Safe to print unqualified: an authority stands behind this string. */
      value: string;
      /** `frozen` = the promise actually sent. `governed` = the live record. */
      basis: "frozen" | "governed";
    }
  | {
      kind: "unverified";
      /**
       * The firm-wide default, or null. Deliberately NOT named `value`: this
       * string is not the customer's term and must never be printed as one.
       */
      provisionalValue: string | null;
      reason: PaymentTermsUnresolvedReason;
      /** Badge text. Short enough to sit beside the value. */
      qualifier: string;
      /** What this operator can do next. One sentence, business-facing. */
      action: string;
      /**
       * TRUE when the cause is a failed lookup rather than an absent mapping.
       *
       * The distinction is load-bearing, and the reason the taxonomy is not
       * collapsed: "we have never mapped this customer" is a data gap somebody
       * must close, and "NetSuite did not answer just now" is a transient
       * condition that closes itself on retry. Presenting the second as the
       * first sends an admin looking for a mapping that already exists.
       */
      transient: boolean;
    };

const COPY: Record<
  PaymentTermsUnresolvedReason,
  { qualifier: string; action: string; transient: boolean }
> = {
  no_company: {
    qualifier: "No customer on file",
    action:
      "This project has no associated HubSpot company, so no customer terms can be looked up.",
    transient: false,
  },
  no_lineage: {
    qualifier: "Customer not verified",
    action:
      "This customer has no verified NetSuite mapping yet. An admin can add one in Settings → NetSuite customers.",
    transient: false,
  },
  no_terms_on_customer: {
    qualifier: "No terms on customer",
    action:
      "The mapped NetSuite customer has no Terms record set. Set it in NetSuite, then reload.",
    transient: false,
  },
  netsuite_unavailable: {
    qualifier: "Could not be checked",
    action:
      "NetSuite could not be reached, so this customer's terms were not read. The mapping is not necessarily missing — try again shortly.",
    transient: true,
  },
};

/**
 * Decide how a term may be presented.
 *
 * `frozen` is verified because it is the term that was actually promised: a
 * sent quote renders its own snapshot, and re-deriving it later would let a
 * change to the customer's record rewrite what we are recorded as having
 * offered.
 */
export function presentPaymentTerms(input: {
  source: "frozen" | "governed" | "provisional" | null | undefined;
  value: string | null | undefined;
  unresolvedReason?: PaymentTermsUnresolvedReason | null;
}): PaymentTermsPresentation {
  if (input.source === "frozen" || input.source === "governed") {
    // An authority stands behind it — but only if there is actually a string.
    // A governed source with no value is a contradiction; treat it as
    // unverified rather than printing an em-dash that reads as a real term.
    const v = input.value?.trim();
    if (v) return { kind: "verified", value: v, basis: input.source };
  }

  const reason: PaymentTermsUnresolvedReason =
    input.unresolvedReason ?? "no_lineage";
  const copy = COPY[reason];
  return {
    kind: "unverified",
    provisionalValue: input.value?.trim() || null,
    reason,
    qualifier: copy.qualifier,
    action: copy.action,
    transient: copy.transient,
  };
}
