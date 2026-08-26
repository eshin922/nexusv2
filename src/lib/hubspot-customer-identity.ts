/**
 * Who is the customer on a deal, and where are they?
 *
 * ── THE RULE, AND WHY IT REFUSES ────────────────────────────────────────
 *
 * Governed V1 contact selection:
 *
 *   explicit HubSpot primary contact     -> use it
 *   exactly one associated contact       -> use it
 *   zero associated contacts             -> blank
 *   several, and none marked primary     -> blank
 *
 * First-association, most-recently-modified and every other ordering heuristic
 * are excluded. They are technical ordering rules wearing business intent: the
 * output is a named individual printed on a customer-facing quotation, and
 * "whichever row the API happened to return first" is not a reason to print
 * someone's name on it.
 *
 * Verified against the live API before this was written: `deal -> companies`
 * defines `typeId 5, label "Primary"`, so an explicit primary exists there and
 * `to[0]` was only ever coincidentally right. `deal -> contacts` defines
 * exactly ONE type — `typeId 3, label null` — so HubSpot publishes no
 * primary-contact association for deals in this portal, and the sole-contact
 * branch carries the real weight.
 *
 * ── ABSENCE IS RECORDED WITH ITS REASON ─────────────────────────────────
 *
 * `selection` says which branch fired. A blank contact is otherwise ambiguous:
 * "nobody is associated" and "four are associated and none is primary" are
 * different facts about the CRM, and only the second is something an operator
 * can act on. `unresolved` is a THIRD thing again — the lookup failed and the
 * question was not answered — and it must never be read as either kind of
 * absence.
 *
 * Pure. No network, no database: the selection is decided here from data the
 * caller fetched, so it can be exercised without either.
 */

/** A deal -> contact association, as the caller read it from HubSpot. */
export type ContactAssociation = {
  contactId: string;
  /** True when HubSpot itself marks the association primary. */
  isPrimary: boolean;
};

export type ContactSelection =
  | "primary"
  | "sole"
  | "none_zero"
  | "none_multiple"
  | "unresolved";

export type SelectedContact = {
  contactId: string | null;
  selection: ContactSelection;
};

/**
 * HubSpot's association-type id for a PRIMARY company on a deal. Confirmed
 * against the live schema rather than assumed — see the header.
 */
export const HUBSPOT_PRIMARY_COMPANY_TYPE_ID = 5;

export function selectContact(
  associations: ContactAssociation[],
): SelectedContact {
  const primary = associations.filter((a) => a.isPrimary);
  if (primary.length === 1) {
    return { contactId: primary[0]!.contactId, selection: "primary" };
  }
  // Several marked primary is a CRM contradiction, not a tie to be broken.
  // Falling through to the sole-contact branch would be wrong too — there is
  // more than one contact by definition — so it lands in none_multiple, which
  // is the honest description and the one an operator can act on.
  if (primary.length > 1) return { contactId: null, selection: "none_multiple" };

  if (associations.length === 0) return { contactId: null, selection: "none_zero" };
  if (associations.length === 1) {
    return { contactId: associations[0]!.contactId, selection: "sole" };
  }
  return { contactId: null, selection: "none_multiple" };
}

/** Selects the explicitly primary company. Never the first row. */
export function selectPrimaryCompany(
  associations: { companyId: string; typeIds: number[] }[],
): string | null {
  const primary = associations.filter((a) =>
    a.typeIds.includes(HUBSPOT_PRIMARY_COMPANY_TYPE_ID),
  );
  if (primary.length === 1) return primary[0]!.companyId;
  // Zero primaries, or several, is not a tie to break by position. A deal with
  // no primary company is a lineage gap the preflight already refuses on
  // (`hasHubspotCompany`), and that refusal is more useful than a guess.
  return null;
}

/** "Jennifer Sevilla" from its parts, or null when there is no name at all. */
export function composeContactName(
  firstName: string | null,
  lastName: string | null,
): string | null {
  const name = [firstName, lastName]
    .map((v) => (v ?? "").trim())
    .filter((v) => v !== "")
    .join(" ");
  return name === "" ? null : name;
}
