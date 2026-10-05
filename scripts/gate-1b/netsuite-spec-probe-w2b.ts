/**
 * W-2b · What does NetSuite enforce as unique on customrecord_nx_ordered_spec?
 * SANDBOX ONLY. Creates bare probe records (no transaction link), deletes all.
 */
import { createRecord, describeNetsuiteTarget, nsRequest } from "@/lib/netsuite/client";
if (!describeNetsuiteTarget().accountIsSandbox) process.exit(1);
const R = "customrecord_nx_ordered_spec";
const t = Date.now();
const created: string[] = [];
async function attempt(label: string, name: string, externalId: string) {
  try {
    const { internalId } = await createRecord({ recordType: R, body: { name, externalId } });
    created.push(String(internalId));
    console.log(`${label}: CREATED ${internalId}`);
  } catch (e) {
    console.log(`${label}: REFUSED ${String(e).slice(0, 150)}`);
  }
}
try {
  await attempt("A base             ", `w2b-${t}-n1`, `w2b-${t}-e1`);
  await attempt("B same ext, new name", `w2b-${t}-n2`, `w2b-${t}-e1`);
  await attempt("C same name, new ext", `w2b-${t}-n1`, `w2b-${t}-e3`);
  await attempt("D control, both new ", `w2b-${t}-n4`, `w2b-${t}-e4`);
} finally {
  for (const id of created) {
    await nsRequest({ method: "DELETE", path: `/record/v1/${R}/${id}`, maxRetries: 1 });
    let gone = false;
    try { await nsRequest({ method: "GET", path: `/record/v1/${R}/${id}`, maxRetries: 1 }); }
    catch (e) { gone = (e as { context?: { status?: number } }).context?.status === 404; }
    console.log(`cleanup ${id}: ${gone ? "CONFIRMED GONE" : "NOT CONFIRMED"}`);
  }
}
