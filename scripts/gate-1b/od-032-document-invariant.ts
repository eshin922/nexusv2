/**
 * OD-032 — placement moves value; it does not change what the customer owes.
 *
 * ── THE INVARIANT ───────────────────────────────────────────────────────
 *
 * For every quoted tier:
 *
 *     total consideration with a charge INCLUDED
 *   = total consideration with the same charge SEPARATE
 *
 * `included` puts the recovery inside the unit price; `separate` puts it on an
 * OTC line. Where it sits is a presentation and billing decision. What the
 * customer owes is not.
 *
 * ── WHAT IT WAS BEFORE ──────────────────────────────────────────────────
 *
 * Measured on production 2026-08-28, before the repair: with both charges
 * elected `separate` the engine reported $10,800 of governed recovery and the
 * document's tier totals were BYTE-IDENTICAL to a quote carrying no charges at
 * all. Placement moved the customer's total by the entire amount, silently, in
 * the direction that under-bills.
 *
 * The cause was that the document's OTC construction is shaped around assembly
 * production rows, a fixed fee-column list, and type-level matching — three
 * independent exclusions, none of which a component charge survives.
 *
 * ── WHY THIS RUNS AGAINST THE DATABASE ──────────────────────────────────
 *
 * The invariant is a property of the whole composition: engine, placement,
 * projection and totals together. A unit fixture can assert the projection in
 * isolation and would have passed throughout the period the document was
 * wrong, because the projection was locally correct about the lines it knew
 * about. Only the composed figure disagrees.
 *
 *   usage: npm run gate1b:od-032-document-invariant
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { quoteChargeInstances, quoteTiers, users } from "@/db/schema";
import {
  createComponentChargesAs,
  deleteComponentChargeAs,
} from "@/lib/component-charges/create";
import {
  updateComponentChargeAskAs,
  updateComponentChargeCostAs,
} from "@/lib/component-charges/update";
import { getCostingBundle } from "@/app/actions/costing";
import { projectCommercial } from "@/lib/commercial-projection";
import { projectFrozenInstructions } from "@/lib/commercial-recovery/frozen-instruction";

const results: { name: string; ok: boolean; detail?: string }[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
function refuse(why: string): never {
  console.log(`REFUSED — ${why}`);
  console.log("The proof would be vacuous, so it does not report a pass.");
  process.exit(1);
}
const cents = (n: number) => Math.round(n * 100);

type Shot = {
  totals: number[];
  otcKeys: string[];
  otcInstanceIds: (string | null | undefined)[];
  otcByInstance: Map<string, number[]>;
};

async function shoot(quoteId: string): Promise<Shot> {
  const b = await getCostingBundle(quoteId);
  if (!b.ok) refuse(`bundle failed: ${b.error.message}`);
  const proj = projectCommercial(b.data as never);
  const otc = proj.lines.filter((l) => l.kind === "otc");
  const byInstance = new Map<string, number[]>();
  for (const l of otc) {
    if (!l.chargeInstanceId) continue;
    byInstance.set(
      l.chargeInstanceId,
      l.cells.map((c) => (c.state === "priced" ? c.lineAmount : 0)),
    );
  }
  return {
    totals: proj.tiers.map((t) => t.tierCommercialTotal),
    otcKeys: otc.map((l) => l.key),
    otcInstanceIds: otc.map((l) => l.chargeInstanceId),
    otcByInstance: byInstance,
  };
}

async function place(ids: string[], modes: ("included" | "separate")[]) {
  for (const [i, id] of ids.entries()) {
    await db.execute(sql`
      insert into quote_charge_recovery (quote_id, charge_key, charge_instance_id, mode)
      select qci.quote_id, qci.charge_key, ${id}, ${modes[i]}
        from quote_charge_instances qci where qci.id = ${id}
      on conflict (charge_instance_id) do update set mode = excluded.mode`);
  }
}

async function main() {
  const found = await db.execute(sql`
    select q.id as quote_id,
           (select ql.id from quote_leaves ql where ql.quote_id = q.id limit 1) as leaf,
           (select count(*) from quote_tiers t where t.quote_id = q.id) as tier_n
      from quotes q where q.status = 'draft'`);
  const wanted = process.argv[2];
  const hit = wanted
    ? found.find((r) => r.quote_id === wanted)
    : found.find((r) => r.leaf && Number(r.tier_n) >= 4);
  if (!hit) refuse("no draft quote has a component and at least four tiers");
  const quoteId = hit.quote_id as string;
  const leafId = hit.leaf as string;
  const [operator] = await db.select({ id: users.id }).from(users).limit(1);
  if (!operator) refuse("no user to attribute the write to");

  const pre = await db
    .select({ id: quoteChargeInstances.id })
    .from(quoteChargeInstances)
    .where(
      and(
        eq(quoteChargeInstances.quoteId, quoteId),
        isNotNull(quoteChargeInstances.ownerQuoteLeafId),
      ),
    );
  if (pre.length !== 0) refuse(`subject already carries ${pre.length} component charge(s)`);

  const tiers = await db
    .select({ id: quoteTiers.id, label: quoteTiers.label })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quoteId))
    .orderBy(quoteTiers.sortOrder);

  record(
    "NON-VACUOUS · four tiers, so no tier can stand in for another",
    tiers.length >= 4,
    `${tiers.length} tiers`,
  );
  console.log(`subject quote ${quoteId} · component ${leafId}\n`);

  // ── TWO PRICING AUTHORITIES, TWO CONTRACTS ────────────────────────────
  //
  // A manual sell-price OVERRIDE fixes a cell's unit price, and the ladder's
  // rungs beneath it are discarded — `embeddedRecoveryTotal` returns null there
  // because "there is then no fact of the matter about how much of the
  // operator's price is recovery". An `included` charge on such a cell has
  // nowhere to go, so its recovery is silently dropped while `separate` still
  // bills it.
  //
  // Disposition, Edward 2026-08-28: that is not a defect to repair, it is a
  // DIFFERENT GOVERNED CONTRACT. A manual sell-price override IS the final
  // all-in customer unit price — if the operator enters $4.06, Nexus quotes
  // $4.06 and adds no governed recovery on top. Electing `included` there is a
  // real statement: the operator asserts the charge is inside the price they
  // typed.
  //
  // So `included total === separate total` is not merely inapplicable on such a
  // tier — it is FALSE BY INSTRUCTION, because the operator has stated a
  // different total. Asserting it would be asserting that Nexus overrules the
  // override.
  //
  // These tiers are therefore ASSERTED against their own contract below rather
  // than excluded. An exclusion is a gap in the evidence; a second contract is
  // evidence.
  //
  // NOT "absorbed", and not described as such anywhere: absorbed is a governed
  // treatment of its own — a decision to eat a cost and recover nothing — and
  // the word would describe one decision with another one's name.
  //
  // The override table keys on the JUNCTION id, not the canonical leaf — asked
  // rather than assumed, because the first version of this query used the
  // canonical id, found nothing, and would have reported the exclusion as
  // absent.
  const overriddenRows = await db.execute(sql`
    select o.tier_id, o.sell_price_override
      from assembly_leaf_overrides o
      join assembly_leaves al on al.id = o.assembly_leaf_id
     where al.quote_leaf_id = ${leafId}`);
  const overridden = new Set(overriddenRows.map((r) => String(r.tier_id)));
  const declaredOverrides = new Map(
    overriddenRows.map((r) => [String(r.tier_id), Number(r.sell_price_override)]),
  );
  const applicable = tiers
    .map((t, i) => ({ i, t }))
    .filter(({ t }) => !overridden.has(t.id));
  console.log(
    overridden.size === 0
      ? "  (no sell-price override on this component — every tier is in scope)"
      : `  ${overridden.size} tier(s) price by MANUAL ALL-IN OVERRIDE — asserted below against their own contract, not skipped`,
  );

  const baseline = await shoot(quoteId);
  const made: string[] = [];
  try {
    // ── THE HARD FIXTURE ──────────────────────────────────────────────────
    //
    // One component, TWO same-type charges, four tiers, distinct labels,
    // DIFFERENT costs, and asks that differ per instance — so a collapse to one
    // line, a swap between instances, or a tier fold all produce a wrong number
    // rather than an accidentally right one.
    const plan = [
      { label: "Front panel", costs: ["1450.00", "1400.00", "1350.00", "1300.00"], ask: "1900.00" },
      { label: "Back panel", costs: ["600.00", "600.00", "600.00", "600.00"], ask: "800.00" },
    ];
    for (const p of plan) {
      const c = await createComponentChargesAs(operator.id, {
        quoteId,
        quoteLeafId: leafId,
        charges: [{ chargeKey: "print_plates", label: p.label }],
      });
      if (!c.ok) refuse(`could not author the fixture: ${c.error.message}`);
      const id = c.data.created[0].chargeInstanceId;
      made.push(id);
      for (let i = 0; i < tiers.length; i++) {
        await updateComponentChargeCostAs(operator.id, {
          quoteId, chargeInstanceId: id, tierId: tiers[i].id, cost: p.costs[i],
        });
        await updateComponentChargeAskAs(operator.id, {
          quoteId, chargeInstanceId: id, tierId: tiers[i].id, ask: p.ask,
        });
      }
    }
    const [A, B] = made;
    console.log(`fixture: A=${A.slice(0, 8)} "Front panel"  B=${B.slice(0, 8)} "Back panel"\n`);

    // ── 1 · BOTH INCLUDED ─────────────────────────────────────────────────
    await place(made, ["included", "included"]);
    const inc = await shoot(quoteId);
    record(
      "BOTH INCLUDED · no OTC line is emitted for either",
      inc.otcByInstance.size === 0,
      `${inc.otcByInstance.size} component OTC line(s) — an included charge is already in the unit price`,
    );
    record(
      "BOTH INCLUDED · the totals moved off baseline",
      inc.totals.some((v, i) => cents(v) !== cents(baseline.totals[i])),
      `${baseline.totals.map((v) => v.toFixed(2)).join(" / ")}  →  ${inc.totals.map((v) => v.toFixed(2)).join(" / ")}`,
    );

    // ── 2 · BOTH SEPARATE ─────────────────────────────────────────────────
    await place(made, ["separate", "separate"]);
    const sep = await shoot(quoteId);
    record(
      "BOTH SEPARATE · TWO distinct OTC lines, one per instance",
      sep.otcByInstance.size === 2 && new Set(sep.otcInstanceIds.filter(Boolean)).size === 2,
      `keys: ${sep.otcKeys.filter((k) => k.startsWith("otc:instance:")).join(", ")}`,
    );
    record(
      "BOTH SEPARATE · keyed by INSTANCE, not by column or type",
      sep.otcKeys.filter((k) => k === `otc:instance:${A}` || k === `otc:instance:${B}`).length === 2,
      "no .find(chargeKey) collapse could produce two",
    );

    // ── THE INVARIANT ─────────────────────────────────────────────────────
    const drift = applicable
      .map(({ i, t }) => ({ tier: t.label, inc: inc.totals[i], sep: sep.totals[i] }))
      .filter((d) => cents(d.inc) !== cents(d.sep));
    record(
      "INVARIANT · per tier, INCLUDED total === SEPARATE total",
      drift.length === 0 && applicable.length > 0,
      drift.length === 0
        ? `${applicable.length} computed-price tier(s): ${applicable.map(({ i }) => inc.totals[i].toFixed(2)).join(" / ")}`
        : drift.map((d) => `${d.tier}: ${d.inc.toFixed(2)} vs ${d.sep.toFixed(2)}`).join("; "),
    );

    // ── THE MANUAL ALL-IN CONTRACT, ASSERTED ──────────────────────────
    const overriddenTiers = tiers
      .map((t, i) => ({ i, t }))
      .filter(({ t }) => overridden.has(t.id));

    if (overriddenTiers.length > 0) {
      const b = await getCostingBundle(quoteId);
      if (!b.ok) refuse("bundle failed on the override contract");
      const skus = (b.data.skus ?? []) as { id: string; skuRole?: string }[];
      const isLeaf = (x: string) => skus.some((k) => k.id === x && k.skuRole === "leaf");

      // `included` is in force here — this block runs while both charges are
      // elected separate, so re-elect before measuring the included contract.
      await place(made, ["included", "included"]);
      const bInc = await getCostingBundle(quoteId);
      if (!bInc.ok) refuse("bundle failed on the override contract");
      const fi = projectFrozenInstructions(bInc.data.costing, isLeaf);
      const incShot = await shoot(quoteId);

      for (const { i, t } of overriddenTiers) {
        const declared = declaredOverrides.get(t.id) ?? null;
        const cell = (bInc.data.costing.skuRollups ?? [])
          .find((r) => r.skuId === leafId)
          ?.perTier?.find((pt) => pt.tierId === t.id) as unknown as
          | { requiredSellPerUnit: number; embeddedRecoveryTotal: number | null }
          | undefined;

        record(
          `OVERRIDE · ${t.label} quotes the operator's number EXACTLY`,
          declared !== null && cell !== undefined &&
            cents(cell.requiredSellPerUnit) === cents(declared),
          `override ${declared} · quoted ${cell?.requiredSellPerUnit}`,
        );
        record(
          `OVERRIDE · ${t.label} the engine declines to say what is embedded`,
          cell?.embeddedRecoveryTotal === null,
          `embeddedRecoveryTotal=${cell?.embeddedRecoveryTotal}`,
        );
        record(
          `OVERRIDE · ${t.label} an included charge emits NO separate line`,
          [...incShot.otcByInstance.values()].every((cellsArr) => cents(cellsArr[i]) === 0),
          "the charge is inside the operator's price, not beside it",
        );

        const mine = fi.filter((x) => x.chargeInstanceId && x.tierId === t.id);
        record(
          `OVERRIDE · ${t.label} the freeze keeps identity, treatment and COST`,
          mine.length === 2 &&
            mine.every((x) => x.treatment === "unit_price" && x.cost > 0) &&
            new Set(mine.map((x) => x.chargeInstanceId)).size === 2,
          mine.map((x) => `${x.chargeInstanceId?.slice(0, 8)} ${x.treatment} cost=${x.cost}`).join(" | "),
        );
        record(
          `OVERRIDE · ${t.label} the freeze asserts NO recovery precision`,
          mine.length > 0 &&
            mine.every((x) => x.governedRecovery === null && x.amortizedPerUnit === null),
          mine.map((x) => `rec=${x.governedRecovery} amort=${x.amortizedPerUnit}`).join(" | "),
        );
        record(
          `OVERRIDE · ${t.label} the condition is RECORDED, not inferred`,
          mine.every((x) => x.manualAllInSell === true),
          "manualAllInSell on every frozen row for this tier",
        );
      }

      // A computed tier must be untouched by all of this — the narrowing is
      // conditional on pricing authority, not applied everywhere.
      const computed = fi.filter(
        (x) => x.chargeInstanceId && !overridden.has(x.tierId) && x.treatment === "unit_price",
      );
      record(
        "CONTROL · on COMPUTED tiers the freeze still states the recovery",
        computed.length > 0 &&
          computed.every((x) => x.governedRecovery !== null && x.manualAllInSell === false),
        `${computed.length} row(s), e.g. rec=${computed[0]?.governedRecovery} amort=${computed[0]?.amortizedPerUnit}`,
      );

      await place(made, ["separate", "separate"]);
    }

    // ── 3 · MIXED, BOTH WAYS ──────────────────────────────────────────────
    await place(made, ["included", "separate"]);
    const mixAB = await shoot(quoteId);
    await place(made, ["separate", "included"]);
    const mixBA = await shoot(quoteId);

    record(
      "A included / B separate · exactly ONE OTC line, and it is B",
      mixAB.otcByInstance.size === 1 && mixAB.otcByInstance.has(B),
      `lines for: ${[...mixAB.otcByInstance.keys()].map((k) => k.slice(0, 8)).join(", ") || "none"}`,
    );
    record(
      "A separate / B included · exactly ONE OTC line, and it is A",
      mixBA.otcByInstance.size === 1 && mixBA.otcByInstance.has(A),
      `lines for: ${[...mixBA.otcByInstance.keys()].map((k) => k.slice(0, 8)).join(", ") || "none"}`,
    );
    for (const [tag, shot] of [["A inc / B sep", mixAB], ["A sep / B inc", mixBA]] as const) {
      const bad = applicable.filter(({ i }) => cents(inc.totals[i]) !== cents(shot.totals[i]));
      record(
        `INVARIANT · ${tag} total equals the all-included total, per tier`,
        bad.length === 0,
        applicable.map(({ i }) => shot.totals[i].toFixed(2)).join(" / "),
      );
    }

    // ── 4 · MOVING ONE DOES NOT MOVE THE OTHER ────────────────────────────
    //
    // B is separate in both states; A moves between them. B's own line must be
    // identical, tier for tier — a shared or type-keyed line would drift.
    const bInBoth = sep.otcByInstance.get(B);
    const bWhenAIncluded = mixAB.otcByInstance.get(B);
    record(
      "MOVING A LEAVES B UNCHANGED · B's line is identical tier for tier",
      !!bInBoth && !!bWhenAIncluded &&
        bInBoth.length === bWhenAIncluded.length &&
        bInBoth.every((v, i) => cents(v) === cents(bWhenAIncluded[i])),
      `${bInBoth?.map((v) => v.toFixed(2)).join("/")}  vs  ${bWhenAIncluded?.map((v) => v.toFixed(2)).join("/")}`,
    );

    // ── 5 · TIERS ARE NOT SUMMED ──────────────────────────────────────────
    //
    // A's costs differ per tier and its ask does not, so its line is flat while
    // its cost is not — the shape where a fold would show. Each tier's line
    // must equal that tier's own governed recovery, never a sum of the four.
    const aLine = sep.otcByInstance.get(A) ?? [];
    record(
      "NO TIER IS SUMMED INTO ANOTHER · each cell is its own tier's amount",
      aLine.length === tiers.length && aLine.every((v) => cents(v) === cents(1900)),
      `A per tier: ${aLine.map((v) => v.toFixed(2)).join(" / ")} (each must be 1900.00, never 7600.00)`,
    );

    // ── 6 · LEGACY CONTROL ────────────────────────────────────────────────
    const legacyBefore = baseline.otcKeys.filter((k) => !k.startsWith("otc:instance:"));
    const legacyAfter = sep.otcKeys.filter((k) => !k.startsWith("otc:instance:"));
    record(
      "LEGACY CONTROL · column-shaped OTC lines are untouched",
      legacyBefore.length === legacyAfter.length &&
        legacyBefore.every((k, i) => k === legacyAfter[i]),
      `${legacyBefore.join(", ") || "none"}`,
    );
    record(
      "LEGACY CONTROL · legacy lines carry no instance id",
      sep.otcKeys.every((k, i) =>
        k.startsWith("otc:instance:") ? !!sep.otcInstanceIds[i] : !sep.otcInstanceIds[i],
      ),
      "identity is present exactly where there is an instance",
    );

    // ── 7 · THE FREEZE AGREES ─────────────────────────────────────────────
    const b = await getCostingBundle(quoteId);
    if (!b.ok) refuse("bundle failed on the freeze check");
    const frozenSeparate = new Set<string>();
    for (const r of b.data.costing.skuRollups ?? []) {
      for (const pt of r.perTier ?? []) {
        for (const c of pt.constructed?.charges ?? []) {
          if (c.chargeInstanceId && c.placement === "separate_line") {
            frozenSeparate.add(c.chargeInstanceId);
          }
        }
      }
    }
    const documented = new Set(mixBA.otcByInstance.keys());
    record(
      "FROZEN IDENTITY AGREES · the instances billed separately are the ones documented",
      frozenSeparate.size === documented.size &&
        [...frozenSeparate].every((id) => documented.has(id)),
      `construction: ${[...frozenSeparate].map((s) => s.slice(0, 8)).join(", ")} | document: ${[...documented].map((s) => s.slice(0, 8)).join(", ")}`,
    );
  } finally {
    for (const id of made) {
      await deleteComponentChargeAs(operator.id, { quoteId, chargeInstanceId: id });
    }
    const left = await db
      .select({ id: quoteChargeInstances.id })
      .from(quoteChargeInstances)
      .where(isNotNull(quoteChargeInstances.ownerQuoteLeafId));
    record(
      "RESIDUE · POPULATION-WIDE, and verified by re-reading",
      left.length === 0,
      `${left.length} component charge(s) remain anywhere`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length}/${results.length}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
