/**
 * CERT-303 · does the cost mutator refuse SERVER-SIDE on a sent quote?
 *
 * READ ONLY against the database — it loads real rows and runs the real guard.
 *
 * WHAT THIS PROVES: the guard each cost mutator calls, given the REAL CERT-303
 * quote row as it stands after SEND, throws. A draft quote is run through the
 * same guard as a CONTROL, so a guard that threw unconditionally could not pass
 * this unnoticed.
 *
 * WHAT THIS DOES NOT PROVE: the HTTP transport. It does not POST to the server
 * action endpoint. The UI attempt was made separately and is recorded there:
 * re-enabling the disabled control and clicking Save produced NO request at
 * all, because the component gates its handler as well — so the transport
 * could not be exercised from the client without forging a Next-Action id.
 *
 * The two together say: the control is disabled, the handler is gated, and if
 * either were bypassed the guard below is what the mutator hits first. That
 * last clause is what `production-cost-lifecycle-guard.test.ts` asserts — that
 * assertDraft is called at the TOP of each mutator body, before any write.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes } from "@/db/schema";
import { assertDraft, ActionGuardError } from "@/lib/action-result";

const SENT = "430b5ce4-975b-4262-8247-aee668f287a8";   // CERT-303, sent
const DRAFT = "4781e4bb-0597-4044-a1ea-3ffc8c3be35a";  // control, draft

async function run(label: string, id: string) {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
  if (!q) { console.log(`${label}: QUOTE NOT FOUND — indeterminate`); return; }
  let verdict: string;
  try { assertDraft(q); verdict = "PASSED (write would proceed)"; }
  catch (e) {
    verdict = e instanceof ActionGuardError
      ? `REFUSED  code=${e.code}  message="${e.message}"`
      : `threw non-guard error: ${String(e)}`;
  }
  console.log(`${label.padEnd(34)} status=${String(q.status).padEnd(9)} ${verdict}`);
}

console.log("── the guard every production cost mutator calls first ──\n");
await run("CERT-303 (sent)", SENT);
await run("control: ZZ-VAL pricing-authority", DRAFT);

console.log("\n── the draft fixture I perturbed, restored? ──");
const { assemblyProductionInputs, quoteLeaves } = await import("@/db/schema");
const leaves = await db.select().from(quoteLeaves).where(eq(quoteLeaves.quoteId, DRAFT));
const svc = leaves.find((l) => l.commercialKind === "service");
if (svc) {
  const rows = await db.select().from(assemblyProductionInputs)
    .where(eq(assemblyProductionInputs.quoteLeafId, svc.id));
  console.table(rows.map((r) => ({ tier: r.tierId.slice(0, 8), rd: r.rdTotal, testing: r.testingMicrosTotal, other: r.otherServiceTotal })));
}
process.exit(0);
