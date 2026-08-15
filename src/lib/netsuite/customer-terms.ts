import "server-only";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { hubspotDealsCache, netsuiteCustomerMap } from "@/db/schema";
import { getApplicationDependencies } from "@/lib/integrations/composition";

// C.1 — governed customer payment terms.
//
// A payment term printed on a customer quote is a COMMERCIAL COMMITMENT, so it
// needs an established business authority. Nexus previously printed
// `firm_settings.payment_terms_default` — one firm-wide free-text string with
// no customer dimension — for every customer. Measured against the 9 customers
// with verified NetSuite lineage, all 9 had a populated governed Terms record
// and all 9 disagreed with what Nexus would print; 5 of the 9 differed
// MATERIALLY (governed "Net 30" vs a printed 50%-deposit commitment). The other
// 4 agreed only by coincidence of drafting, which is not parity.
//
// The authority is NetSuite's Customer Terms record, reached through the same
// verified lineage the Sales Order push already trusts.
//
// SCOPE: this resolves the customer's governed STARTING VALUE and nothing else.
// A quote-specific override is deliberately NOT implemented — see the note at
// the foot of this file.

export type GovernedPaymentTerms =
  | { status: "governed"; value: string; netsuiteCustomerId: string }
  | { status: "unresolved"; reason: UnresolvedReason; detail: string };

export type UnresolvedReason =
  | "no_company"
  | "no_lineage"
  | "no_terms_on_customer"
  | "netsuite_unavailable";

/** Injectable for tests — the real one calls NetSuite. */
export type CustomerReader = (
  netsuiteCustomerId: string,
) => Promise<{ terms?: { id?: string; refName?: string } | null } | null>;

// OD-023 · routed through the DEPENDENCY BOUNDARY, not the client.
//
// This previously imported `getRecord` directly. The isolated validation
// harness composes `netsuite: isolated`, so every other NetSuite call was
// faked and this one silently was not — which made Send, whose terms gate
// fails closed, unreachable in the harness. A boundary one caller routes
// around is not a boundary.
const defaultReader: CustomerReader = async (id) => {
  const { netsuite } = await getApplicationDependencies();
  return netsuite.readCustomerTerms(id);
};

/**
 * Resolve the customer's governed payment terms.
 *
 * Returns a DISCRIMINATED OUTCOME rather than throwing or falling back, because
 * the two callers need opposite behaviour from the same fact:
 *
 * - draft preview may render provisionally, clearly marked;
 * - Send must FAIL CLOSED.
 *
 * Collapsing "unresolved" into a firm-default string here would make that
 * distinction unavailable to either of them, and silently returning the firm
 * default is the exact defect this exists to remove.
 *
 * `refName` is used verbatim. It is the governed record's own label, so
 * reformatting it would reintroduce the free-text problem one layer down.
 */
export async function resolveGovernedPaymentTerms(
  hubspotDealId: string | null | undefined,
  reader: CustomerReader = defaultReader,
): Promise<GovernedPaymentTerms> {
  const dealId = (hubspotDealId ?? "").trim();
  if (!dealId) {
    return {
      status: "unresolved",
      reason: "no_company",
      detail: "This quote's project has no HubSpot deal.",
    };
  }

  // Deal -> governed company -> verified NetSuite customer. The SAME lineage
  // `markComplete` trusts to pick the Sales Order's customer, so the terms on
  // the quote and the customer on the order cannot disagree about who this is.
  const [cache] = await db
    .select({ companyId: hubspotDealsCache.associatedCompanyId })
    .from(hubspotDealsCache)
    .where(eq(hubspotDealsCache.dealId, dealId))
    .limit(1);
  const companyId = (cache?.companyId ?? "").trim();
  if (!companyId) {
    return {
      status: "unresolved",
      reason: "no_company",
      detail: "This quote's HubSpot deal has no associated company.",
    };
  }

  const [mapped] = await db
    .select({ netsuiteCustomerId: netsuiteCustomerMap.netsuiteCustomerId })
    .from(netsuiteCustomerMap)
    .where(eq(netsuiteCustomerMap.hubspotCompanyId, companyId))
    .limit(1);

  if (!mapped?.netsuiteCustomerId) {
    return {
      status: "unresolved",
      reason: "no_lineage",
      detail:
        "No verified NetSuite customer is mapped to this HubSpot company, so its governed payment terms cannot be read.",
    };
  }

  let customer: Awaited<ReturnType<CustomerReader>>;
  try {
    customer = await reader(mapped.netsuiteCustomerId);
  } catch (e) {
    return {
      status: "unresolved",
      reason: "netsuite_unavailable",
      detail: `NetSuite customer ${mapped.netsuiteCustomerId} could not be read: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  const refName = customer?.terms?.refName?.trim();
  if (!refName) {
    return {
      status: "unresolved",
      reason: "no_terms_on_customer",
      detail: `NetSuite customer ${mapped.netsuiteCustomerId} has no Terms record set.`,
    };
  }

  return {
    status: "governed",
    value: refName,
    netsuiteCustomerId: mapped.netsuiteCustomerId,
  };
}

/** Operator-facing sentence for a blocked Send. Stated as what to do next. */
export function unresolvedTermsMessage(r: GovernedPaymentTerms): string | null {
  if (r.status === "governed") return null;
  return `Customer payment terms could not be verified. ${r.detail} Resolve the customer's NetSuite Terms before sending — the firm-wide default is not authority for a customer commitment.`;
}

// DEFERRED, NOT DECLINED — quote-specific payment-term override.
//
// Technically straightforward and deliberately out of V1. Two things are
// missing and neither is an engineering question:
//
//   1. Business authority for a PM to promise terms that differ from the
//      customer's governed record.
//   2. An approved option source. The NetSuite Terms vocabulary is not
//      enumerable by this integration — `term` is not a SuiteQL record and
//      `GET /record/v1/term/{id}` returns Permission Violation — so a picker
//      today could only offer free text, which is the defect being repaired.
//
// Reading ONE customer's governed term works (it arrives on the customer
// record as `terms.refName`); listing the vocabulary does not. Those are
// different permissions, and the difference is why the starting value is
// reachable now and the override is not.
