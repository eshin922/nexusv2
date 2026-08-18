/** READ-ONLY sandbox query: is there already a customer suitable as the
 *  permanent validation lineage, and does it carry Terms? */
import { suiteQL, describeNetsuiteTarget } from "@/lib/netsuite/client";
const t = describeNetsuiteTarget();
console.log(`
NetSuite target: env=${t.environment} accountIsSandbox=${t.accountIsSandbox} writeAuthorized=${t.writeAuthorized}
`);

const { items: q } = await suiteQL<{ id: string; entityid: string; companyname: string | null; terms: string | null; isinactive: string }>(
  `SELECT c.id, c.entityid, c.companyname, c.terms, c.isinactive
     FROM customer c
    WHERE UPPER(c.entityid) LIKE '%TEST%' OR UPPER(c.entityid) LIKE '%VALID%'
       OR UPPER(c.companyname) LIKE '%TEST%' OR UPPER(c.companyname) LIKE '%VALID%'
       OR UPPER(c.companyname) LIKE '%DPS%'
    ORDER BY c.id`,
);
console.log(`candidate customers: ${q.length}`);
for (const r of q)
  console.log(`  id=${String(r.id).padStart(7)} terms=${(r.terms ?? "—").toString().padStart(5)} inactive=${r.isinactive}  ${r.entityid} · ${r.companyname ?? ""}`);

const { items: withTerms } = await suiteQL<{ n: string }>(`SELECT COUNT(*) AS n FROM customer WHERE terms IS NOT NULL`);
const { items: total } = await suiteQL<{ n: string }>(`SELECT COUNT(*) AS n FROM customer`);
console.log(`\ncustomers in sandbox: ${total[0]?.n} · with Terms set: ${withTerms[0]?.n}`);
process.exit(0);
