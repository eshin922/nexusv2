/**
 * ABH retry — the real one. WRITES.
 *
 * Posts the previously-refused Sales Order to the NetSuite SANDBOX and
 * transitions the quote to `complete`. Authorized by Edward after #331 merged
 * and the read-only REG-4 gate passed.
 *
 * Target verified sandbox before running (`describeNetsuiteTarget`). The
 * HubSpot deal is ZZ-VALIDATION — UAT Case 1, a validation artifact; step 10's
 * conditional patch touches an amount, never a deal stage.
 */
import { describeNetsuiteTarget } from "@/lib/netsuite/client";
import { runMarkComplete } from "@/lib/netsuite/mark-complete";

const QUOTE_ID = "cfa7b84d-18fb-4ef0-9bba-ce2a44cd266c";
const ACTOR = "e60b5670-86d8-437b-9654-36a1284c7b19";

async function main() {
  const target = describeNetsuiteTarget();
  console.log("target:", JSON.stringify(target));
  if (!target.accountIsSandbox) {
    console.error("REFUSING — target is not a sandbox account.");
    process.exit(1);
  }

  console.log(`\nretrying markComplete on ${QUOTE_ID.slice(0, 8)} …\n`);
  try {
    const result = await runMarkComplete({ quoteId: QUOTE_ID, actorUserId: ACTOR });
    console.log("COMPLETED");
    console.log("  completedAt        :", result.completedAt.toISOString());
    console.log("  SO internal id     :", result.netsuite.salesOrderId);
    console.log("  SO tranid          :", result.netsuite.salesOrderTranid);
    console.log("  amount pushed      :", result.netsuite.amountPushed);
    console.log("  item groups        :", result.netsuite.itemGroups.length);
    for (const g of result.netsuite.itemGroups) {
      console.log(`      ${g.itemidDisplay} · ${g.outcome} · ns ${g.netsuiteInternalId}`);
    }
    console.log("  HubSpot amt patch  :", result.amountPatch.status);
  } catch (e) {
    console.error("REFUSED / FAILED:");
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  process.exit(0);
}

void main();
