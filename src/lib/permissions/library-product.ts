/**
 * Who may edit a library product — ONE rule, read by both layers.
 *
 * Deliberately free of `server-only` and of every server import, so the server
 * guard and the React components that render the affordance can call the SAME
 * function. That is the whole point of the file.
 *
 * ── WHY IT IS A FILE RATHER THAN A LINE IN THE GUARD ─────────────────────
 *
 * The last defect on this surface was not a gate set to the wrong value. It
 * was two layers answering one question with DIFFERENT rules:
 *
 *   server   assertCanCreateLeaves   →  role === "admin" passed through
 *   UI       disabled={!permissions.canCreateLeaves}  →  the raw column
 *
 * An operator was authorized on the server and disabled in the UI, and the
 * tooltip told an admin to "ask an admin". A shared predicate is what makes
 * that disagreement unrepresentable rather than merely unlikely.
 *
 * ── WHY THIS IS ROLE-BASED AND NOT THE GRANT COLUMN ──────────────────────
 *
 * `users.can_create_leaves` looks like the mechanism and cannot be, because
 * NOTHING GRANTS IT. There is no control for it under /admin/users; it is set
 * only by migration or direct SQL, and it is false for every row on the roster
 * but one. A guard reading it therefore resolves, in practice, to "admins
 * only" — which is why a PM asked to complete a SKU could not, and why
 * granting the column would have been both a production data edit and a wider
 * grant than the need (the same column also governs un-archiving a library
 * item and pulling the HubSpot catalog).
 *
 * The explicit grant is still honoured, so the one row that carries it does
 * not regress.
 *
 * ── THIS MAKES `pm` AN AUTHORIZATION-BEARING ROLE ────────────────────────
 *
 * Said plainly because it was not true before: until now no non-admin role
 * value was read for any authorization decision, and `ensure-user.ts` says so
 * in its own commentary (amended alongside this). `sales` is deliberately NOT
 * included even though it authors quotes beside PMs — `schema.ts` records that
 * sales carries no implied grants, and widening it here would decide that
 * quietly. If a sales rep meets the same wall it is one line, and Edward's.
 *
 * ── WHAT THIS DOES NOT UNLOCK ────────────────────────────────────────────
 *
 * Replacing an ESTABLISHED SKU. That refusal lives in `applyLeafEdit` and
 * applies to every caller regardless of role, because downstream identity —
 * quotes already sent, the NetSuite item it resolves to — may depend on it.
 * This predicate governs who may open a product edit at all; it says nothing
 * about which edits are legal, and it must never be made to.
 *
 * Nor auto-generation. A SKU typed by a person carries no reservation and
 * needs none; the generated path is gated independently on an approved brand,
 * a seeded counter and `SKU_GENERATION_ENABLED`, none of which this touches.
 */

/** The shape both layers pass around. One object, so a new capability is one edit. */
export type LibraryPermissions = {
  /** Un-archiving a library item and pulling the HubSpot catalog. The old grant. */
  canCreateLeaves: boolean;
  /** Opening a product edit — including completing a missing SKU. */
  canEditProduct: boolean;
};

/**
 * Only the two fields the decision reads, so a caller cannot accidentally
 * satisfy it with a differently-shaped object that happens to have a `role`.
 */
export type LibraryProductActor = {
  role: string;
  canCreateLeaves: boolean;
};

export function canEditLibraryProduct(actor: LibraryProductActor): boolean {
  if (actor.role === "admin") return true;
  // PMs author quotes, and a product with no SKU cannot be attached to one
  // (`evaluateAttachmentEligibility` requires a usable SKU). A PM blocked on a
  // missing SKU is blocked on their own work, by a grant nobody can issue.
  if (actor.role === "pm") return true;
  return actor.canCreateLeaves === true;
}
