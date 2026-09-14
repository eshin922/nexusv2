/**
 * A process that is KILLED between its remote request and its local write.
 *
 * Not a simulation of one. The parent spawns this, waits until the HubSpot
 * call is demonstrably in flight, and sends SIGKILL -- so nothing here runs a
 * cleanup path, catches a signal, or gets a chance to record anything. That is
 * the point: the durable protection has to already exist, written and
 * committed before the request was issued, or it does not exist at all.
 *
 * The HubSpot call is made slow by the `product-update-slow` scenario, which
 * gives the parent a wide, deterministic window to kill inside.
 *
 * Prints one line the parent can parse, then blocks. It is not expected to
 * exit on its own.
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

const leafId = process.argv[2];
const version = process.argv[3];
const name = process.argv[4];
const sku = process.argv[5];

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

process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-slow";
console.log("CHILD:starting");

// Deliberately un-awaited in a way that keeps the process alive: the parent
// kills it. If it ever completes, the parent sees that too and the case fails
// for the right reason -- the window it meant to test did not exist.
void updateLeaf(fd).then((r) => {
  console.log(`CHILD:completed ok=${r.ok}`);
});

setInterval(() => {}, 1000);
