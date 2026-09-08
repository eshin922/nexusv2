/**
 * O5 · create the NetSuite sandbox item for TRN-TP-SHIPPER.
 *
 * The write is GATED on the convention being real rather than assumed. Six
 * TRAINING packaging items already exist; this reads three of them in full and
 * refuses to create anything unless they agree with each other AND with the
 * authorized configuration. A convention proven from one record is a copy, not
 * a convention.
 *
 * Authorized configuration: InvtPart, subsidiary 2, asset 211, expense (COGS)
 * 212, income 218, tax schedule 2.
 */
import { nsRequest } from "@/lib/netsuite/client";

const SIBLINGS = [
  { id: "76155", itemId: "TRN-PP-BOTTLE-30" },
  { id: "76158", itemId: "TRN-SP-CARTON" },
  { id: "76162", itemId: "TRN-SP-GIFTBOX" },
];

const AUTHORIZED = {
  itemType: "InvtPart",
  subsidiary: "2",
  taxSchedule: "2",
  assetAccount: "211",
  cogsAccount: "212",
  incomeAccount: "218",
} as const;

const ref = (v: unknown): string | undefined =>
  v && typeof v === "object" && "id" in (v as Record<string, unknown>)
    ? String((v as { id: unknown }).id)
    : undefined;

// `subsidiary` is a SUBLIST on the REST item record, not a reference field, so
// it cannot be read from the main record body at all - it reads as absent, which
// is indistinguishable from unset. It is sourced from SuiteQL instead, where it
// is a real column. Reading it the other way produced a false divergence.
const sql = (await nsRequest({
  method: "POST",
  path: "/query/v1/suiteql",
  body: {
    q: `SELECT id, itemid, subsidiary, taxschedule FROM item WHERE id IN (${SIBLINGS.map((s) => s.id).join(",")})`,
  },
})) as { items: { id: string; subsidiary: string; taxschedule: string }[] };
const byId = new Map(sql.items.map((r) => [String(r.id), r]));

const rec = await Promise.all(
  SIBLINGS.map(async (s) => {
    const r = (await nsRequest({
      method: "GET",
      path: `/record/v1/inventoryItem/${s.id}`,
    })) as Record<string, unknown>;
    return {
      itemId: r.itemId as string,
      itemType: ref(r.itemType),
      subsidiary: byId.get(s.id)?.subsidiary,
      taxSchedule: byId.get(s.id)?.taxschedule ?? ref(r.taxSchedule),
      assetAccount: ref(r.assetAccount),
      cogsAccount: ref(r.cogsAccount),
      incomeAccount: ref(r.incomeAccount),
      customForm: ref(r.customForm),
      costingMethod: ref(r.costingMethod),
    };
  }),
);

console.log("-- established TRAINING packaging convention --");
for (const r of rec) console.log(JSON.stringify(r));

const keys = Object.keys(rec[0]).filter((k) => k !== "itemId") as (keyof (typeof rec)[0])[];
const divergent = keys.filter((k) => new Set(rec.map((r) => r[k])).size !== 1);
if (divergent.length) {
  console.log(`\nREFUSED - siblings disagree on: ${divergent.join(", ")}`);
  console.log("The convention is not established. No write performed.");
  process.exit(1);
}

const mismatch = (Object.keys(AUTHORIZED) as (keyof typeof AUTHORIZED)[]).filter(
  (k) => rec[0][k] !== AUTHORIZED[k],
);
if (mismatch.length) {
  console.log(
    `\nREFUSED - live convention differs from the authorized configuration on: ${mismatch.join(", ")}`,
  );
  for (const k of mismatch) console.log(`  ${k}: live=${rec[0][k]} authorized=${AUTHORIZED[k]}`);
  console.log("No write performed.");
  process.exit(1);
}

// customForm is not in the authorized list but IS part of the established
// convention - every sibling carries the same one. Sending it makes the new
// item identical to its siblings; omitting it would silently accept whatever
// form NetSuite defaults to, which is a different item shape.
const customForm = rec[0].customForm;
console.log(
  `\nconvention agreed across ${rec.length} siblings; customForm=${customForm} carried forward`,
);

const existing = (await nsRequest({
  method: "POST",
  path: "/query/v1/suiteql",
  body: { q: "SELECT id FROM item WHERE itemid = 'TRN-TP-SHIPPER'" },
})) as { items: { id: string }[] };
if (existing.items.length) {
  console.log(`\nALREADY EXISTS - id ${existing.items[0].id}; no write performed.`);
  process.exit(0);
}

const body = {
  itemId: "TRN-TP-SHIPPER",
  displayName: "TRAINING · Master Shipper",
  customForm: { id: customForm },
  // COLLECTION, not a reference - the same constraint `item-groups.ts` records
  // for `itemGroup`. `[{ id }]` and `{ id }` are both rejected INVALID_CONTENT.
  subsidiary: { items: [{ id: AUTHORIZED.subsidiary }] },
  taxSchedule: { id: AUTHORIZED.taxSchedule },
  assetAccount: { id: AUTHORIZED.assetAccount },
  cogsAccount: { id: AUTHORIZED.cogsAccount },
  incomeAccount: { id: AUTHORIZED.incomeAccount },
};
console.log(`\nPOST /record/v1/inventoryItem\n${JSON.stringify(body, null, 2)}`);

const created = await nsRequest<{ id?: string }>({
  method: "POST",
  path: "/record/v1/inventoryItem",
  body,
});
console.log(`\nCREATED - ${JSON.stringify(created)}`);

const back = (await nsRequest({
  method: "POST",
  path: "/query/v1/suiteql",
  body: {
    q: "SELECT id, itemid, itemtype, subsidiary, taxschedule, costingmethod, isinactive FROM item WHERE itemid = 'TRN-TP-SHIPPER'",
  },
})) as { items: Record<string, unknown>[] };
console.log(`READBACK - ${JSON.stringify(back.items)}`);
process.exit(0);
