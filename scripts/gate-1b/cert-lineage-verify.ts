/** Verifies the certification lineage hop by hop, using paths that work
 *  headlessly.
 *
 *  `resolveGovernedPaymentTerms` reaches NetSuite through the composition
 *  provider, which cannot load outside Next (a Clerk ESM import). That failure
 *  is reported as `netsuite_unavailable` — a fact about the harness, not about
 *  the lineage, and reporting it as "lineage incomplete" would be exactly the
 *  OD-027 error of treating a failed read as evidence of absence.
 *
 *  So each hop is checked through a path that does work, and the last hop uses
 *  `getRecord("customer", id)` — precisely what `readCustomerTerms` wraps. */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { hubspotDealsCache, netsuiteCustomerMap } from "@/db/schema";
import { getRecord } from "@/lib/netsuite/client";

const dealId = process.argv[2];
const fail: string[] = [];
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) fail.push(label);
};

console.log(`\nCERTIFICATION LINEAGE VERIFY · deal ${dealId}\n`);

const [cache] = await db
  .select({
    dealName: hubspotDealsCache.dealName,
    companyId: hubspotDealsCache.associatedCompanyId,
    companyName: hubspotDealsCache.associatedCompanyName,
  })
  .from(hubspotDealsCache)
  .where(eq(hubspotDealsCache.dealId, dealId));
check(Boolean(cache), "hop 0 · deal is cached", cache?.dealName ?? "—");
check(Boolean(cache?.companyId), "hop 1 · deal → associated company",
      `${cache?.companyId ?? "—"} · ${cache?.companyName ?? "—"}`);

const [mapped] = cache?.companyId
  ? await db
      .select({
        ns: netsuiteCustomerMap.netsuiteCustomerId,
        name: netsuiteCustomerMap.netsuiteCustomerDisplayName,
        verifiedAt: netsuiteCustomerMap.verifiedAt,
      })
      .from(netsuiteCustomerMap)
      .where(eq(netsuiteCustomerMap.hubspotCompanyId, cache.companyId))
  : [];
check(Boolean(mapped?.ns), "hop 2 · company → verified NetSuite customer",
      `${mapped?.ns ?? "—"} · ${mapped?.name ?? "—"}`);

if (mapped?.ns) {
  const rec = await getRecord<{ companyName?: string; terms?: { id?: string; refName?: string } }>(
    "customer", mapped.ns,
  );
  check(Boolean(rec.terms?.refName), "hop 3 · NetSuite customer → governed Terms",
        `"${rec.terms?.refName ?? "NONE"}" (id ${rec.terms?.id ?? "—"})`);
  check(rec.companyName === "ZZ-VALIDATION Nexus Certification Customer",
        "the mapped customer is the validation one, by name", rec.companyName ?? "—");
}

console.log(fail.length === 0
  ? "\nLINEAGE COMPLETE — every hop SEND walks resolves.\n"
  : `\n${fail.length} HOP(S) FAILED:\n  ${fail.join("\n  ")}\n`);
process.exit(fail.length === 0 ? 0 : 1);
