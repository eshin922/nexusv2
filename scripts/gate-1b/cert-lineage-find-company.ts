/** READ-ONLY. Locate the certification company by its exact governed name.
 *
 *  Three independent probes, because one negative from HubSpot search is weak
 *  evidence: the index is eventually consistent, and CONTAINS_TOKEN tokenizes
 *  on word boundaries so a hyphenated term may not match as written. Absence is
 *  only reported when every probe SUCCEEDED and none found it (OD-027). */
const NAME = "ZZ-VALIDATION — Nexus Certification Customer";
const token = process.env.HUBSPOT_ACCESS_TOKEN!;

type Co = { id: string; properties: Record<string, string | null> };
const seen = new Map<string, Co>();
let anyFailed = false;

async function search(label: string, body: unknown) {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) { anyFailed = true; console.log(`  ${label}: FAILED ${res.status}`); return; }
  const j = await res.json() as { results?: Co[] };
  const n = j.results?.length ?? 0;
  console.log(`  ${label}: ${n}`);
  for (const c of j.results ?? []) seen.set(c.id, c);
}

const props = ["name", "domain", "hs_object_id", "createdate"];
await search("token 'certification'", {
  filterGroups: [{ filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: "certification" }] }],
  properties: props, limit: 50,
});
await search("token 'validation'", {
  filterGroups: [{ filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: "validation" }] }],
  properties: props, limit: 50,
});
await search("20 most recently created", {
  sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
  properties: props, limit: 20,
});

console.log(`\ndistinct companies seen: ${seen.size}`);
const exact = [...seen.values()].find((c) => c.properties.name === NAME);
for (const c of seen.values())
  if (/valid|cert|nexus|zz/i.test(c.properties.name ?? ""))
    console.log(`   ${c.id}  "${c.properties.name}"  created=${c.properties.createdate ?? "—"}`);

if (exact) console.log(`\nEXACT MATCH · companyId=${exact.id}`);
else if (anyFailed) console.log(`\nINDETERMINATE — at least one probe failed; absence not established`);
else console.log(`\nNOT FOUND — all probes succeeded, none carried the exact name`);
process.exit(0);
export {};
