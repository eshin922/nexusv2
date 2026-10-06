/** Can a customrecord_nx_ordered_spec be found by externalId? SANDBOX ONLY; deletes what it creates. */
import { createRecord, describeNetsuiteTarget, nsRequest, suiteQL } from "@/lib/netsuite/client";
if (!describeNetsuiteTarget().accountIsSandbox) process.exit(1);
const R = "customrecord_nx_ordered_spec";
const eid = `nxos:probe-eid:${Date.now()}`;
const { internalId } = await createRecord({ recordType: R, body: { name: "eid probe", externalId: eid } });
console.log("created", internalId);
try {
  try {
    const r = await nsRequest<Record<string, unknown>>({ method: "GET", path: `/record/v1/${R}/eid:${encodeURIComponent(eid)}`, maxRetries: 1 });
    console.log("REST eid: ->", r.id, r.externalId);
  } catch (e) { console.log("REST eid: FAILED", String(e).slice(0, 160)); }
  try {
    const q = await suiteQL<Record<string, unknown>>(`select id, externalid, name from ${R} where externalid = '${eid.replace(/'/g, "''")}'`);
    console.log("SuiteQL ->", JSON.stringify(q.items));
  } catch (e) { console.log("SuiteQL FAILED", String(e).slice(0, 160)); }
  try {
    const q = await suiteQL<Record<string, unknown>>(`select * from ${R} where id = ${internalId}`);
    console.log("SuiteQL columns ->", Object.keys(q.items[0] ?? {}).join(","));
  } catch (e) { console.log("SuiteQL cols FAILED", String(e).slice(0, 160)); }
} finally {
  await nsRequest({ method: "DELETE", path: `/record/v1/${R}/${internalId}`, maxRetries: 1 });
  try { await nsRequest({ method: "GET", path: `/record/v1/${R}/${internalId}`, maxRetries: 1 }); console.log("cleanup NOT CONFIRMED"); }
  catch (e) { console.log("cleanup", (e as { context?: { status?: number } }).context?.status === 404 ? "CONFIRMED GONE" : "UNCERTAIN"); }
}
