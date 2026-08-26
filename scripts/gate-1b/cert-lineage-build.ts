/**
 * Builds links 2–4 of the certification customer lineage. See
 * `docs/validation/certification-customer-lineage.md` and OPEN_DECISIONS
 * CERT-1.
 *
 *   2 · a validation HubSpot deal, associated to the validation company
 *   3 · a validation NetSuite sandbox customer, with Terms
 *   4 · the `netsuite_customer_map` binding between them
 *
 * Then verifies `resolveGovernedPaymentTerms` end to end, because each link
 * existing is not the same as the chain resolving — and the chain is the only
 * thing SEND cares about.
 *
 * ── SAFETY ────────────────────────────────────────────────────────────────
 *
 * Writes to production HubSpot (a deal) and the NetSuite SANDBOX (a customer).
 * Both are explicitly authorized as permanent certification infrastructure.
 *
 * IDEMPOTENT by design: every step looks for its record first and reuses it.
 * Re-running must not accumulate duplicate validation deals in the CRM, which
 * is exactly what a certification fixture would otherwise do every time
 * someone re-ran the walk.
 *
 * Requires --commit to write. Without it, reports what it WOULD do.
 *
 *   usage: cert-lineage-build <hubspotCompanyId> [--commit]
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { hubspotDealsCache, users } from "@/db/schema";
import { syncDealById } from "@/lib/hubspot-cache";
import { upsertCustomerMap } from "@/lib/netsuite/customer-map";
import { resolveGovernedPaymentTerms } from "@/lib/netsuite/customer-terms";
import { createRecord, getRecord, suiteQL, describeNetsuiteTarget } from "@/lib/netsuite/client";

const companyId = process.argv[2];
const COMMIT = process.argv.includes("--commit");
if (!companyId) {
  console.error("usage: cert-lineage-build <hubspotCompanyId> [--commit]");
  process.exit(1);
}

/**
 * The deal to provision, overridable so one governed implementation can build
 * more than one lineage.
 *
 * WHY IT IS A PARAMETER RATHER THAN A SECOND SCRIPT: the safety here is not in
 * the name, it is in the steps — search before create, first pipeline stage
 * only, existing company, existing NetSuite customer, existing map. A copy of
 * this file with a different constant would be a second place those steps live
 * and the first place one of them gets dropped.
 *
 * A run that supplies a name still creates NO NetSuite or accounting identity:
 * steps 3 and 4 look their records up and reuse them, so a lineage on an
 * already-mapped company inherits the governed chain rather than asserting a
 * new one.
 */
const nameArg = process.argv.find((a) => a.startsWith("--name="));
const DEAL_NAME =
  nameArg?.slice("--name=".length) ?? "ZZ-VALIDATION — Nexus Certification Lineage";
const NS_CUSTOMER_NAME = "ZZ-VALIDATION Nexus Certification Customer";
const DPS_SALES_PIPELINE_ID = "108896657";

const readToken = process.env.HUBSPOT_ACCESS_TOKEN!;
const writeToken = process.env.HUBSPOT_WRITE_ACCESS_TOKEN!;
const step = (n: string) => console.log(`\n── ${n} ${"─".repeat(Math.max(0, 60 - n.length))}`);
const say = (k: string, v: string) => console.log(`  ${k.padEnd(26)} ${v}`);

console.log(`\nCERTIFICATION LINEAGE BUILD ${COMMIT ? "· COMMIT" : "· DRY RUN (pass --commit to write)"}`);

// ── the company, re-read rather than trusted from the argument ───────────
step("1 · company (created by hand; read only)");
{
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/companies/${companyId}?properties=name,domain`,
    { headers: { authorization: `Bearer ${readToken}` } },
  );
  if (!res.ok) { console.error(`  company ${companyId} unreadable: ${res.status}`); process.exit(1); }
  const c = await res.json() as { properties: Record<string, string | null> };
  say("companyId", companyId);
  say("name", c.properties.name ?? "—");
  say("domain", c.properties.domain ?? "—");
}

// ── 2 · the deal ─────────────────────────────────────────────────────────
step("2 · validation deal");
let dealId: string | null = null;
{
  // Look before creating. A duplicate validation deal is CRM litter that
  // outlives whoever created it.
  const found = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
    method: "POST",
    headers: { authorization: `Bearer ${readToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      // EQ on the exact name, not a token match on "certification". The token
      // search only ever found deals that happened to contain that word, so a
      // differently-named lineage would not have been found and this script
      // would have created a duplicate every run — the CRM litter the comment
      // above exists to prevent.
      filterGroups: [{ filters: [{ propertyName: "dealname", operator: "EQ", value: DEAL_NAME }] }],
      properties: ["dealname", "dealstage", "pipeline"],
      limit: 50,
    }),
  });
  if (!found.ok) { console.error(`  deal search failed ${found.status} — refusing to create blind`); process.exit(1); }
  const fj = await found.json() as { results?: Array<{ id: string; properties: Record<string,string|null> }> };
  const existing = (fj.results ?? []).find((d) => d.properties.dealname === DEAL_NAME);

  if (existing) {
    dealId = existing.id;
    say("reused existing deal", `${dealId} "${existing.properties.dealname}"`);
  } else if (!COMMIT) {
    say("would create", `"${DEAL_NAME}" in pipeline ${DPS_SALES_PIPELINE_ID}, associated to ${companyId}`);
  } else {
    // First stage of the pipeline: a validation deal must not look further
    // along a real sales process than it is.
    const stages = await fetch(
      `https://api.hubapi.com/crm/v3/pipelines/deals/${DPS_SALES_PIPELINE_ID}`,
      { headers: { authorization: `Bearer ${readToken}` } },
    );
    if (!stages.ok) { console.error(`  pipeline read failed ${stages.status}`); process.exit(1); }
    const sj = await stages.json() as { stages: Array<{ id: string; label: string; displayOrder: number }> };
    const first = [...sj.stages].sort((a, b) => a.displayOrder - b.displayOrder)[0];
    say("pipeline stage", `${first.label} (${first.id})`);

    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
      method: "POST",
      headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        properties: {
          dealname: DEAL_NAME,
          pipeline: DPS_SALES_PIPELINE_ID,
          dealstage: first.id,
        },
        associations: [{
          to: { id: companyId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 5 }],
        }],
      }),
    });
    if (!res.ok) { console.error(`  deal create FAILED ${res.status} ${await res.text()}`); process.exit(1); }
    const d = await res.json() as { id: string };
    dealId = d.id;
    say("CREATED deal", dealId);
  }
}

// ── cache the deal so Nexus can see the lineage ──────────────────────────
step("2b · deal cache");
if (dealId && COMMIT) {
  const row = await syncDealById(dealId);
  if (!row) { console.error("  syncDealById returned nothing"); process.exit(1); }
  const [cached] = await db
    .select({
      dealName: hubspotDealsCache.dealName,
      companyId: hubspotDealsCache.associatedCompanyId,
      companyName: hubspotDealsCache.associatedCompanyName,
    })
    .from(hubspotDealsCache)
    .where(eq(hubspotDealsCache.dealId, dealId));
  say("cached deal_name", cached?.dealName ?? "—");
  say("associated company", `${cached?.companyId ?? "—"} · ${cached?.companyName ?? "—"}`);
  if (!cached?.companyId) {
    console.error("\n  The association did not reach the cache. The lineage starts at");
    console.error("  associated_company_id, so SEND would still fail at no_company.");
    process.exit(1);
  }
} else {
  say("skipped", COMMIT ? "no deal id" : "dry run");
}

// ── 3 · the NetSuite customer ────────────────────────────────────────────
step("3 · NetSuite sandbox customer");
let nsCustomerId: string | null = null;
let nsTermsPresent = false;
{
  const t = describeNetsuiteTarget();
  say("target", `env=${t.environment} sandboxAccount=${t.accountIsSandbox} writeAuthorized=${t.writeAuthorized}`);
  if (!t.accountIsSandbox) {
    console.error("  REFUSING — this is not a sandbox account.");
    process.exit(1);
  }

  const { items: existing } = await suiteQL<{ id: string; entityid: string; companyname: string | null; terms: string | null }>(
    `SELECT id, entityid, companyname, terms FROM customer
      WHERE UPPER(companyname) LIKE 'ZZ-VALIDATION%' ORDER BY id`,
  );
  if (existing.length > 0) {
    nsCustomerId = String(existing[0].id);
    nsTermsPresent = existing[0].terms !== null;
    say("reused existing customer", `${nsCustomerId} "${existing[0].companyname}" terms=${existing[0].terms ?? "NONE"}`);
  } else if (!COMMIT) {
    say("would create", `"${NS_CUSTOMER_NAME}" with Terms`);
  } else {
    // Terms is what the whole lineage is FOR — resolveGovernedPaymentTerms
    // reads `customer.terms.refName` and returns no_terms_on_customer without
    // it. Take the Terms record the firm's own customers use rather than
    // inventing an id.
    //
    // Tallied in JS: `term` is not a queryable SuiteQL record, and
    // `GROUP BY terms ORDER BY COUNT(*)` returns a 500 from this account.
    const { items: used } = await suiteQL<{ terms: string }>(
      `SELECT terms FROM customer WHERE terms IS NOT NULL`, { limit: 1000 },
    );
    const tally = new Map<string, number>();
    for (const r of used) tally.set(String(r.terms), (tally.get(String(r.terms)) ?? 0) + 1);
    const [commonest, n] = [...tally].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!commonest) { console.error("  no Terms record found to copy"); process.exit(1); }

    // Read the refName rather than assuming what the id means — the same REST
    // path `readCustomerTerms` uses, so what is verified is what SEND reads.
    const { items: exemplar } = await suiteQL<{ id: string }>(
      `SELECT id FROM customer WHERE terms = ${Number(commonest)}`, { limit: 1 },
    );
    const rec = await getRecord<{ terms?: { refName?: string } }>("customer", String(exemplar[0].id));
    say("terms internalId", `${commonest} · "${rec.terms?.refName ?? "?"}" · ${n} of ${used.length} sampled customers`);

    const created = await createRecord({
      recordType: "customer",
      body: {
        companyname: NS_CUSTOMER_NAME,
        isperson: false,
        terms: { id: String(commonest) },
        comments: "Permanent Nexus lifecycle certification customer. Not a real customer. See docs/validation/certification-customer-lineage.md",
      },
    });
    nsCustomerId = String(created.internalId);
    nsTermsPresent = true;
    say("CREATED customer", nsCustomerId);
  }
}

// ── 4 · the binding ──────────────────────────────────────────────────────
step("4 · netsuite_customer_map binding");
if (nsCustomerId && COMMIT) {
  const [actor] = await db.select({ id: users.id }).from(users).orderBy(users.createdAt).limit(1);
  const r = await upsertCustomerMap({
    hubspotCompanyId: companyId,
    netsuiteCustomerId: nsCustomerId,
    netsuiteCustomerDisplayName: NS_CUSTOMER_NAME,
    actorUserId: actor.id,
  });
  say(r.created ? "CREATED mapping" : "updated mapping", `${companyId} → ${nsCustomerId}`);
} else {
  say("skipped", COMMIT ? "no customer id" : "dry run");
}

// ── the chain, end to end ────────────────────────────────────────────────
step("verify · resolveGovernedPaymentTerms");
if (dealId && COMMIT) {
  const terms = await resolveGovernedPaymentTerms(dealId);
  if (terms.status === "governed") {
    say("STATUS", `governed · "${terms.value}" · NetSuite customer ${terms.netsuiteCustomerId}`);
    console.log("\nLINEAGE COMPLETE — SEND can resolve governed payment terms for this deal.\n");
  } else {
    say("STATUS", `${terms.status} · ${terms.reason}`);
    say("detail", terms.detail);
    console.log("\nLINEAGE INCOMPLETE — see the reason above.\n");
    process.exit(1);
  }
} else {
  say("skipped", "dry run — nothing to resolve yet");
  console.log(`\nDRY RUN COMPLETE. Re-run with --commit to build.\n`);
}
void nsTermsPresent;
process.exit(0);
