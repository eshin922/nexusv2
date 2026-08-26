/**
 * Composing a customer's address for the customer document.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────
 *
 * It used to live in `hubspot-customer-identity.ts`, beside the association and
 * contact-SELECTION logic. That module is imported by `hubspot.ts`, which is
 * reachable from the NetSuite Sales Order projection — so a function whose only
 * job is to render lines for a customer-facing document was sitting inside the
 * projection's reachable graph.
 *
 * Nothing was broken by it. The projection never called it, and
 * `verify:netsuite-isolation` did not flag it because a helper module matches
 * none of its forbidden patterns. But the whole point of that verifier is to
 * keep the reachable graph SEMANTICALLY clean, and "a customer-document
 * formatter is reachable from the SO projection" is exactly the kind of thing
 * that reads as harmless once and gets cited as precedent later.
 *
 * The line drawn:
 *
 *   SELECTION of a governed customer fact  -> integration/domain module,
 *                                             legitimately reachable
 *   FORMATTING it for the customer's own   -> here, and not reachable
 *   document
 *
 * `composeContactName` deliberately stays on the domain side: assembling a
 * person's name from `firstname` + `lastname` normalises the fact itself, and
 * the cache writer needs it to store the contact at all. This composes six
 * separate fields into display lines with punctuation and ordering chosen for a
 * reader — that is a rendering decision, not a fact.
 *
 * Pure, and unchanged in behaviour by the move.
 */

export type CompanyAddressParts = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

/**
 * Compose the address for display. Returns null when there is nothing to show,
 * so the block collapses rather than rendering punctuation around emptiness.
 *
 * Source values are passed through verbatim — including ones that look wrong.
 * Correcting a customer's address on the way to their own quotation would put a
 * value in front of them that exists nowhere in the CRM, and the next person to
 * compare the two would have no way to tell which was authored.
 * See `docs/validation/finding-smart-pressed-juice-postal-code.md`.
 */
export function composeAddress(parts: CompanyAddressParts): string | null {
  const clean = (v: string | null) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  const line1 = clean(parts.line1);
  const line2 = clean(parts.line2);
  const city = clean(parts.city);
  const state = clean(parts.state);
  const postal = clean(parts.postalCode);
  const country = clean(parts.country);

  // "Irvine, CA 92618" — comma after the city only, which is the convention a
  // US reader expects; a bare state or postcode still renders sensibly.
  const locality = [
    city,
    [state, postal].filter(Boolean).join(" ") || null,
  ].filter(Boolean).join(", ");

  const lines = [line1, line2, locality || null, country].filter(
    (l): l is string => Boolean(l),
  );
  return lines.length > 0 ? lines.join("\n") : null;
}
