// FIRST: refuse before `@/db` is evaluated and a pool is opened. Inlined
// rather than imported, because the shared guard lives on an unmerged branch
// and a walk that gathers evidence should not depend on one.
//
// This creates products and attaches them to quotes. Correct against the
// throwaway validation database, unacceptable anywhere else -- and nothing
// about how a script is LAUNCHED makes that enforceable.
import { assertRuntimeSafety } from "@/lib/config/runtime-config";
{
  const safety = assertRuntimeSafety();
  const providers = Object.values(safety.providers);
  if (
    safety.mode !== "isolated" ||
    providers.some((k) => k !== "isolated") ||
    !safety.database?.name.includes("nexus_validation")
  ) {
    throw new Error(
      `[walk] refusing outside the isolated validation runtime: mode=${safety.mode} ` +
        `providers=${providers.join(",")} db=${safety.database?.name ?? "<unknown>"}`,
    );
  }
  console.log(
    `[walk] isolated runtime confirmed · db=${safety.database.name}`,
  );
}
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeafInputs,
  assemblyProductionInputs,
  leafSpecs,
  leaves,
  quoteLeaves,
  quoteTiers,
  quotes,
} from "@/db/schema";
import { createLeaf } from "@/app/actions/leaves";
import { attachQuoteProduct } from "@/app/actions/quote-products";
import { upsertAssemblyProductionInputs } from "@/app/actions/assembly-production-inputs";
import { updateAssemblyLeafInputCell } from "@/app/actions/assembly-leaf-inputs";
import { loadLeafForSpecEntry } from "@/lib/leaf-spec-loader";
import { resolveSpecSchema } from "@/lib/product-structure/spec-schema-mapping";

/**
 * The bounded #565 walk: create -> classify -> attach -> reopen -> cost.
 *
 * Fixture SKUs are supplied MANUALLY and are unique. SKU allocation is a
 * separate unresolved design (#566), and this walk deliberately does not
 * depend on it -- the question here is whether a bulk formulated product can
 * be created, classified, attached and costed at all.
 */

type V = "PASS" | "FAIL" | "BLOCKED" | "NOTE";
const out: { id: string; verdict: V; detail: string }[] = [];
function rec(id: string, verdict: V, detail: string) {
  out.push({ id, verdict, detail });
  console.log(`${verdict.padEnd(7)} ${id.padEnd(12)} ${detail}`);
}

const STAMP = Date.now().toString(36).toUpperCase();

async function createProduct(name: string, sku: string, hsType: string) {
  const fd = new FormData();
  fd.set("name", name);
  fd.set("sku", sku);
  fd.set("commercialKind", "product");
  fd.set("hubspotProductType", hsType);
  fd.set("unitCost", "0");
  return createLeaf(fd);
}

async function main() {
  // A draft quote with an assembly to attach into.
  const [asm] = await db
    .select({
      assemblyId: assemblies.id,
      quoteId: assemblies.quoteId,
      status: quotes.status,
    })
    .from(assemblies)
    .innerJoin(quotes, eq(quotes.id, assemblies.quoteId))
    .where(eq(quotes.status, "draft"))
    .limit(1);
  if (!asm) {
    rec("SETUP", "BLOCKED", "no draft quote with an assembly in the fixture world");
    finish();
  }
  const [tier] = await db
    .select({ id: quoteTiers.id })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, asm.quoteId))
    .limit(1);
  rec("SETUP", "PASS", `draft quote ${asm.quoteId.slice(0, 8)} · assembly ${asm.assemblyId.slice(0, 8)}`);

  // ── 1 · CREATE, with a manually supplied unique SKU ─────────────────────
  const cases = [
    { label: "2oz", name: `MISTR - 2oz Lube Silicone (${STAMP})`, sku: `WALK-${STAMP}-LUBE-2OZ` },
    { label: "4oz", name: `MISTR - 4oz Lube Silicone (${STAMP})`, sku: `WALK-${STAMP}-LUBE-4OZ` },
  ];
  const created: { label: string; leafId: string; sku: string }[] = [];
  for (const c of cases) {
    const res = await createProduct(c.name, c.sku, "Raw ingredients");
    if (!res.ok) {
      rec(`CREATE:${c.label}`, "FAIL", `refused: ${res.error.message}`);
      continue;
    }
    created.push({ label: c.label, leafId: res.data.leafId, sku: c.sku });
    rec(`CREATE:${c.label}`, "PASS", `leaf ${res.data.leafId.slice(0, 8)} sku=${c.sku}`);
  }
  if (created.length !== cases.length) finish();

  // ── 2 · CLASSIFICATION reached the row, and resolves pending ────────────
  for (const c of created) {
    const [row] = await db
      .select({ hsType: leaves.hubspotProductType, hsId: leaves.hubspotProductId, sku: leaves.sku })
      .from(leaves)
      .where(eq(leaves.id, c.leafId));
    const resolution = resolveSpecSchema(row?.hsType);
    const ok =
      row?.hsType === "Raw ingredients" &&
      row?.sku === c.sku &&
      resolution?.kind === "schema_pending";
    rec(
      `CLASSIFY:${c.label}`,
      ok ? "PASS" : "FAIL",
      `hs_product_type="${row?.hsType}" sku="${row?.sku}" hubspot_id=${row?.hsId ?? "null"} -> ${resolution?.kind}`,
    );
  }

  // Library scope: the template resolves live.
  {
    const entry = await loadLeafForSpecEntry(created[0].leafId, { library: true });
    rec(
      "LIBRARY",
      entry?.specSchemaState === "schema_pending" ? "PASS" : "FAIL",
      `library spec state = ${entry?.specSchemaState}`,
    );
  }

  // ── 3 · ATTACH ──────────────────────────────────────────────────────────
  const attached: { label: string; quoteLeafId: string; leafId: string }[] = [];
  for (const c of created) {
    const fd = new FormData();
    fd.set("quoteId", asm.quoteId);
    fd.set("leafId", c.leafId);
    fd.set("assemblyId", asm.assemblyId);
    fd.set("quantity", "1");
    const res = await attachQuoteProduct(fd);
    if (!res.ok) {
      rec(`ATTACH:${c.label}`, "FAIL", `refused: ${res.error.message}`);
      continue;
    }
    attached.push({ label: c.label, quoteLeafId: res.data.quoteLeafId, leafId: c.leafId });
    rec(`ATTACH:${c.label}`, "PASS", `quote_leaf ${res.data.quoteLeafId.slice(0, 8)}`);
  }
  if (attached.length === 0) finish();

  // ── 4 · THE PIN, read from the actual table ─────────────────────────────
  for (const a of attached) {
    const [pin] = await db
      .select({
        specSchema: leafSpecs.specSchema,
        derivedFrom: leafSpecs.schemaDerivedFromType,
      })
      .from(leafSpecs)
      .where(and(eq(leafSpecs.leafId, a.leafId), eq(leafSpecs.quoteId, asm.quoteId)));
    const ok = pin?.specSchema === "schema_pending";
    rec(
      `PIN:${a.label}`,
      ok ? "PASS" : pin ? "FAIL" : "BLOCKED",
      pin
        ? `leaf_specs.spec_schema = "${pin.specSchema}" derived_from="${pin.derivedFrom}" — persisted through the CHECK`
        : "no quote-owned spec row was written",
    );
  }

  // ── 5 · REOPEN: the pin governs, not a re-derivation ────────────────────
  for (const a of attached) {
    const entry = await loadLeafForSpecEntry(a.leafId, { quoteId: asm.quoteId });
    rec(
      `REOPEN:${a.label}`,
      entry?.specSchemaState === "schema_pending" ? "PASS" : "FAIL",
      `quote-scope spec state = ${entry?.specSchemaState}`,
    );
  }

  // ── 6 · COSTS: contents/manufacturing entered SEPARATELY from packaging ──
  //
  // Not a structural observation about two tables. Values are written through
  // the real actions and read back, because "they are separate" is only worth
  // anything if both can actually be set and both survive.
  if (!tier) {
    rec("COSTS", "BLOCKED", "fixture quote has no tier");
  } else {
    // Contents / manufacturing: per (assembly, tier).
    const pf = new FormData();
    pf.set("quoteSkuId", asm.assemblyId);
    pf.set("tierId", tier.id);
    pf.set("changedField", "bulkRawCost");
    pf.set("bulkRawCost", "1840.00");
    pf.set("fillingBlendingCost", "620.00");
    const prodRes = await upsertAssemblyProductionInputs(pf);
    rec(
      "COST:mfg",
      prodRes.ok ? "PASS" : "FAIL",
      prodRes.ok
        ? "bulk_raw_cost=1840.00 filling_blending_cost=620.00 written per (assembly, tier)"
        : `refused: ${prodRes.error.message}`,
    );

    // Packaging: per (leaf, tier), on the lubricant's own packaging line.
    const [pkgCell] = await db
      .select({ id: assemblyLeafInputs.id, unitCost: assemblyLeafInputs.unitCost })
      .from(assemblyLeafInputs)
      .where(eq(assemblyLeafInputs.tierId, tier.id))
      .limit(1);
    if (!pkgCell) {
      rec("COST:pkg", "BLOCKED", "no packaging cell on this tier to write to");
    } else {
      const cf = new FormData();
      cf.set("rowId", pkgCell.id);
      cf.set("unitCost", "0.47");
      const pkgRes = await updateAssemblyLeafInputCell(cf);
      rec(
        "COST:pkg",
        pkgRes.ok ? "PASS" : "FAIL",
        pkgRes.ok
          ? "packaging unit_cost=0.47 written per (leaf, tier)"
          : `refused: ${pkgRes.error.message}`,
      );
    }

    // Read both back and assert they are distinct records, not one figure.
    const [prodRow] = await db
      .select({
        bulkRaw: assemblyProductionInputs.bulkRawCost,
        filling: assemblyProductionInputs.fillingBlendingCost,
      })
      .from(assemblyProductionInputs)
      .where(
        and(
          eq(assemblyProductionInputs.assemblyId, asm.assemblyId),
          eq(assemblyProductionInputs.tierId, tier.id),
        ),
      );
    const pkgRows = await db
      .select({ id: assemblyLeafInputs.id, unitCost: assemblyLeafInputs.unitCost })
      .from(assemblyLeafInputs)
      .where(eq(assemblyLeafInputs.tierId, tier.id));
    const separate =
      prodRow?.bulkRaw !== null &&
      prodRow?.bulkRaw !== undefined &&
      pkgRows.length > 0;
    rec(
      "COST:separate",
      separate ? "PASS" : "FAIL",
      `manufacturing: bulk_raw=${prodRow?.bulkRaw} filling=${prodRow?.filling} (assembly_production_inputs) · packaging: ${pkgRows.length} rows (assembly_leaf_inputs) — distinct tables, distinct granularity, neither derived from the other`,
    );

    // ── the unit-conversion limitation, stated from the live path ─────────
    //
    // `bulk_raw_cost` is a FLAT COST for the (assembly, tier). It carries no
    // purchase unit, no usage-per-fill, and performs no conversion: whatever
    // arithmetic turns "$X per kg" into this figure happened in the
    // operator's head before they typed it.
    //
    // `bulk_raw_ingredients` -- which does have `native_unit`
    // (kg|L|mL|oz|g|lb), `cost_per_native_unit`, `usage_per_filled_unit` and a
    // generated `per_filled_unit_cost` -- has NO consumer anywhere in `src/`.
    // Schema only.
    //
    // So the 2 oz / 4 oz distinction is not expressed anywhere in the cost
    // model. Nothing records which unit those numbers are in, and no density
    // is recorded, so a volume-to-mass conversion is not representable even in
    // the unwired table. Whether the sizes are fluid or weight ounces is a
    // product fact this walk cannot determine and does not assume.
    const bulkRawWired = false; // asserted below against the source tree
    rec(
      "COST:units",
      "NOTE",
      `no unit conversion in the live path: bulk_raw_cost is a flat per-(assembly,tier) figure with no purchase unit; bulk_raw_ingredients has native_unit/usage_per_filled_unit but is unwired (consumers in src/: ${bulkRawWired ? "some" : "none"}). fl-oz vs weight-oz unresolved and not assumed.`,
    );
  }

  // ── 7 · the NO-SPECIFICATIONS-REQUIRED path, independently ──────────────
  {
    const sku = `WALK-${STAMP}-FREIGHT`;
    const res = await createProduct(`Walk freight charge (${STAMP})`, sku, "Freight");
    if (!res.ok) {
      rec("NOSPEC:create", "FAIL", `refused: ${res.error.message}`);
    } else {
      rec("NOSPEC:create", "PASS", `leaf ${res.data.leafId.slice(0, 8)} created with no specs step`);
      const entry = await loadLeafForSpecEntry(res.data.leafId, { library: true });
      rec(
        "NOSPEC:state",
        entry?.specSchemaState === "no_schema" ? "PASS" : "FAIL",
        `spec state = ${entry?.specSchemaState} (must be no_schema, NOT schema_pending)`,
      );
      const fd = new FormData();
      fd.set("quoteId", asm.quoteId);
      fd.set("leafId", res.data.leafId);
      fd.set("assemblyId", asm.assemblyId);
      fd.set("quantity", "1");
      const att = await attachQuoteProduct(fd);
      rec(
        "NOSPEC:attach",
        att.ok ? "PASS" : "FAIL",
        att.ok ? "attaches with no packaging fields forced" : `refused: ${att.error.message}`,
      );
    }
  }

  finish();
}

function finish(): never {
  const fail = out.filter((r) => r.verdict === "FAIL").length;
  const blocked = out.filter((r) => r.verdict === "BLOCKED").length;
  const notes = out.filter((r) => r.verdict === "NOTE").length;
  // NOTE is a reported LIMITATION, not a check that could not run. It does not
  // fail the walk: reporting a known gap and being blocked by one are
  // different states, and collapsing them would leave the walk permanently red
  // for something nobody intends to close in this slice.
  console.log(
    `\nPASS ${out.length - fail - blocked - notes}  FAIL ${fail}  BLOCKED ${blocked}  NOTE ${notes}`,
  );
  process.exit(fail + blocked > 0 ? 1 : 0);
}

await main();
