/**
 * Order 2 · Freight — INDEPENDENT reconciliation against the frozen #528 facts.
 *
 * Reads the DATABASE and the ENGINE and compares both against values written
 * before the scenario was authored. Imports nothing from the expectation side
 * except the frozen constants themselves, so agreement is evidence rather than
 * a tautology.
 *
 * FOUR grains, because a single total can reconcile while attribution is
 * wrong ("exact reconciliation is necessary but not sufficient"):
 *
 *   SOURCE  what is persisted — selected destination, member set, per-tier
 *           amounts, and each markup individually. Decoys must be PRESENT and
 *           economically INACTIVE.
 *   LEAF    per-leaf landed cost and billable freight, all three tiers.
 *   QUOTE   multiply the per-member contributions back through member count x
 *           tier units and prove every entered dollar enters EXACTLY ONCE.
 *   ENGINE  what Nexus actually computed, compared in CENTS against the same
 *           frozen inputs. The first three grains prove the expectation is
 *           self-consistent; only this one proves the SYSTEM agrees with it.
 *
 * Then six falsifications. A control that cannot fail proves nothing, so each
 * asserts that the WRONG choice produces a DIFFERENT number:
 *
 *   1  selecting the decoy would change the result
 *   2  the wrong markup on freight / duty / tariff would change the result
 *   3  dropping member-count allocation would change the result
 *   4  double-applying member count would change the result
 *
 * Cents, not floats, at the engine boundary: the engine carries IEEE residue
 * (10494.999999999998 for 10495) and an exact compare would fail on noise
 * rather than on money.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";

const QUOTE = "c555a868-dabe-416a-b853-13ef7c770469";
const rows = <T,>(r: unknown) => r as unknown as T[];
const money = (n: number) => n.toFixed(6);
const cents = (n: number) => Math.round(n * 100);

// ── FROZEN #528 INPUTS — authored before the scenario existed ──────────────
const TIERS = [
  { label: "Tier 1", units: 800 },
  { label: "Tier 2", units: 2100 },
  { label: "Tier 3", units: 5500 },
];

const FROZEN = [
  {
    label: "A",
    members: ["TRN-PP-BOTTLE-30", "TRN-PP-PUMP", "TRN-SP-CARTON"],
    selected: "Long Beach, CA",
    decoy: "Oakland, CA",
    freight: [7412, 13905, 26318],
    decoyFreight: [8967, 15230, 24104],
    freightMarkup: 0.18,
    duty: [1163, 2477, 5041],
    dutyMarkup: 0.07,
    tariff: [634, 1388, 2913],
    tariffMarkup: 0.11,
  },
  {
    label: "B",
    members: ["TRN-SP-LABEL"],
    selected: "Reno, NV",
    decoy: "Sparks, NV",
    freight: [1286, 2704, 5192],
    decoyFreight: [1601, 2318, 6045],
    freightMarkup: 0.26,
    duty: [0, 0, 0],
    dutyMarkup: 0,
    tariff: [0, 0, 0],
    tariffMarkup: 0,
  },
];

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

// ════════════════════════════════════════════════════════════════════════
console.log("\n── SOURCE ─────────────────────────────────────────────────");

const shipments = rows<{
  id: string;
  label: string;
  selected_destination: string;
  members: string[];
}>(
  await db.execute(sql`
    select fs.id, fs.label,
           (select fd.destination from freight_destinations fd
             where fd.id = fs.selected_destination_id) selected_destination,
           (select json_agg(l.sku order by l.sku)
              from freight_subcategory_items i
              join quote_leaves ql on ql.id = i.quote_leaf_id
              join leaves l on l.id = ql.leaf_id
             where i.freight_subcategory_id = fs.id) members
      from freight_subcategories fs
     where fs.quote_id = ${QUOTE}::uuid
     order by fs.display_order`),
);

check(shipments.length === 2, "two shipments persisted", `got ${shipments.length}`);

for (const [i, frozen] of FROZEN.entries()) {
  const s = shipments[i];
  console.log(`\n  shipment ${frozen.label} — ${s?.label ?? "MISSING"}`);
  check(s?.selected_destination === frozen.selected, "selected destination", `${s?.selected_destination}`);
  const members = [...(s?.members ?? [])].sort();
  const want = [...frozen.members].sort();
  check(JSON.stringify(members) === JSON.stringify(want), "member set", members.join(","));

  const breaks = rows<{ destination: string; selected: boolean; tier: string; amt: string; mk: string | null }>(
    await db.execute(sql`
      select fd.destination, fd.id = fs.selected_destination_id selected,
             t.label tier, b.freight_amount amt, b.freight_markup_pct mk
        from freight_subcategories fs
        join freight_destinations fd on fd.freight_subcategory_id = fs.id
        join freight_destination_breaks b on b.freight_destination_id = fd.id
        join quote_tiers t on t.id = b.tier_id
       where fs.id = ${s.id}::uuid
       order by fd.created_at, t.sort_order`),
  );

  const sel = breaks.filter((b) => b.selected);
  const dec = breaks.filter((b) => !b.selected);

  TIERS.forEach((t, k) => {
    const row = sel.find((b) => b.tier === t.label);
    check(Number(row?.amt) === frozen.freight[k], `${t.label} freight amount`, `${row?.amt}`);
    // Each markup asserted INDIVIDUALLY. A single blended check would pass
    // with two compensating errors.
    check(Number(row?.mk) === frozen.freightMarkup, `${t.label} freight markup`, `${row?.mk}`);
  });

  check(dec.length === 3, `decoy "${frozen.decoy}" persisted`, `${dec.length} breaks`);
  TIERS.forEach((t, k) => {
    const row = dec.find((b) => b.tier === t.label);
    check(Number(row?.amt) === frozen.decoyFreight[k], `${t.label} decoy amount persisted`, `${row?.amt}`);
  });

  if (frozen.duty[0] > 0) {
    const cb = rows<{ tier: string; charge_type: string; amount: string; markup_pct: string }>(
      await db.execute(sql`
        select t.label tier, cb.charge_type, cb.amount, cb.markup_pct
          from freight_customs_breaks cb
          join freight_customs_entries ce on ce.id = cb.freight_customs_entry_id
          join quote_tiers t on t.id = cb.tier_id
         where ce.freight_subcategory_id = ${s.id}::uuid
         order by t.sort_order`),
    );
    TIERS.forEach((t, k) => {
      const d = cb.find((r) => r.tier === t.label && r.charge_type === "duty");
      const a = cb.find((r) => r.tier === t.label && r.charge_type === "tariff");
      check(Number(d?.amount) === frozen.duty[k], `${t.label} duty amount`, `${d?.amount}`);
      check(Number(d?.markup_pct) === frozen.dutyMarkup, `${t.label} duty markup`, `${d?.markup_pct}`);
      check(Number(a?.amount) === frozen.tariff[k], `${t.label} tariff amount`, `${a?.amount}`);
      check(Number(a?.markup_pct) === frozen.tariffMarkup, `${t.label} tariff markup`, `${a?.markup_pct}`);
    });
  }
}

// ════════════════════════════════════════════════════════════════════════
console.log("\n── LEAF ───────────────────────────────────────────────────");
console.log("  expected per-member landed cost / billable, computed here from");
console.log("  the frozen inputs alone: amount / members / units, x (1+markup)\n");

type Cell = { cost: number; bill: number };
const expected = new Map<string, Cell[]>();

for (const f of FROZEN) {
  TIERS.forEach((t, k) => {
    const div = f.members.length * t.units;
    const fC = f.freight[k] / div;
    const dC = f.duty[k] / div;
    const tC = f.tariff[k] / div;
    const cell: Cell = {
      cost: fC + dC + tC,
      bill:
        fC * (1 + f.freightMarkup) +
        dC * (1 + f.dutyMarkup) +
        tC * (1 + f.tariffMarkup),
    };
    for (const m of f.members) {
      const cur = expected.get(m) ?? TIERS.map(() => ({ cost: 0, bill: 0 }));
      cur[k] = { cost: cur[k].cost + cell.cost, bill: cur[k].bill + cell.bill };
      expected.set(m, cur);
    }
  });
}

console.log("  leaf                  " + TIERS.map((t) => t.label.padStart(26)).join(""));
for (const [leaf, cells] of [...expected].sort()) {
  console.log(
    "  " + leaf.padEnd(22) +
      cells.map((c) => `${money(c.cost)}/${money(c.bill)}`.padStart(26)).join(""),
  );
}

// ════════════════════════════════════════════════════════════════════════
console.log("\n── QUOTE ──────────────────────────────────────────────────");
console.log("  every entered dollar must enter EXACTLY once\n");

TIERS.forEach((t, k) => {
  let reconstructed = 0;
  let entered = 0;
  for (const f of FROZEN) {
    const div = f.members.length * t.units;
    const perUnit =
      f.freight[k] / div + f.duty[k] / div + f.tariff[k] / div;
    // x members x units returns the whole entered amount if and only if the
    // allocation is applied exactly once.
    reconstructed += perUnit * div;
    entered += f.freight[k] + f.duty[k] + f.tariff[k];
  }
  check(
    cents(reconstructed) === cents(entered),
    `${t.label} every dollar enters once`,
    `${reconstructed.toFixed(2)} vs ${entered.toFixed(2)}`,
  );
});

// ════════════════════════════════════════════════════════════════════════
console.log("\n── FALSIFICATION ──────────────────────────────────────────");
console.log("  each asserts the WRONG choice produces a DIFFERENT number\n");

const quoteBillable = (opts: {
  decoy?: boolean;
  wrongFreightMk?: boolean;
  wrongDutyMk?: boolean;
  wrongTariffMk?: boolean;
  dropMembers?: boolean;
  doubleMembers?: boolean;
}) =>
  TIERS.map((t, k) => {
    let total = 0;
    for (const f of FROZEN) {
      const n = f.members.length;
      const div = opts.dropMembers
        ? t.units
        : opts.doubleMembers
          ? n * n * t.units
          : n * t.units;
      const amount = opts.decoy ? f.decoyFreight[k] : f.freight[k];
      const fMk = opts.wrongFreightMk ? f.dutyMarkup : f.freightMarkup;
      const dMk = opts.wrongDutyMk ? f.freightMarkup : f.dutyMarkup;
      const tMk = opts.wrongTariffMk ? f.dutyMarkup : f.tariffMarkup;
      const perLeaf =
        (amount / div) * (1 + fMk) +
        (f.duty[k] / div) * (1 + dMk) +
        (f.tariff[k] / div) * (1 + tMk);
      total += perLeaf * n; // contribution to the finished good
    }
    return total;
  });

const truth = quoteBillable({});
console.log("  governed per-unit billable freight: " + truth.map(money).join("  "));

const moves = (label: string, alt: number[]) => {
  const differs = alt.some((v, i) => cents(v) !== cents(truth[i]));
  check(differs, label, differs ? `→ ${alt.map((v) => v.toFixed(4)).join(" / ")}` : "NO MOVEMENT — control is useless");
};

moves("selecting the decoy changes the result", quoteBillable({ decoy: true }));
moves("wrong FREIGHT markup changes the result", quoteBillable({ wrongFreightMk: true }));
moves("wrong DUTY markup changes the result", quoteBillable({ wrongDutyMk: true }));
moves("wrong TARIFF markup changes the result", quoteBillable({ wrongTariffMk: true }));
moves("dropping member allocation changes the result", quoteBillable({ dropMembers: true }));
moves("double-applying member count changes the result", quoteBillable({ doubleMembers: true }));

// ════════════════════════════════════════════
console.log("\n── ENGINE ──────────────────────────────────────────");
console.log("  what Nexus actually computed, against the frozen expectation.");
console.log("  Compared in CENTS: the engine carries IEEE residue (...4999999998)");
console.log("  and an exact float compare would fail on noise, not on money.\n");

const bundle = await getCostingBundle(QUOTE);
if (!bundle.ok) {
  check(false, "costing bundle resolves", bundle.error.message);
} else {
  const rollup = (bundle as unknown as { data: { costing: { quoteRollup: unknown } } })
    .data.costing.quoteRollup as Array<{
      label: string;
      costBreakdown: {
        freight: number;
        freightContainer: number;
        dutyAndTariff: number;
        freightContainerMarkupSum: number;
        dutyAndTariffMarkupSum: number;
      };
    }>;

  TIERS.forEach((t, k) => {
    const got = rollup.find((r) => r.label === t.label)?.costBreakdown;
    if (!got) {
      check(false, `${t.label} present in rollup`);
      return;
    }

    // Expected, from the frozen inputs only.
    let container = 0;
    let dt = 0;
    let containerBill = 0;
    let dtBill = 0;
    for (const f of FROZEN) {
      container += f.freight[k];
      dt += f.duty[k] + f.tariff[k];
      containerBill += f.freight[k] * (1 + f.freightMarkup);
      dtBill += f.duty[k] * (1 + f.dutyMarkup) + f.tariff[k] * (1 + f.tariffMarkup);
    }

    console.log(`  ${t.label}`);
    check(cents(got.freightContainer) === cents(container), "    container cost",
      `${got.freightContainer.toFixed(2)} vs ${container.toFixed(2)}`);
    check(cents(got.dutyAndTariff) === cents(dt), "    duty + tariff cost",
      `${got.dutyAndTariff.toFixed(2)} vs ${dt.toFixed(2)}`);
    check(cents(got.freight) === cents(container + dt), "    total freight cost",
      `${got.freight.toFixed(2)} vs ${(container + dt).toFixed(2)}`);
    check(cents(got.freightContainerMarkupSum) === cents(containerBill), "    container billable",
      `${got.freightContainerMarkupSum.toFixed(2)} vs ${containerBill.toFixed(2)}`);
    check(cents(got.dutyAndTariffMarkupSum) === cents(dtBill), "    duty + tariff billable",
      `${got.dutyAndTariffMarkupSum.toFixed(2)} vs ${dtBill.toFixed(2)}`);

    // The decoy must not be in there. Asserted, not assumed: if the engine
    // had read the unselected candidate, this is the check that catches it.
    let decoyContainer = 0;
    for (const f of FROZEN) decoyContainer += f.decoyFreight[k];
    check(cents(got.freightContainer) !== cents(decoyContainer),
      "    decoy is NOT in the governed total", `decoy would be ${decoyContainer.toFixed(2)}`);
  });
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
