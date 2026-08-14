// Usage indicator. B-5.
//
// WHAT THIS REPLACED, AND WHY IT IS SO MUCH SMALLER. This surface used to be a
// cascade warning: a full-width amber banner listing every referencing quote,
// each stamped DRAFT · WILL UPDATE or SENT · STAYS PINNED, above the sentence
// "sent quotes stay pinned to v1; draft quotes auto-update to the new values".
//
// That was true of the pre-B-3 model and is now false in every clause. Editing
// a Library default changes NO existing quote, whatever its state, because each
// quote owns its specification from the moment of attachment. A quote-side edit
// changes that quote alone.
//
// So the panel is not reworded — the decision it existed to support no longer
// exists. Its whole job was to let an operator predict which quotes an edit
// would propagate to; nothing propagates. A rewritten warning would be
// complexity preserved out of habit, and the B-3 rule is deliberately simple
// enough not to need one.
//
// What remains is orientation, not a warning: how widely this product is used.
// Neutral by construction, because it makes no claim about what an edit
// reaches — that claim now belongs to the page header, where it is one sentence.

export function CascadeWarning({
  references,
  currentQuoteId,
}: {
  references: { quoteId: string }[];
  /**
   * The quote being edited, excluded from the count. Absent in Library scope,
   * where every referencing quote is genuinely "another quote".
   */
  currentQuoteId?: string;
}) {
  const otherQuotes = new Set(
    references.map((r) => r.quoteId).filter((id) => id !== currentQuoteId),
  ).size;

  if (otherQuotes === 0) return null;

  return (
    <div className="a1v2-usage-note" role="note">
      Used in {otherQuotes} other quote{otherQuotes === 1 ? "" : "s"}.
    </div>
  );
}
