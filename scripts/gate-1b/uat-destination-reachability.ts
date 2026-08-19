// Accounting UAT — destination reachability vs mapping state.
/** Which BV-011 destinations can a quote actually PRODUCE, and are they mapped? READ ONLY. */
import { db } from "@/db";
import { netsuiteDestinationItemMap } from "@/db/schema";
import {
  BV011_DESTINATIONS, OTC_COLUMN_DESTINATION, SERVICE_IDENTITY_DESTINATION,
  isPerLineDestination, type Bv011Destination,
} from "@/lib/netsuite/bv011-destinations";
import { OTC_FEE_FIELDS } from "@/lib/commercial-projection";

// Producible = emitted by the OTC fee emitter, or by a Direct Service identity.
const fromFees = new Set<Bv011Destination>();
for (const f of OTC_FEE_FIELDS) {
  const d = (OTC_COLUMN_DESTINATION as Record<string, Bv011Destination>)[f as string];
  if (d) fromFees.add(d);
}
const fromServices = new Set<Bv011Destination>(Object.values(SERVICE_IDENTITY_DESTINATION));
const producible = new Set<Bv011Destination>([...fromFees, ...fromServices]);

const rows = await db.select().from(netsuiteDestinationItemMap);
const mapped = new Set(rows.filter(r => (r.netsuiteInternalId ?? "").trim() !== "").map(r => r.destination));

console.log(`OTC fee columns: ${OTC_FEE_FIELDS.join(", ")}`);
console.log(`producible destinations: ${producible.size} of ${BV011_DESTINATIONS.length}\n`);
const rowsOut: Array<Record<string, string>> = [];
for (const d of BV011_DESTINATIONS) {
  const k = d.key as Bv011Destination;
  const prod = producible.has(k);
  const perLine = isPerLineDestination(k);
  const isMapped = mapped.has(k as never);
  rowsOut.push({
    destination: k,
    producible: prod ? "YES" : "no",
    resolution: perLine ? "per-line" : isMapped ? "firm-mapped" : "UNMAPPED",
    verdict: !prod ? "unreachable — needs business design to exist"
      : perLine || isMapped ? "EXECUTABLE" : "PRODUCIBLE BUT UNMAPPED — would refuse",
  });
}
console.table(rowsOut);
const gap = rowsOut.filter(r => r.verdict.startsWith("PRODUCIBLE BUT"));
console.log(`\nreal mapping gaps (producible + unmapped): ${gap.length ? gap.map(g=>g.destination).join(", ") : "none"}`);
process.exit(0);
