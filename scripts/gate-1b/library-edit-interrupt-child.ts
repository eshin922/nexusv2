/**
 * A process KILLED between its HubSpot request and its local write.
 *
 * The fake signals that the request has been RECEIVED and then never completes,
 * so the parent can terminate this process at the boundary that matters. It is
 * a real SIGKILL: nothing here runs a cleanup path, catches a signal, or gets
 * to record anything afterwards.
 *
 * What must survive is the attempt row, written and committed BEFORE the
 * request was issued, with its dispatch already counted. If dispatch were
 * counted after the call returned, this attempt would read as having sent
 * nothing -- and a later retry would release it.
 */
import { assertRuntimeSafety } from "@/lib/config/runtime-config";
{
  const safety = assertRuntimeSafety();
  if (
    safety.mode !== "isolated" ||
    !safety.database?.name.includes("nexus_validation")
  ) {
    throw new Error("[interrupt-child] refusing outside the isolated runtime");
  }
}
import { updateLeaf } from "@/app/actions/leaves";

const [, , leafId, version, name, sku] = process.argv;
if (!leafId || !version) {
  console.error("usage: <leafId> <expectedUpdatedAt> <name> <sku>");
  process.exit(2);
}

const fd = new FormData();
fd.set("leafId", leafId);
fd.set("expectedUpdatedAt", version);
fd.set("name", name);
fd.set("sku", sku);
fd.set("hubspotProductType", "Labels");
fd.set("unitCost", "4.00");
fd.set("url", "");

process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-barrier";
console.log("CHILD:starting");

void updateLeaf(fd).then((r) => {
  // If this is ever reached, the parent's window did not exist and its case
  // fails for the right reason.
  console.log(`CHILD:completed ok=${r.ok}`);
});

setInterval(() => {}, 1000);
