/**
 * Telling same-type charges apart — ONE grammar, used wherever they are listed.
 *
 * ── WHY THIS IS A MODULE AND NOT A LOCAL HELPER ─────────────────────────
 *
 * The Recovery workspace and the customer document both have to name two Print
 * plates charges on one carton. A second implementation would be a second
 * grammar, free to disagree with the first the moment either changed — and the
 * two would disagree about the same charge on the same quote, one screen apart.
 * That is the shape this workstream keeps meeting: two authorities answering
 * one question.
 *
 * So the rule lives here and both surfaces call it. What they may differ on is
 * WHICH NAMES they feed it — the operator sees the component's internal label,
 * the customer sees its customer-facing name — not how the choice is made.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────
 *
 * The SMALLEST human-readable qualifier that actually distinguishes a charge
 * from its same-type siblings, each candidate tested against them:
 *
 *   one instance of a type               no qualifier
 *   own label unique among siblings      the label
 *   label absent or shared, owner unique the owner name
 *   neither alone, but the pair is       label · owner
 *   none of those                        nothing — never an id
 *
 * PRESENTATION ONLY. Identity is `chargeInstanceId` throughout; which string
 * is printed beside a row changes nothing about what it addresses.
 *
 * ── WHY UNIQUENESS AND NOT PRESENCE ─────────────────────────────────────
 *
 * Preferring the label whenever one exists fails a reachable case: two
 * components may each label their plates "Front panel". Both labels are valid
 * alone, neither distinguishes anything, and the distinct owner names sit
 * unused. The question is never "is there a label" but "does it tell this row
 * apart" — which is a question about siblings and cannot be answered from one
 * row.
 */

/** One charge of a type, with both of the names that could distinguish it. */
export type QualifierSibling = {
  instanceId: string;
  /** The operator's own label for the charge, or its customer-facing analogue. */
  ownLabel: string | null;
  /** The component that caused it, named for a reader. */
  ownerName: string | null;
};

/**
 * The qualifier for one instance among its same-type siblings.
 *
 * `siblings` must contain the instance itself and every other charge of the
 * same type on the quote — including ones with no economics yet, since a
 * charge nobody has priced is still a charge and still collides.
 */
export function chooseQualifier(
  siblings: readonly QualifierSibling[],
  instanceId: string,
): string | null {
  // One of a type needs no telling apart, and qualifying it would put lineage
  // on a row nothing collides with.
  if (siblings.length < 2) return null;
  const me = siblings.find((x) => x.instanceId === instanceId);
  if (!me) return null;

  const labelUnique =
    me.ownLabel !== null &&
    siblings.filter((x) => x.ownLabel === me.ownLabel).length === 1;
  if (labelUnique) return me.ownLabel;

  const ownerUnique =
    me.ownerName !== null &&
    siblings.filter((x) => x.ownerName === me.ownerName).length === 1;
  if (ownerUnique) return me.ownerName;

  const pairUnique =
    siblings.filter(
      (x) => x.ownLabel === me.ownLabel && x.ownerName === me.ownerName,
    ).length === 1;
  if (pairUnique && me.ownLabel !== null && me.ownerName !== null) {
    return `${me.ownLabel} · ${me.ownerName}`;
  }

  // An operator cannot act on a uuid, and a customer cannot read one. Nothing
  // is better than an identifier neither was meant to see.
  return null;
}
