/** READ-ONLY. Full property dump for one company. */
const id = process.argv[2];
const token = process.env.HUBSPOT_ACCESS_TOKEN!;
const res = await fetch(
  `https://api.hubapi.com/crm/v3/objects/companies/${id}?properties=name,domain,description,industry,createdate,hs_lastmodifieddate,lifecyclestage,hs_object_id`,
  { headers: { authorization: `Bearer ${token}` } },
);
if (!res.ok) { console.log(`FAILED ${res.status} ${await res.text()}`); process.exit(1); }
const j = await res.json() as { id: string; properties: Record<string, string | null> };
console.log(`\ncompany ${j.id}`);
for (const [k, v] of Object.entries(j.properties)) console.log(`  ${k.padEnd(22)} ${v ?? "—"}`);
process.exit(0);
export {};
