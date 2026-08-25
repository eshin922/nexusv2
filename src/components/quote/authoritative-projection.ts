import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { CustomerView } from "@/types/quote";

/**
 * The state a write produced, resolved on the server AFTER it committed.
 *
 * ── WHY THIS TYPE EXISTS SEPARATELY ──────────────────────────────────────
 *
 * So that "authoritative" is a thing the code can name, and so nothing can
 * quietly put an approximation in its place.
 *
 * These are the outputs of `resolveCustomerView` — THE resolver, the one the
 * page render calls — not a cheaper parallel computation of what probably
 * changed. A second, lighter projection would be a second authority over
 * customer economics, and the first time it disagreed the operator would be
 * reading a number the customer's document does not carry.
 *
 * It reaches the surface one render earlier than the revalidation would carry
 * it. That is the entire difference: the same answer, sooner.
 */
export type AuthoritativeProjection = {
  view: CustomerView;
  recoveryRows: RecoveryChargeRow[];
};
