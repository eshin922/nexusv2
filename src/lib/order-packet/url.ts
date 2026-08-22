/**
 * The Nexus Order Packet URL for one sent offer.
 *
 * A LEAF MODULE, so the rule that turns a snapshot id into an operator-facing
 * link can be asserted without a database or a NetSuite call.
 *
 * ── WHY THE BASE IS CONFIGURED, NOT HARDCODED ────────────────────────────
 *
 * This URL is written into a NetSuite Sales Order and outlives the deploy that
 * produced it. A literal would be wrong the moment the host changes, and wrong
 * in a place nobody looks — on old orders. It is read from the environment and
 * REFUSES rather than falling back to a guess: an order carrying a link to the
 * wrong host is worse than one carrying no link, because the empty field is
 * visibly empty and the wrong link is not.
 */

/** Keyed to the SNAPSHOT: order-specific, and stable across later revisions. */
export function orderPacketPath(quoteSnapshotId: string): string {
  return `/orders/${quoteSnapshotId}/documents`;
}

export function orderPacketUrl(
  quoteSnapshotId: string,
  baseUrl: string | undefined,
): string | null {
  const base = baseUrl?.trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}${orderPacketPath(quoteSnapshotId)}`;
}
