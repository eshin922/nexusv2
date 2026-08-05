// Nexus Round 10 — Pricing traceability
// ═══════════════════════════════════════════════════════════════════════════
// THIS FILE IS THE CONTRACT, NOT A FIXTURE.
//
// Every number on the Pricing page is COMPUTED here from inputs, and the trace
// tree is generated from the same computation. There is no second source of
// truth. That is deliberate: R6's fixture hard-coded totals alongside lines
// that didn't sum to them, and a traceability design built on numbers that
// don't reconcile is worse than no traceability at all.
//
// Arithmetic verified against src/lib/costing.ts (CA, Aug 2026):
//
//   required_sell_per_unit = sell_price_override ?? computed_sell_per_unit
//   computed_sell_per_unit = sell_before_adjustment × (1 + A)
//       A = tier_price_adj_pct ?? global_price_adj_pct      (replaces, never stacks)
//   sell_before_adjustment = packaging_sell_sum + production_sell + raw_sell
//                          + Σ container_sell + Σ duty_sell + Σ tariff_sell
//
//   packaging_sell[p] = (unit_cost × qty_per_sellable_unit) × (1 + markup[p])
//       markup[p] = line ?? category default ?? "Other" ?? 0.30
//   production_sell   = production_cost × (1 + Manufacturing_markup)   ← ONE aggregate markup
//   production_cost   = (filling + cm_assembly) ÷ Q
//                     + (allocate ? one_time_service_total ÷ Q : 0)
//   raw_sell          = (customer_ships_raws ? 0 : bulk_raw_cost ÷ Q) × (1 + Raw_markup)
//   duty / tariff     computed on factory_cost_per_unit; markup applies to the DOLLARS
//
// No rounding anywhere in here. Four-decimal rounding happens only at the
// NetSuite boundary, so the trace can always reconcile exactly.
//
// PROVENANCE (CA, Aug 2026): actor + timestamp exist for every commercial
// mutation. Source documents do NOT — only packaging carries a vendor and a
// free-text note. Terminals therefore come in two grades, and the thin one is
// still a complete answer to "who set this". See designer notes §11.1.
//
// SURGICAL LIFT: a fourth lever — one SKU, one tier, corrective toward the firm
// FLOOR. Independently persisted and removable, so it COMPOSES with the global
// and tier adjustments rather than replacing them. An override BLOCKS it.
// ═══════════════════════════════════════════════════════════════════════════

window.NXR10 = (function () {

  const project = {
    client: "Lumen & Co.",
    deal: "Q3 Replenish + Glow Capsule Launch",
    scenario: "Primary",
    quote_number: "DPS-2418",
  };

  const tiers = [
    { id: "t1", label: "T1", qty: 5000 },
    { id: "t2", label: "T2", qty: 10000, recommended: true },
    { id: "t3", label: "T3", qty: 25000 },
    { id: "t4", label: "T4", qty: 50000 },
  ];

  // ─── Firm-level settings (each a terminal human act) ──────
  const firm = {
    markup_defaults: {
      // category → default markup. Note "Shrink" and "Cartons" are absent,
      // which is what exercises the ?? "Other" ?? 0.30 fallback chain.
      Glass:    { pct: 0.30, set_by: "Ray Whitfield", when: "2026-02-11", note: "Firm default, glass primary packaging" },
      Closures: { pct: 0.30, set_by: "Ray Whitfield", when: "2026-02-11", note: "Firm default, closures" },
      Labels:   { pct: 0.35, set_by: "Ray Whitfield", when: "2026-04-02", note: "Raised from 0.32 after Q1 review" },
      Other:    { pct: 0.32, set_by: "Ray Whitfield", when: "2026-02-11", note: "Catch-all default" },
    },
    hard_floor: 0.30,          // final ?? in the resolution chain
    manufacturing_markup: { pct: 0.32, set_by: "Ray Whitfield", when: "2026-02-11", note: "Firm default, CM production" },
    raw_markup:           { pct: 0.25, set_by: "Ray Whitfield", when: "2026-02-11", note: "Firm default, bulk raws" },
    logistics_markup:     { pct: 0.15, set_by: "Dana Or",       when: "2026-03-19", note: "Freight legs" },
    dutytariff_markup:    { pct: 0.10, set_by: "Dana Or",       when: "2026-03-19", note: "Duty & tariff handling" },
    global_price_adj_pct: { pct: 0.025, set_by: "Maya Okafor",  when: "2026-06-30", note: "Quote-wide adjustment, Lumen relationship" },
    target_margin_pct: 0.30,   // classifies only — never changes price
    floor_margin_pct: 0.25,    // classifies only — no automatic enforcement
  };

  // Tier-specific price adjustment. NULL → global is used (replaces, never stacks).
  const tier_price_adj = {
    t1: null,
    t2: null,
    t3: { pct: 0.04, set_by: "Maya Okafor", when: "2026-07-02", note: "T3 uplift agreed with Edward" },
    t4: null,
  };

  // ─── SKU inputs ───────────────────────────────────────────
  // Arrays are indexed by tier. Every value is an operator entry, including
  // one-time fees: they are entered PER TIER explicitly, never derived.
  const skus = [
    {
      id: "s1", code: "GLW-30", name: "Hydra-Glow Vitamin C Serum", pack: "30 ml glass dropper",
      packaging: [
        { id: "p1", name: "Bottle, 30 ml flint glass", category: "Glass",    qty: 1, markup_line: null,
          cost: [0.68, 0.62, 0.56, 0.51],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-04-18", vendor: "Verre Pacific quote VP-8841", note: "MOQ 2,000. Quoted Apr 18." } },
        { id: "p2", name: "Dropper assembly, black", category: "Closures",  qty: 1, markup_line: { pct: 0.34, set_by: "Maya Okafor", when: "2026-06-21", note: "Raised on this line — sole-source component" },
          cost: [0.34, 0.31, 0.28, 0.26],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-04-18", vendor: "Verre Pacific quote VP-8841", note: "Bundled with bottle order." } },
        { id: "p3", name: "Shrink band, tamper-evident", category: "Shrink", qty: 1, markup_line: null,
          cost: [0.07, 0.06, 0.055, 0.05],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-05-02", vendor: "Hangzhou Sunwrap PI-2213", note: "Priced per 1,000." } },
        { id: "p4", name: "Label, front + back set",  category: "Labels",   qty: 1, markup_line: null,
          cost: [0.16, 0.14, 0.125, 0.115],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-05-09", vendor: "Elan Print quote EP-551", note: "8-colour, matte lam." } },
        { id: "p5", name: "Folding carton",            category: "Cartons",  qty: 1, markup_line: null,
          cost: [0.14, 0.12, 0.105, 0.095],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-05-09", vendor: "Elan Print quote EP-551", note: "SBS 18pt." } },
      ],
      production: {
        filling:      { label: "Filling + capping",  cost: [1000, 1800, 4000, 7500],
          origin: { actor: "Production · Sam Idris", when: "2026-05-14", note: "Run totals, not per-unit." } },
        cm_assembly:  { label: "Secondary assembly", cost: [700, 1200, 2700, 5000],
          origin: { actor: "Production · Sam Idris", when: "2026-05-14", note: "Cartoning + banding labour." } },
      },
      one_time: [
        { id: "o1", label: "Line setup",        cost: [800, 800, 1200, 1200],
          origin: { actor: "Production · Sam Idris", when: "2026-05-14", note: "Entered per tier — larger runs need a second changeover." } },
        { id: "o2", label: "Tooling",            cost: [900, 900, 1400, 1400],
          origin: { actor: "Production · Sam Idris", when: "2026-05-20", note: "Second cavity from T3." } },
        { id: "o3", label: "R&D / stability",    cost: [250, 250, 250, 250],
          origin: { actor: "Production · Sam Idris", when: "2026-04-30", note: "Flat across tiers." } },
        { id: "o4", label: "Artwork adaptation", cost: [50, 50, 50, 50],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-05-09", note: "Flat." } },
      ],
      bulk_raw: { total: [1750, 3200, 7500, 14000],
        origin: { actor: "Production · Sam Idris", when: "2026-05-22", note: "Quote-level ingredient roll-up — see Bulk Raw note." } },
      freight: [
        { id: "f1", label: "Ocean · Ningbo → Long Beach", per_unit: [0.19, 0.14, 0.11, 0.09],
          origin: { actor: "Logistics · Dana Or", when: "2026-06-04", note: "LCL at T1, FCL from T2." } },
        { id: "f2", label: "Drayage · port → 3PL",        per_unit: [0.07, 0.05, 0.04, 0.035],
          origin: { actor: "Logistics · Dana Or", when: "2026-06-04", note: "Per-container, spread over units." } },
      ],
      duty_pct:   { pct: 0.045, set_by: "Logistics · Dana Or", when: "2026-06-04", note: "Classified Apr 2026." },
      tariff_pct: { pct: 0.075, set_by: "Logistics · Dana Or", when: "2026-06-11", note: "Subject to review." },
      overrides: {},
    },
    {
      id: "s2", code: "GLW-50", name: "Hydra-Glow Vitamin C Serum", pack: "50 ml glass dropper",
      packaging: [
        { id: "p1", name: "Bottle, 50 ml flint glass", category: "Glass",   qty: 1, markup_line: null,
          cost: [1.02, 0.94, 0.86, 0.79],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-04-18", vendor: "Verre Pacific quote VP-8841", note: "MOQ 2,000." } },
        { id: "p2", name: "Dropper assembly, black",  category: "Closures", qty: 1, markup_line: { pct: 0.34, set_by: "Maya Okafor", when: "2026-06-21", note: "Same sole-source uplift as GLW-30." },
          cost: [0.34, 0.31, 0.28, 0.26],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-04-18", vendor: "Verre Pacific quote VP-8841", note: "Shared component." } },
        { id: "p3", name: "Shrink band, tamper-evident", category: "Shrink", qty: 1, markup_line: null,
          cost: [0.07, 0.06, 0.055, 0.05],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-05-02", vendor: "Hangzhou Sunwrap PI-2213", note: "Priced per 1,000." } },
        { id: "p4", name: "Label, front + back set",  category: "Labels",   qty: 1, markup_line: null,
          cost: [0.18, 0.16, 0.145, 0.13],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-05-09", vendor: "Elan Print quote EP-551", note: "Larger format." } },
        { id: "p5", name: "Folding carton",            category: "Cartons", qty: 1, markup_line: null,
          cost: [0.17, 0.15, 0.13, 0.12],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-05-09", vendor: "Elan Print quote EP-551", note: "SBS 18pt." } },
      ],
      production: {
        filling:     { label: "Filling + capping",  cost: [1200, 2100, 4600, 8600],
          origin: { actor: "Production · Sam Idris", when: "2026-05-14", note: "Run totals." } },
        cm_assembly: { label: "Secondary assembly", cost: [800, 1350, 3000, 5600],
          origin: { actor: "Production · Sam Idris", when: "2026-05-14", note: "Cartoning + banding." } },
      },
      one_time: [
        { id: "o1", label: "Line setup", cost: [800, 800, 1200, 1200],
          origin: { actor: "Production · Sam Idris", when: "2026-05-14", note: "Entered per tier." } },
        { id: "o2", label: "Tooling — custom mould", cost: [3400, 3400, 3400, 3400],
          origin: { actor: "Production · Sam Idris", when: "2026-05-20", note: "Mould ownership transfers at 50k cumulative." } },
        { id: "o3", label: "R&D / stability", cost: [250, 250, 250, 250],
          origin: { actor: "Production · Sam Idris", when: "2026-04-30", note: "Flat." } },
      ],
      bulk_raw: { total: [2600, 4800, 11200, 21000],
        origin: { actor: "Production · Sam Idris", when: "2026-05-22", note: "Quote-level roll-up." } },
      freight: [
        { id: "f1", label: "Ocean · Ningbo → Long Beach", per_unit: [0.26, 0.20, 0.16, 0.13],
          origin: { actor: "Logistics · Dana Or", when: "2026-06-04", note: "Higher CBM per unit." } },
        { id: "f2", label: "Drayage · port → 3PL",        per_unit: [0.09, 0.07, 0.055, 0.048],
          origin: { actor: "Logistics · Dana Or", when: "2026-06-04", note: "Per-container." } },
      ],
      duty_pct:   { pct: 0.045, set_by: "Logistics · Dana Or", when: "2026-06-04", note: "Classified Apr 2026." },
      tariff_pct: { pct: 0.075, set_by: "Logistics · Dana Or", when: "2026-06-11", note: "Subject to review." },
      // The terminal human act. Replaces the whole computed chain at T2.
      overrides: {
        t2: { value: 5.95, actor: "Maya Okafor", when: "2026-07-24 11:40",
              note: "Held at the $5.95 shown in the June deck. Packaging re-quoted lower after that, so the computed price fell — but Beth has already accepted at $5.95, so we hold rather than re-open the number." },
      },
    },
    {
      id: "s3", code: "RPL-200", name: "Replenish Body Lotion", pack: "200 ml HDPE pump",
      packaging: [
        { id: "p1", name: "Bottle, 200 ml HDPE", category: "Rigid", qty: 1, markup_line: null,
          cost: [0.41, 0.37, 0.33, 0.30],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-04-24", vendor: "Ningbo Pack PI-771", note: "No Rigid default exists — falls through to Other." } },
        { id: "p2", name: "Lotion pump, 28/410", category: "Closures", qty: 1, markup_line: null,
          cost: [0.29, 0.26, 0.235, 0.215],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-04-24", vendor: "Ningbo Pack PI-771", note: "Standard neck." } },
        { id: "p3", name: "Label, wrap", category: "Labels", qty: 1, markup_line: null,
          cost: [0.13, 0.115, 0.10, 0.09],
          origin: { actor: "Purchasing · Ana Reyes", when: "2026-05-09", vendor: "Elan Print quote EP-551", note: "BOPP wrap." } },
      ],
      production: {
        filling:     { label: "Filling + capping",  cost: [900, 1550, 3400, 6300],
          origin: { actor: "Production · Sam Idris", when: "2026-05-14", note: "Run totals." } },
        cm_assembly: { label: "Secondary assembly", cost: [500, 850, 1900, 3500],
          origin: { actor: "Production · Sam Idris", when: "2026-05-14", note: "Labelling only." } },
      },
      one_time: [
        { id: "o1", label: "Line setup", cost: [600, 600, 900, 900],
          origin: { actor: "Production · Sam Idris", when: "2026-05-14", note: "Entered per tier." } },
        { id: "o2", label: "R&D / stability", cost: [200, 200, 200, 200],
          origin: { actor: "Production · Sam Idris", when: "2026-04-30", note: "Flat." } },
      ],
      bulk_raw: { total: [2200, 4000, 9200, 17200],
        origin: { actor: "Production · Sam Idris", when: "2026-05-22", note: "Quote-level roll-up." } },
      freight: [
        { id: "f1", label: "Ocean · Ningbo → Long Beach", per_unit: [0.23, 0.18, 0.14, 0.115],
          origin: { actor: "Logistics · Dana Or", when: "2026-06-04", note: "Bulky." } },
        { id: "f2", label: "Drayage · port → 3PL",        per_unit: [0.08, 0.06, 0.05, 0.042],
          origin: { actor: "Logistics · Dana Or", when: "2026-06-04", note: "Per-container." } },
      ],
      duty_pct:   { pct: 0.032, set_by: "Logistics · Dana Or", when: "2026-06-04", note: "Lower rate, body care." },
      tariff_pct: { pct: 0.075, set_by: "Logistics · Dana Or", when: "2026-06-11", note: "Subject to review." },
      overrides: {},
    },
  ];

  // ══ NODE CONSTRUCTOR — the contract in code ══════════════
  // Every node states: what it is (label + value), HOW it got there (op +
  // operands), or — at a leaf — WHO put it there (origin). Never operands alone.
  // Node keys must be DETERMINISTIC. An incrementing counter regenerates keys on
  // every re-render, which silently breaks any open-state keyed by them (R10
  // defect — packaging and freight were the affected level-1 sections).
  function node(o) {
    return {
      key: o.key || (o.kind + "·" + o.label),
      kind: o.kind,                 // sum | markup | allocation | rate | adjustment
                                    // | resolution | origin | override | flagged-out
      label: o.label,
      value: o.value,
      unit: o.unit || "per unit",
      op: o.op || null,             // human-readable arithmetic
      operands: o.operands || [],
      origin: o.origin || null,     // terminal human act
      chosen: o.chosen || null,     // for resolution nodes
      candidates: o.candidates || null,
      superseded: o.superseded || null,
      note: o.note || null,
    };
  }

  const pct = (p) => (p * 100).toFixed(p * 100 % 1 === 0 ? 0 : 1) + "%";
  const m4 = (v) => "$" + v.toFixed(4);

  // Markup resolution: line ?? category default ?? "Other" ?? hard floor.
  // Rendered as a `resolution` node — a CHOICE, not arithmetic — because that
  // is what it is, and because the losing candidates are what make the winner
  // legible.
  function resolveMarkup(line) {
    const cands = [];
    cands.push({
      level: "Line override", available: !!line.markup_line,
      pct: line.markup_line ? line.markup_line.pct : null,
      origin: line.markup_line ? { actor: line.markup_line.set_by, when: line.markup_line.when, note: line.markup_line.note } : null,
    });
    const catDef = firm.markup_defaults[line.category];
    cands.push({
      level: `Category default · ${line.category}`, available: !!catDef,
      pct: catDef ? catDef.pct : null,
      origin: catDef ? { actor: catDef.set_by, when: catDef.when, note: catDef.note } : null,
      absent_note: catDef ? null : `No default is set for "${line.category}".`,
    });
    const other = firm.markup_defaults.Other;
    cands.push({
      level: 'Category default · "Other"', available: !!other, pct: other.pct,
      origin: { actor: other.set_by, when: other.when, note: other.note },
    });
    cands.push({ level: "Firm hard floor", available: true, pct: firm.hard_floor, origin: { actor: "System", when: "—", note: "Final fallback in the resolution chain." } });

    const winner = cands.find(c => c.available && c.pct != null);
    return { pct: winner.pct, candidates: cands, chosen: winner };
  }

  function markupNode(key, label, base, markupPct, chosenMeta) {
    return node({
      key, kind: "markup", label,
      value: base.value * (1 + markupPct),
      op: `${m4(base.value)} cost × (1 + ${pct(markupPct)} markup)`,
      operands: [base, chosenMeta],
    });
  }

  function originNode(key, label, value, origin, unit) {
    return node({ key, kind: "origin", label, value, unit: unit || "per unit", origin });
  }

  // ══ THE COMPUTATION ══════════════════════════════════════
  function compute(sku, ti, flags) {
    const Q = tiers[ti].qty;
    const allocate = flags.allocate_service_fees_to_cost;
    const customerShipsRaws = flags.customer_ships_raws;

    // ── Packaging: per-line markup ─────────────────────────
    const pkgLines = sku.packaging.map(l => {
      const unitCost = l.cost[ti];
      const extCost = unitCost * l.qty;
      const res = resolveMarkup(l);
      const costLeaf = originNode(`${l.id}-cost`, `${l.name} — unit cost`, unitCost, l.origin);
      const base = l.qty === 1 ? costLeaf : node({
        kind: "rate", label: `${l.name} — cost per sellable unit`, value: extCost,
        op: `${m4(unitCost)} × ${l.qty} per sellable unit`, operands: [costLeaf],
      });
      const markupMeta = node({
        kind: "resolution", label: `Markup for ${l.name}`, value: res.pct, unit: "markup",
        op: "line ?? category default ?? \"Other\" ?? firm floor",
        chosen: res.chosen, candidates: res.candidates,
      });
      return { line: l, cost: extCost, sell: extCost * (1 + res.pct), markupPct: res.pct,
               node: markupNode(`${l.id}-sell`, l.name, base, res.pct, markupMeta) };
    });
    const packagingCost = pkgLines.reduce((a, x) => a + x.cost, 0);
    const packagingSell = pkgLines.reduce((a, x) => a + x.sell, 0);
    const packagingNode = node({
      kind: "sum", label: "Packaging", value: packagingSell,
      op: pkgLines.map(x => m4(x.sell)).join("  +  "),
      operands: pkgLines.map(x => x.node),
      note: "Packaging is the only section with per-line markup. Each component resolves its own rate.",
    });

    // ── Production: ONE aggregate markup ───────────────────
    const fill = sku.production.filling.cost[ti];
    const asm = sku.production.cm_assembly.cost[ti];
    const cogsUnit = (fill + asm) / Q;
    const oneTimeTotal = sku.one_time.reduce((a, o) => a + o.cost[ti], 0);
    const allocUnit = allocate ? oneTimeTotal / Q : 0;
    const productionCost = cogsUnit + allocUnit;

    const cogsNode = node({
      kind: "allocation", label: "COGS per unit", value: cogsUnit,
      op: `($${fill.toLocaleString()} filling + $${asm.toLocaleString()} assembly) ÷ ${Q.toLocaleString()} units`,
      operands: [
        originNode("fill", sku.production.filling.label, fill, sku.production.filling.origin, "run total"),
        originNode("asm", sku.production.cm_assembly.label, asm, sku.production.cm_assembly.origin, "run total"),
      ],
    });

    const oneTimeLeaves = sku.one_time.map(o =>
      originNode(`ot-${o.id}`, o.label, o.cost[ti], o.origin, `total at ${tiers[ti].label}`));
    const oneTimeSum = node({
      kind: "sum", label: "One-time services", value: oneTimeTotal, unit: `total at ${tiers[ti].label}`,
      op: sku.one_time.map(o => "$" + o.cost[ti].toLocaleString()).join("  +  "),
      operands: oneTimeLeaves,
      note: "Entered per tier by the operator. The system derives nothing here — the division across tiers is a human statement.",
    });

    const prodCostOperands = [cogsNode];
    if (allocate) {
      prodCostOperands.push(node({
        kind: "allocation", label: "Allocated services per unit", value: allocUnit,
        op: `$${oneTimeTotal.toLocaleString()} one-time ÷ ${Q.toLocaleString()} units`,
        operands: [oneTimeSum],
      }));
    }
    const productionCostNode = node({
      kind: "sum", label: "Production cost per unit", value: productionCost,
      op: allocate ? `${m4(cogsUnit)} COGS  +  ${m4(allocUnit)} allocated services` : `${m4(cogsUnit)} COGS`,
      operands: prodCostOperands,
      note: allocate ? null : "Service-fee allocation is OFF, so one-time fees are not part of the per-unit chain at all — they bill as separate fixed charges.",
    });
    const mfgMarkupNode = node({
      kind: "resolution", label: "Manufacturing markup", value: firm.manufacturing_markup.pct, unit: "markup",
      op: "firm setting — production has no per-line markup",
      chosen: { level: "Firm default · Manufacturing", pct: firm.manufacturing_markup.pct,
                origin: { actor: firm.manufacturing_markup.set_by, when: firm.manufacturing_markup.when, note: firm.manufacturing_markup.note } },
      candidates: null,
    });
    const productionSell = productionCost * (1 + firm.manufacturing_markup.pct);
    const productionNode = markupNode("prod-sell", "Production", productionCostNode, firm.manufacturing_markup.pct, mfgMarkupNode);
    productionNode.note = "One aggregate markup over the whole section — filling, assembly and allocated services are marked up together, not line by line.";

    // ── Bulk raw ───────────────────────────────────────────
    const rawTotal = sku.bulk_raw.total[ti];
    const rawCost = customerShipsRaws ? 0 : rawTotal / Q;
    const rawSell = rawCost * (1 + firm.raw_markup.pct);
    const rawMarkupNode = node({
      kind: "resolution", label: "Raw markup", value: firm.raw_markup.pct, unit: "markup",
      op: "firm setting", chosen: { level: "Firm default · Raws", pct: firm.raw_markup.pct,
        origin: { actor: firm.raw_markup.set_by, when: firm.raw_markup.when, note: firm.raw_markup.note } },
    });
    const rawNode = customerShipsRaws
      ? node({ kind: "flagged-out", label: "Bulk raw", value: 0,
               op: "customer_ships_raws is ON — raws contribute $0.0000 to the per-unit chain",
               note: "The customer supplies raws, so no raw cost enters the price. The ingredient detail still exists in Costs." })
      : markupNode("raw-sell", "Bulk raw", node({
          kind: "allocation", label: "Bulk raw cost per unit", value: rawCost,
          op: `$${rawTotal.toLocaleString()} formula total ÷ ${Q.toLocaleString()} units`,
          operands: [originNode("raw-total", "Formula cost", rawTotal, sku.bulk_raw.origin, `total at ${tiers[ti].label}`)],
          note: "⚠ Provisional. Two Bulk Raw representations exist in the product and are not connected; this chain uses the pricing-active one. Under Business Validation.",
        }), firm.raw_markup.pct, rawMarkupNode);

    // ── Freight legs ───────────────────────────────────────
    const legs = sku.freight.map(f => {
      const c = f.per_unit[ti];
      return { cost: c, sell: c * (1 + firm.logistics_markup.pct),
        node: markupNode(`${f.id}-sell`, f.label, originNode(`${f.id}-cost`, `${f.label} — cost`, c, f.origin),
          firm.logistics_markup.pct,
          node({ kind: "resolution", label: "Logistics markup", value: firm.logistics_markup.pct, unit: "markup",
                 op: "firm setting · per leg",
                 chosen: { level: "Firm default · Logistics", pct: firm.logistics_markup.pct,
                   origin: { actor: firm.logistics_markup.set_by, when: firm.logistics_markup.when, note: firm.logistics_markup.note } } })) };
    });
    const freightCost = legs.reduce((a, l) => a + l.cost, 0);
    const freightSell = legs.reduce((a, l) => a + l.sell, 0);
    const freightNode = node({
      kind: "sum", label: "Freight", value: freightSell,
      op: legs.map(l => m4(l.sell)).join("  +  "), operands: legs.map(l => l.node),
      note: "Each leg carries its own markup.",
    });

    // ── Duty & tariff — computed on FACTORY cost ───────────
    const factoryCost = packagingCost + productionCost + rawCost;
    const factoryNode = node({
      kind: "sum", label: "Factory cost per unit", value: factoryCost,
      op: `${m4(packagingCost)} packaging  +  ${m4(productionCost)} production  +  ${m4(rawCost)} raw`,
      operands: [
        node({ kind: "sum", label: "Packaging cost", value: packagingCost,
               op: pkgLines.map(x => m4(x.cost)).join("  +  "),
               operands: pkgLines.map(x => x.node.operands[0]) }),
        productionCostNode,
      ],
      note: "Duty and tariff are computed on factory cost — packaging + production + raw. Freight is not in the base.",
    });

    const mkRate = (key, label, meta) => {
      const amt = factoryCost * meta.pct;
      const rateNode = node({
        kind: "rate", label: `${label} — cost`, value: amt,
        op: `${m4(factoryCost)} factory cost × ${pct(meta.pct)}`,
        operands: [factoryNode, node({ kind: "origin", label: `${label} rate`, value: meta.pct, unit: "rate",
          origin: { actor: meta.set_by, when: meta.when, doc: meta.doc, note: meta.note } })],
      });
      const dtMarkup = node({ kind: "resolution", label: "Duty & tariff markup", value: firm.dutytariff_markup.pct, unit: "markup",
        op: "firm setting", chosen: { level: "Firm default · Duty & tariff", pct: firm.dutytariff_markup.pct,
          origin: { actor: firm.dutytariff_markup.set_by, when: firm.dutytariff_markup.when, note: firm.dutytariff_markup.note } } });
      const sellNode = markupNode(key, label, rateNode, firm.dutytariff_markup.pct, dtMarkup);
      sellNode.note = "The markup applies to the duty dollars, not to the duty percentage.";
      return { cost: amt, sell: amt * (1 + firm.dutytariff_markup.pct), node: sellNode };
    };
    const duty = mkRate("duty-sell", "Duty", sku.duty_pct);
    const tariff = mkRate("tariff-sell", "Tariff", sku.tariff_pct);

    // ── Sum, then adjustment ───────────────────────────────
    const sections = [packagingNode, productionNode, rawNode, freightNode, duty.node, tariff.node];
    const sellBefore = packagingSell + productionSell + rawSell + freightSell + duty.sell + tariff.sell;
    const sellBeforeNode = node({
      kind: "sum", label: "Sell before adjustment", value: sellBefore,
      op: [packagingSell, productionSell, rawSell, freightSell, duty.sell, tariff.sell].map(m4).join("  +  "),
      operands: sections,
      note: "Every section is already marked up at this point. Markup is applied per section, never once at the top.",
    });

    const tierAdj = tier_price_adj[tiers[ti].id];
    const adjPct = tierAdj ? tierAdj.pct : firm.global_price_adj_pct.pct;
    const adjNode = node({
      kind: "resolution", label: "Price adjustment", value: adjPct, unit: "adjustment",
      op: "tier adjustment ?? global adjustment — replaces, never stacks",
      chosen: tierAdj
        ? { level: `Tier adjustment · ${tiers[ti].label}`, pct: tierAdj.pct,
            origin: { actor: tierAdj.set_by, when: tierAdj.when, note: tierAdj.note } }
        : { level: "Global adjustment", pct: firm.global_price_adj_pct.pct,
            origin: { actor: firm.global_price_adj_pct.set_by, when: firm.global_price_adj_pct.when, note: firm.global_price_adj_pct.note } },
      candidates: [
        { level: `Tier adjustment · ${tiers[ti].label}`, available: !!tierAdj, pct: tierAdj ? tierAdj.pct : null,
          origin: tierAdj ? { actor: tierAdj.set_by, when: tierAdj.when, note: tierAdj.note } : null,
          absent_note: tierAdj ? null : "No tier-specific adjustment is set." },
        { level: "Global adjustment", available: true, pct: firm.global_price_adj_pct.pct,
          origin: { actor: firm.global_price_adj_pct.set_by, when: firm.global_price_adj_pct.when, note: firm.global_price_adj_pct.note } },
      ],
    });

    const computedSell = sellBefore * (1 + adjPct);
    const computedNode = node({
      key: "computed", kind: "adjustment", label: "Computed sell", value: computedSell,
      op: `${m4(sellBefore)} before adjustment × (1 + ${pct(adjPct)})`,
      operands: [sellBeforeNode, adjNode],
    });

    // ── Surgical lift — composes, never replaces ───────────
    // A separate multiplication, not part of the tier ?? global resolution.
    // The two levers answer to different authorities (firm floor vs commercial
    // judgement), so removing one must not disturb the other.
    const cellKey = sku.id + ":" + tiers[ti].id;
    const liftMeta = (flags.lifts || {})[cellKey] || null;
    const ov = sku.overrides[tiers[ti].id];
    const liftPct = liftMeta && !ov ? liftMeta.pct : 0;

    let liftedNode = computedNode;
    if (liftPct) {
      liftedNode = node({
        key: "lifted", kind: "adjustment", label: "Quoted sell",
        value: computedSell * (1 + liftPct),
        op: m4(computedSell) + " computed × (1 + " + pct(liftPct) + " surgical lift)",
        operands: [
          computedNode,
          node({ key: "lift-meta", kind: "origin", label: "Surgical lift", value: liftPct, unit: "adjustment",
                 origin: { actor: liftMeta.actor, when: liftMeta.when, note: liftMeta.note } }),
        ],
        note: "Corrective, toward the firm margin floor. It multiplies the computed price separately from the tier/global adjustment — removing it leaves that adjustment untouched.",
      });
    }

    // ── The override: a human act, NOT an arithmetic node ──
    const root = ov
      ? node({ key: "root", kind: "override", label: "Quoted sell", value: ov.value,
               origin: { actor: ov.actor, when: ov.when, note: ov.note },
               superseded: liftedNode })
      : liftedNode;

    const totalCost = packagingCost + productionCost + rawCost + freightCost + duty.cost + tariff.cost;
    const sell = ov ? ov.value : computedSell * (1 + liftPct);
    return {
      sell, computedSell, overridden: !!ov, lifted: !!liftPct, liftPct, liftMeta, totalCost,
      margin: sell === 0 ? 0 : (sell - totalCost) / sell,
      root, oneTimeTotal, allocate,
    };
  }

  // Minimum lift that clears the firm FLOOR — not the target. The lift is
  // corrective (a mandate); the target is a goal the PM works with the global
  // and tier levers. See designer notes §11.2.
  function liftToFloor(sku, ti, flags) {
    const r = compute(sku, ti, Object.assign({}, flags, { lifts: {} }));
    if (r.overridden) return { blocked: "override", ov: sku.overrides[tiers[ti].id] };
    if (r.margin >= firm.floor_margin_pct) return { needed: false };
    const target = r.totalCost / (1 - firm.floor_margin_pct);
    return { needed: true, pct: target / r.computedSell - 1, from: r.margin, to: firm.floor_margin_pct };
  }

  const marginClass = (m) =>
    m >= firm.target_margin_pct ? "good" : m >= firm.floor_margin_pct ? "below_target" : "below_floor";

  return { project, tiers, firm, tier_price_adj, skus, compute, liftToFloor, marginClass, node, pct, m4 };
})();
