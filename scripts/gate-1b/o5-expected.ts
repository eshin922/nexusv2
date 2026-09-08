/**
 * O5 · TRAINING — FULL SPEC REFERENCE · the expectation, frozen BEFORE authoring.
 *
 * ── WHAT O5 IS FOR ──────────────────────────────────────────────────────
 *
 * O1–O4 certified commercial structure: grouped and itemized paths, component-
 * owned charges, mixed structure on one order. None of them carried a
 * specification. O5's subject is SPECIFICATION FIDELITY end to end —
 *
 *     authored -> persisted -> ordered-spec freeze -> customer addendum
 *             -> accepted artifact -> historical readback
 *
 * and, where those specifications reach the NetSuite boundary, that they
 * survive it WITHOUT silently becoming a different authority. A specification
 * is a customer-facing commercial statement; it is not an ERP field, and O5
 * must show that Nexus does not quietly make it one.
 *
 * ── WHY THE VALUES ARE FROZEN HERE ──────────────────────────────────────
 *
 * Same reason O3 and O4 froze their composition hashes before the orders
 * existed: a value read back from the system it was entered into proves only
 * that the system agrees with itself. Every string below is fixed now, so the
 * later certification asserts the persisted, frozen, rendered and historical
 * copies each equal THIS, rather than each other.
 *
 * ── THE SCHEMAS ARE READ, NOT ASSUMED ───────────────────────────────────
 *
 * Every key below was taken from the live `product_types.field_schema` via
 * `loadLeafForSpecEntry`, not extrapolated. That matters most for TP, which
 * had never been rendered before this order — its ten fields are NOT the PP or
 * SP shape with different prefixes, and inferring them would have produced a
 * schema that does not exist.
 *
 * PP and SP declare NO field types at all; TP declares one on every field and
 * is the only schema in the system with a `number`. That asymmetry is itself
 * part of what O5 covers, and is why the control-precedence repair had to land
 * first: before it, `tp_units_per_case` rendered as a text box.
 */

export const O5_LEAVES = {
  PP: {
    leafId: "c34caa17-d3fe-45dd-9276-3b72a3a6fd54",
    sku: "TRN-PP-BOTTLE-30",
    name: "TRAINING · 30 ml Dropper Bottle",
    productTypeId: "leaf_primary_packaging",
    netsuiteInternalId: "76155",
  },
  SP: {
    leafId: "9850276b-bcdc-49e7-a814-4bccfd525e71",
    sku: "TRN-SP-CARTON",
    name: "TRAINING · Unit Carton",
    productTypeId: "leaf_secondary_packaging",
    netsuiteInternalId: "76158",
  },
  TP: {
    leafId: "a40a3c20-c010-4dba-8a36-50858f516775",
    sku: "TRN-TP-SHIPPER",
    name: "TRAINING · Master Shipper",
    productTypeId: "leaf_tertiary_packaging",
    netsuiteInternalId: "76461",
  },
} as const;

/**
 * ── THE THREE INTENTIONAL BLANKS ────────────────────────────────────────
 *
 * `pp_factory_2`, `sp_coating`, `tp_inner_dims` are left EMPTY on purpose,
 * one per schema. Sparseness is a real specification state — a second factory
 * that does not exist, a carton with no coating, a shipper quoted on outer
 * dimensions alone — and the failure it catches is a renderer that treats
 * absent as zero, absent as the placeholder em-dash string, or absent as
 * "inherit the library default".
 *
 * A blank must survive the whole chain AS a blank. It must not reappear later
 * carrying a value nobody entered.
 */
export const O5_INTENTIONAL_BLANKS = ["pp_factory_2", "sp_coating", "tp_inner_dims"] as const;

/**
 * ── THE ONE NUMERIC FIELD ───────────────────────────────────────────────
 *
 * `tp_units_per_case` is the ONLY field declared `"type": "number"` in any
 * live schema. It is certified specifically: the control it renders, the value
 * it persists, and the form that value takes at the freeze and in the addendum.
 *
 * Note what it is NOT: it is not a quantity Nexus computes with. 24 units per
 * case does not divide, multiply or reconcile against anything in the costing
 * path. It is a specification the customer reads. If it ever starts
 * participating in arithmetic, that is a defect, not a feature.
 */
export const O5_NUMERIC_FIELD = "tp_units_per_case" as const;

/**
 * ── COVERAGE THAT IS NOT AVAILABLE, AND IS NOT MANUFACTURED ─────────────
 *
 * O5's scope asked for a multi-value / select specification "if the live
 * schema provides one". Measured against all three live schemas: it does not.
 * Zero fields declare `"type": "select"`, and no schema declares an `options`
 * array. `select` exists in the `LeafSpecField` type union and in
 * `resolveFieldControl`, and is used by nothing.
 *
 * So O5 does not cover it, and no field is invented to make it appear to.
 * The gap is already banked for the post-O5 capability review as
 * "declared-but-unimplemented select specification control".
 */
export const O5_SELECT_COVERAGE = {
  available: false,
  evidence: "no field in leaf_primary_packaging / leaf_secondary_packaging / leaf_tertiary_packaging declares type 'select' or an options array",
} as const;

// ══════════════════════════════════════════════════════════════════════
// PP · TRN-PP-BOTTLE-30 · leaf_primary_packaging · 10 fields, none typed
// ══════════════════════════════════════════════════════════════════════

export const O5_PP_SPEC: Record<string, string> = {
  pp_description:
    "30 ml frosted glass dropper bottle with graduated glass pipette and black phenolic collar. Primary container for the TRAINING full-spec reference order.",
  pp_component_type: "Bottle + dropper assembly",
  pp_quantities: "3,000 / 6,000 / 12,000 per tier",
  pp_size: "30 ml fill · 32 mm dia × 82 mm h · 18/415 neck",
  pp_material: "Type III soda-lime glass, acid-etched frost exterior",
  pp_deco: "1-colour screen print, matte black, front panel only",
  pp_additional_details:
    "Pipette graduated at 0.5 / 1.0 / 1.5 ml. Bulb is black nitrile, EU 10/2011 compliant. Frost finish must match the approved standard under D65; no orange-peel texture on the shoulder.",
  pp_factory_1: "Ningbo Glasswork Co. — bottle and collar",
  pp_factory_2: "", // INTENTIONAL BLANK — no second source for this component
  pp_packout_details:
    "Bulk-packed 96 per inner tray, upright, with corrugated dividers. Trays shrink-wrapped and palletised for delivery to the fill site; no retail-ready packing at this stage.",
};

// ══════════════════════════════════════════════════════════════════════
// SP · TRN-SP-CARTON · leaf_secondary_packaging · 11 fields, none typed
// ══════════════════════════════════════════════════════════════════════

export const O5_SP_SPEC: Record<string, string> = {
  sp_description:
    "Folding unit carton for the 30 ml dropper bottle. Tuck-end construction, printed four colours, sold one bottle per carton.",
  sp_material: "350 gsm SBS folding box board, FSC mix",
  sp_size: "38 × 38 × 92 mm erected · straight tuck end",
  sp_color: "4/0 CMYK, no spot colours",
  sp_coating: "", // INTENTIONAL BLANK — no coating specified on this carton
  sp_finishing: "Soft-touch matte lamination outer, spot UV on the logo mark",
  sp_quantities: "3,000 / 6,000 / 12,000 per tier",
  sp_additional_details:
    "Braille panel required on the top tuck per EU FMD. Carton must accept the bottle without shim; internal tolerance +0.4 mm. Glue flap on the operator's right.",
  sp_factory_1: "Shenzhen Print Partners — printing and die-cut",
  sp_factory_2: "Dongguan Fold & Glue — gluing and finishing",
  sp_packout_details:
    "Delivered flat, 250 per bundle, banded and stacked on edge. Bundles must not be laid flat in transit; crushed tuck flaps are the recurring failure on this format.",
};

// ══════════════════════════════════════════════════════════════════════
// TP · TRN-TP-SHIPPER · leaf_tertiary_packaging · 10 fields, ALL typed
//
// The only schema in the system that declares field types, and the only one
// carrying a `number`. Every value below is chosen so the schema's own
// declaration is visible in the result: the numeric field holds a bare number
// with no unit text, and the textarea holds prose that no single-line control
// could hold.
// ══════════════════════════════════════════════════════════════════════

export const O5_TP_SPEC: Record<string, string> = {
  tp_description:
    "Regular slotted master shipper for finished retail cartons. Double-wall board, plain kraft exterior with one-colour identification print. This is the outermost pack; it is not customer-facing at shelf.",
  tp_type: "RSC master shipper",
  tp_outer_dims: "400 × 300 × 250 mm external",
  tp_inner_dims: "", // INTENTIONAL BLANK — quoted on outer dimensions only
  tp_flute: "BC double wall",
  tp_ect_or_board: "ECT-48 / 275 lb burst equivalent",
  tp_units_per_case: "24", // THE numeric field — a bare number, no unit text
  tp_print: "1-colour flexo, black, two opposing panels",
  tp_closure: "Tape seal, 3-strip H-pattern, 48 mm PP tape",
  tp_pallet_config: "12 cases per layer × 5 layers = 60 cases · 1200 × 1000 mm pallet · stretch-wrapped",
};

/**
 * ── PRESENTATION AXES ───────────────────────────────────────────────────
 *
 * `itemized` is deliberate and is NOT the O3/O4 shape. Under OD-004 it means
 * the order does NOT group — so O5 projects its three leaves as individual
 * NetSuite lines. That keeps the ERP structure simple on the one order whose
 * subject is the specification rather than the structure, and it exercises the
 * itemized projection alongside a spec addendum, which nothing has done yet.
 *
 * `include_addendum` is the whole point: the addendum is where a specification
 * becomes a customer-facing statement. An order that freezes specs but never
 * renders them would certify half the chain.
 */
export const O5_PRESENTATION = {
  detailLevel: "itemized",
  includeSpecAddendum: true,
} as const;

/**
 * ── PROPOSED COMMERCIAL SHAPE ───────────────────────────────────────────
 *
 * Minimal on purpose. O5 is not a structure test, and every commercial feature
 * added here is a thing that can fail for reasons that have nothing to do with
 * specifications. One assembly holding the three specified leaves, three tiers,
 * no component charges, no services, no freight.
 *
 * Tier quantities are divisible by `tp_units_per_case` (125 / 250 / 500 cases),
 * so the specification and the order quantities are mutually coherent — which
 * is what a training corpus is for, even where nothing computes across them.
 *
 * Costs and prices are NOT frozen here. They are entered from the operator
 * surfaces and reported as they fall; if the result is below floor it goes
 * through the normal approval workflow rather than being tuned away.
 */
export const O5_PROPOSED_STRUCTURE = {
  quoteId: "081532d7-89c0-4708-bbd2-160130680009",
  projectId: "788125a4-3f39-40b1-9cce-5f385c51075d",
  assembly: { sku: "TRN-SPEC-UNIT", name: "TRAINING · Full Spec Reference Unit" },
  members: ["TRN-PP-BOTTLE-30", "TRN-SP-CARTON", "TRN-TP-SHIPPER"],
  tierQuantities: [3000, 6000, 12000],
  certificationTier: 6000,
} as const;

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const all = { ...O5_PP_SPEC, ...O5_SP_SPEC, ...O5_TP_SPEC };
  const blanks = Object.entries(all).filter(([, v]) => v === "").map(([k]) => k);
  console.log(`fields frozen : ${Object.keys(all).length} (PP 10 · SP 11 · TP 10)`);
  console.log(`blanks        : ${blanks.join(", ")}`);
  console.log(`numeric       : ${O5_NUMERIC_FIELD} = ${O5_TP_SPEC[O5_NUMERIC_FIELD]}`);
  console.log(`presentation  : detail_level=${O5_PRESENTATION.detailLevel} addendum=${O5_PRESENTATION.includeSpecAddendum}`);
  console.log(`select cover  : ${O5_SELECT_COVERAGE.available ? "yes" : "NOT AVAILABLE — " + O5_SELECT_COVERAGE.evidence}`);
  const expected = [...O5_INTENTIONAL_BLANKS].sort().join(",");
  if (blanks.sort().join(",") !== expected) {
    console.log(`MISMATCH — blanks are not exactly the three declared intentional blanks`);
    process.exit(1);
  }
  console.log("blanks match the declared intentional set exactly");
}

/**
 * ── COMMERCIAL BASELINE · frozen BEFORE any margin is observed ──────────
 *
 * Fixed here so the economics cannot be reverse-engineered from a verdict.
 * Every number below is derived from authorities read live BEFORE the quote
 * had a single cost row:
 *
 *     markup_defaults    Primary 0.4500 · Secondary 0.5000
 *     firm_settings      target 0.3500 · floor 0.2500
 *
 * No global adjustment, no tier adjustment, no per-cell sell override, no
 * manual markup override. Sell is the category default applied to cost and
 * nothing else, which is what makes the resulting margin a PROPERTY of the
 * baseline rather than a number that was aimed at.
 *
 * ── THE CONSEQUENCE, STATED UP FRONT ────────────────────────────────────
 *
 * Every tier lands at ~32.08% — comfortably above the 25% floor, and BELOW
 * the 35% target. The verdict will read BELOW_TARGET, and that is correct
 * rather than a defect to tune away.
 *
 * It is arithmetic, not judgement. A markup of m yields a margin of m/(1+m),
 * so the HIGHEST margin any packaging category default can reach is
 * Secondary's 0.50 -> 33.33%. The 35% target sits above the entire packaging
 * schedule. A pure-packaging quote priced at category defaults CANNOT reach
 * target, and no arrangement of costs changes that — margin here is a function
 * of the markup mix alone, which is also why all three tiers land within
 * 0.003pp of each other despite different costs.
 *
 * Reaching target would require exactly the things this baseline excludes: an
 * adjustment lever, a manual markup, or a sell override. So O5 accepts
 * BELOW_TARGET. It is above floor, it needs no approval (only BELOW_FLOOR
 * gates Send — `quotes.ts:2908`), and the coaching suggestion that surfaces
 * against it is to be left unapplied.
 *
 * ── CATEGORY CHOICE FOR THE MASTER SHIPPER ──────────────────────────────
 *
 * The live schedule has eight categories and NO tertiary one. The shipper
 * takes `Secondary`, which is both the closest live packaging category and
 * consistent with the firm's own fuller vocabulary, where corrugated appears
 * as "Secondary - Corrugated". `Other` (0.30) was rejected: it yields a
 * 23.08% line margin, which would put a cell below floor inside a quote whose
 * blend is fine — a state worth avoiding on an order about specifications.
 *
 * That the live schedule cannot express tertiary packaging is a real
 * observation and is left as one; it is adjacent to the BV-011 vocabulary
 * reconciliation and is not O5's to settle.
 */

export const O5_BASELINE = {
  /**
   * qty_per_sellable_unit is 1 on all three lines. The shipper's cost is
   * entered per SELLABLE UNIT, derived from a per-case price divided by the
   * 24 units the specification says a case holds:
   *
   *     $1.44 / 24 = 0.0600      $1.32 / 24 = 0.0550      $1.20 / 24 = 0.0500
   *
   * The derivation is recorded so the figure is traceable rather than
   * arbitrary. Note that it is a HUMAN use of `tp_units_per_case`: the
   * specification informed a cost the operator entered. Nexus does not read
   * the spec to compute it, and O5 asserts it never starts to.
   */
  lines: [
    { sku: "TRN-PP-BOTTLE-30", category: "Primary", markupPct: 0.45, unitCost: [0.42, 0.39, 0.36] },
    { sku: "TRN-SP-CARTON", category: "Secondary", markupPct: 0.5, unitCost: [0.28, 0.26, 0.24] },
    { sku: "TRN-TP-SHIPPER", category: "Secondary", markupPct: 0.5, unitCost: [0.06, 0.055, 0.05] },
  ],

  /** Derived, not entered: unitCost x (1 + markupPct), exact at 4dp. */
  expectedUnitSell: [
    { sku: "TRN-PP-BOTTLE-30", perTier: [0.609, 0.5655, 0.522] },
    { sku: "TRN-SP-CARTON", perTier: [0.42, 0.39, 0.36] },
    { sku: "TRN-TP-SHIPPER", perTier: [0.09, 0.0825, 0.075] },
  ],

  expectedTiers: [
    { qty: 3000, unitCost: 0.76, unitSell: 1.119, cost: 2280.0, revenue: 3357.0, marginPct: 0.320822 },
    { qty: 6000, unitCost: 0.705, unitSell: 1.038, cost: 4230.0, revenue: 6228.0, marginPct: 0.320809 },
    { qty: 12000, unitCost: 0.65, unitSell: 0.957, cost: 7800.0, revenue: 11484.0, marginPct: 0.320794 },
  ],

  /** The accepted consideration O5 certifies against at the ERP boundary. */
  certificationTier: { qty: 6000, total: 6228.0 },

  expectedVerdict: "BELOW_TARGET",
  requiresApproval: false,
  floorPct: 0.25,
  targetPct: 0.35,

  excluded: [
    "global_price_adj_pct",
    "tier_price_adj_pct",
    "per-cell sell_price_override",
    "manual markup override",
    "component charges",
    "production / service fees",
    "freight",
  ],
} as const;
