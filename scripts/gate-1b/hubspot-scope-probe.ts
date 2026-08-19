/** READ-ONLY. What can the write token actually do?
 *
 *  Asked BEFORE attempting to create anything. If the scopes are absent, the
 *  answer is that a human creates the records in the HubSpot UI — not that a
 *  write is attempted and fails somewhere mid-lineage. */
const tokens: Array<[string, string | undefined]> = [
  ["HUBSPOT_ACCESS_TOKEN (read)", process.env.HUBSPOT_ACCESS_TOKEN],
  ["HUBSPOT_WRITE_ACCESS_TOKEN", process.env.HUBSPOT_WRITE_ACCESS_TOKEN],
];
for (const [name, token] of tokens) {
  if (!token) { console.log(`\n${name}: NOT SET`); continue; }
  const res = await fetch(
    "https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info",
    { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenKey: token }) },
  );
  if (!res.ok) { console.log(`\n${name}: probe failed ${res.status} ${await res.text()}`); continue; }
  const info = await res.json() as { hubId?: number; userId?: number; scopes?: string[] };
  const want = ["crm.objects.companies.write", "crm.objects.deals.write",
                "crm.objects.companies.read", "crm.objects.deals.read"];
  console.log(`\n${name}`);
  console.log(`  portal (hubId): ${info.hubId}`);
  console.log(`  scopes: ${info.scopes?.length ?? 0}`);
  for (const w of want)
    console.log(`    ${info.scopes?.includes(w) ? "YES" : "no "}  ${w}`);
}
process.exit(0);

export {};
