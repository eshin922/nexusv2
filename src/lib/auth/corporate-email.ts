/**
 * Corporate email normalization for identity matching (#327).
 *
 * A LEAF MODULE, deliberately: no imports, so the rule that decides whether two
 * addresses are "the same person" can be asserted on its own, and so nothing
 * about it depends on the database or the auth broker.
 */

/**
 * Case-fold and trim. NOTHING ELSE.
 *
 * Plus-addressing and dots are deliberately NOT stripped. Those rules are
 * provider-specific — Gmail collapses them, most corporate mail does not — and
 * applying them here would mean `cally+x@thedps.co` signing in could claim the
 * pre-authorized row belonging to `cally@thedps.co`. The conservative rule
 * refuses to match rather than risk matching the wrong person.
 *
 * Must stay identical to the `lower(email)` unique index, so the code and the
 * schema agree on what "the same address" means.
 */
export function normalizeCorporateEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The tenant domain Enterprise SSO resolves. */
export const CORPORATE_DOMAIN = "@thedps.co";

/**
 * Is this a corporate identity?
 *
 * STRICTER than the middleware's sign-in check, deliberately. That check also
 * honours an `ALLOWED_EMAILS` break-glass list so a non-tenant address can be
 * let into the application; this one does not. Being allowed to sign in and
 * being eligible to claim a pre-authorized row are different questions, and
 * answering the second with the first would let the break-glass list bind
 * identities to provisioned employees.
 */
export function isCorporateEmail(email: string): boolean {
  return normalizeCorporateEmail(email).endsWith(CORPORATE_DOMAIN);
}
