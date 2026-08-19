/** READ-ONLY. Does a validation/test company already exist in the portal?
 *  If one does, the only write needed is a deal — which the write token CAN do. */
const token = process.env.HUBSPOT_ACCESS_TOKEN!;
for (const term of ["validation", "test", "DPS", "nexus"]) {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: term }] }],
      properties: ["name", "domain", "hs_object_id"],
      limit: 20,
    }),
  });
  if (!res.ok) { console.log(`\n"${term}": ${res.status} ${(await res.text()).slice(0,200)}`); continue; }
  const j = await res.json() as { total: number; results: Array<{ id: string; properties: Record<string,string|null> }> };
  console.log(`\n"${term}" — ${j.total} match(es)`);
  for (const c of j.results) console.log(`   ${c.id.padStart(12)}  ${c.properties.name ?? "—"}  (${c.properties.domain ?? "no domain"})`);
}
process.exit(0);

export {};
