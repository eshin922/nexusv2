/* Nexus — Freight section data
   ═══════════════════════════════════════════════════════════════════════════
   TRANSCRIBED FROM THE REAL DOCUMENTS.
     Get W HOCI Spray - Costing Worksheet.xlsx  tab "7.9.26"  rows 41–68
     HOCI Spray - SF Actual 7.16.26.xlsx        tabs MN / OH / TX

   WHAT THE DOCUMENTS SAY THAT THE BRIEFS DIDN'T
   ─────────────────────────────────────────────
   1. MODE IS PER TIER ROW. Rows 56–58: Domestic LTL at 25K, LTL at 50K,
      **FTL** at 100K — 4 / 7 / 13 pallets. The break changes the shipment.
   2. TRANSIT DAYS ARE PER DESTINATION, constant across breaks.
   3. THE THREE SF TABS ARE ONE SHIPMENT QUOTED THREE WAYS — same commodity,
      same CBM*5.972, same 77 cartons.
   4. THE WORKBOOK ALREADY CARRIES FREIGHT NET OF DUTY. SF's subtotal row is
      the ocean-freight-only figure, and it reconciles to the cent on every tab:
        MN   4,762.54 /  7,595.70 / 12,411.15   (sheet1 row 49 Q / U / W)
        OH   5,195.29 /  8,312.50 / 14,579.00   (sheet2 row 49 T / V)
        TX   8,689.60 / 12,292.00 / 18,276.60   (sheet3 row 55 T / V)
      plus duty & tariff 1,848.36 / 3,500.18 / 6,749.15 — identical on all
      three tabs — giving the worksheet's 6,610.90 / 11,095.88 / 19,160.30.
      So splitting OF from duty/tariff asks her for NO new arithmetic. She
      already has both numbers side by side.                 ← LOAD-BEARING

   THE LEVELS, AND WHY DUTY SITS WHERE IT DOES
   ───────────────────────────────────────────
   Freight varies by destination. Duty and tariff do not — they are a function
   of commodity, HS code and declared value, and all three candidates clear one
   entry at LA port. So duty and tariff are entered ONCE, at the entry, and
   carried onto each destination for display. Cally sees the split on the
   destination row; the fact exists in one place and cannot disagree with
   itself. Lifting it out also makes the comparison honest: the delta between
   candidates is then structurally freight-only.             ← LOAD-BEARING

   Nexus records what the operator determined. It does not determine anything.
   ═══════════════════════════════════════════════════════════════════════════ */
window.NXFREIGHT = (() => {
  const tiers = [
    { id: "t1", label: "T1", qty: 25000 },
    { id: "t2", label: "T2", qty: 50000, recommended: true },
    { id: "t3", label: "T3", qty: 100000 },
  ];

  const skus = [
    { id: "BTL-100", name: "100mL Custom Color PET Bottle + 1c silkscreen" },
    { id: "PMP-4208", name: "DPS4208 24/410 Spray Pump w/ Metal Spring" },
    { id: "HOCI-BULK", name: "Hypochlorous Acid Bulk" },
  ];

  const OCEAN = "Ocean LCL";
  const M20 = () => [0.20, 0.20, 0.20];
  const D233 = [0.20, 0.30, 0.30];

  // ── Subcategory 1 · overseas packaging. Three SF quotations, one shipment.
  const packaging = {
    id: "sc-pack",
    ships: "Get W HOCI Spray — bottles + sprayers",
    origin: "China · Wellpac (bottles) + Maypak (sprayers)",
    forwarder: "Straight Forwarding, Inc.",
    incoterm: "FOB Ningbo",
    cargoReady: "2026-08-22",
    journey: "Outbound · journey 1",
    treatment: "Bundled — amortised across units",
    assigned: ["BTL-100", "PMP-4208"],
    // TRACKING BELONGS TO THE SHIPMENT, AND A SHIPMENT EXISTS ONLY ONCE A
    // DESTINATION IS CHOSEN. A candidate is a price, not a shipment: a Vessel
    // ETA on an endpoint she didn't pick is permanently empty. So there is one
    // tracking strip per subcategory, tied to the selection, instead of three
    // sets of dead date fields.                              ← LOAD-BEARING
    tracking: { etd: "2026-09-12", eta: "2026-10-27", actual: "", forDest: "d-mn" },

    // ENTRY-LEVEL COSTS. Entered once; carried onto every destination.
    // Amounts, not rates — so there is no base to disagree about, and the
    // declared-value-versus-FACTORY_COST mismatch does not arise. The rate
    // path is preserved below for legs Nexus estimates rather than receives.
    customs: {
      source: "invoice",
      invoice: "SF · QT-008101 / 008178 / 008199",
      entry: "LA port · single entry · shared by all three candidates",
      // Declared value of the ASSIGNED SKUs, reconciling to the cent:
      // bottles 4,074.99 + sprayers 1,050.00 = 5,125.00 (worksheet rows 11–12).
      declared: [5125, 9700, 18700],
      // TWO ROWS, NOT THREE. A third "Entry fees" row was designed, argued for,
      // and DECLINED ON BUSINESS GROUNDS — record for a future reader who will
      // otherwise not know it was considered.
      //
      // The argument for three: MPF and harbour maintenance are charges on the
      // ENTRY, not on the goods, so folding them into Duty recreates the same
      // burial — a labelled line containing something its label does not name —
      // that splitting freight from duty had just removed, only at smaller
      // scale ($24.16 of $54.61 at 25K).
      //
      // Cally's call, knowing that cost: "Those are bundled in the OF. If you
      // look at the SF quote there's a bunch of misc costs — don't separate
      // them out." Asked about MPF and HMF as a distinct question: don't
      // separate those either. The burial is acceptable at this scale and the
      // percentages ride in Duty's caption as context.
      //
      // Reconciliation still holds: duty + tariff = 1,848.36 / 3,500.18 /
      // 6,749.15, the same totals SF's own subtotal row carries.
      groups: [
        {
          id: "duty", kind: "duty", label: "Duty",
          detail: "Bottle 7010.90.0540 @ 0% · Sprayer 8424.20.9000 @ 2.9% · incl. MPF 0.3464% + HMF 0.125%",
          amount: [54.61, 105.18, 204.15], markup: M20(),
          rateBase: [1050, 2050, 4000], rate: 0.029,
        },
        {
          id: "tariff", kind: "tariff", label: "Tariff",
          detail: "§301 additional 25% · reciprocal 10%",
          amount: [1793.75, 3395, 6545], markup: M20(),
          rateBase: [5125, 9700, 18700], rate: 0.35,
        },
      ],
    },

    selected: "d-mn",
    reason: "MN lands closest to the filler — Identipak is 18 miles out, so the inland leg consolidates with the shipper run. TX was quoted for the Identipak-direct option the customer later pulled.",
    destinations: [
      {
        id: "d-mn", to: "Edina, MN 55439", consignee: null,
        transit: "42 days", note: "QT-008101",
        cbm: [5.972, 12.5, 24.8],
        modes: [OCEAN, OCEAN, OCEAN],
        notes: ["25K sets · LA port, rail to Minneapolis CFS, local delivery",
                "50K sets · same routing", "100K sets · same routing"],
        totals: [4762.54, 7595.70, 12411.15], markup: M20(), flat: false,
      },
      {
        id: "d-oh", to: "Aurora, OH", consignee: "Natural Essentials",
        transit: "42 days", note: "QT-008178",
        cbm: [5.972, 12.5, 24.8],
        modes: [OCEAN, OCEAN, OCEAN],
        notes: ["25K sets · LA port, rail to OH for final delivery",
                "50K sets · same routing", "100K sets · same routing"],
        totals: [5195.29, 8312.50, 14579.00], markup: M20(), flat: false,
      },
      {
        id: "d-tx", to: "McAllen, TX", consignee: "Identipak",
        transit: "42 days", note: "QT-008199 — Identipak-direct, customer pulled",
        cbm: [5.972, 12.5, 24.8],
        modes: [OCEAN, OCEAN, OCEAN],
        notes: ["25K sets · LA port, truck to TX for final delivery",
                "50K sets · same routing", "100K sets · same routing"],
        totals: [8689.60, 12292.00, 18276.60], markup: M20(), flat: false,
      },
    ],
  };

  // ── Subcategory 2 · domestic bulk raw. No border, so no customs at all.
  const bulkRaw = {
    id: "sc-raw",
    ships: "Hypochlorous Acid Bulk",
    origin: "Whitsett, NC 27377",
    forwarder: "Domestic LTL — carrier per lane",
    incoterm: "FCA Whitsett",
    cargoReady: "2026-11-04",
    journey: "Domestic · journey 1",
    treatment: "Bundled — amortised across units",
    assigned: ["HOCI-BULK"],
    tracking: { etd: "2026-11-06", eta: "", actual: "", forDest: "d-raw-ident" },
    customs: null,
    selected: "d-raw-ident",
    reason: "Identipak does the fill, so the bulk goes to the filler and not the warehouse.",
    destinations: [
      {
        id: "d-raw-ident", to: "Identipak", consignee: "Chaska, MN",
        transit: "3 days", note: "", cbm: null,
        modes: ["Domestic LTL", "Domestic LTL", "Domestic FTL"],
        notes: ["4 pallets", "7 pallets", "13 pallets"],
        totals: [1945, 3072, 5500], markup: D233.slice(), flat: false,
      },
      {
        id: "d-raw-oh", to: "Aurora, OH", consignee: null,
        transit: "2 days", note: "", cbm: null,
        modes: ["Domestic LTL", "Domestic LTL", "Domestic FTL"],
        notes: ["4 pallets", "7 pallets", "13 pallets"],
        totals: [985, 1628, 2370], markup: D233.slice(), flat: false,
      },
    ],
  };

  // ── Subcategory 3 · shippers. One destination "for now" — no apparatus.
  const shippers = {
    id: "sc-ship",
    ships: "Inner packer cartons + master cartons",
    origin: "Minneapolis, MN",
    forwarder: "Domestic LTL — carrier per lane",
    incoterm: "FCA Minneapolis",
    cargoReady: "2026-11-18",
    journey: "Domestic · journey 2",
    treatment: "Bundled — amortised across units",
    tracking: { etd: "", eta: "", actual: "", forDest: "d-ship-oh" },
    assigned: ["BTL-100", "PMP-4208", "HOCI-BULK"],
    customs: null,
    selected: "d-ship-oh",
    reason: "",
    destinations: [
      {
        id: "d-ship-oh", to: "Aurora, OH", consignee: null,
        transit: "2 to 3 days", note: "", cbm: null,
        modes: ["Domestic LTL", "Domestic LTL", "Domestic FTL"],
        notes: ["4,584 inners and 1,147 masters shipping together",
                "9,168 inners and 2,293 masters shipping together",
                "18,334 inners and 4,584 masters shipping together"],
        totals: [431, 594, 985], markup: D233.slice(), flat: false,
      },
    ],
  };

  const turnkey = [packaging, bulkRaw, shippers];

  const simple = [{
    ...packaging, id: "sc-only", selected: "d-mn", reason: "",
    assigned: ["BTL-100", "PMP-4208", "HOCI-BULK"],
    destinations: [packaging.destinations[0]],
  }];

  // Edward's stress case: three components, three destinations each — 27
  // totals. The domestic candidates below are plausible lane rates, not quoted
  // figures; they exist to load the layout, not to be believed.
  const lane = (id, to, consignee, transit, t) => ({
    id, to, consignee, transit, note: "", cbm: null,
    modes: ["Domestic LTL", "Domestic LTL", "Domestic FTL"],
    notes: ["4 pallets", "7 pallets", "13 pallets"],
    totals: t, markup: D233.slice(), flat: false, synthetic: true,
  });
  const stress = [
    packaging,
    { ...bulkRaw, destinations: bulkRaw.destinations.concat([
        lane("d-raw-tx", "McAllen, TX", "Identipak", "4 days", [2380, 3910, 6420]),
      ]) },
    { ...shippers, destinations: shippers.destinations.concat([
        lane("d-ship-mn", "Edina, MN", null, "1 day", [318, 452, 742]),
        lane("d-ship-tx", "McAllen, TX", null, "4 days", [905, 1340, 2180]),
      ]) },
  ];

  // ── Arithmetic only. Nothing here chooses anything.
  const unit = (d, ti) => d.totals[ti] / tiers[ti].qty;
  const sell = (d, ti) => unit(d, ti) * (1 + d.markup[ti]);     // ocean freight only
  const price = (d, ti) => d.totals[ti] * (1 + d.markup[ti]);
  const chosen = sc => sc.destinations.find(x => x.id === sc.selected) || null;

  // One entry-level group: the asserted amount, or rate × its own base.
  const gAmount = (g, ti, source) => source === "invoice" ? g.amount[ti] : g.rateBase[ti] * g.rate;
  const gSell = (g, ti, source) => gAmount(g, ti, source) * (1 + g.markup[ti]);
  const entrySell = (sc, ti) => sc.customs
    ? sc.customs.groups.reduce((a, g) => a + gSell(g, ti, sc.customs.source), 0) / tiers[ti].qty
    : 0;
  const entryAmount = (sc, ti) => sc.customs
    ? sc.customs.groups.reduce((a, g) => a + gAmount(g, ti, sc.customs.source), 0)
    : 0;

  // What a destination contributes per unit: its freight, plus the entry costs
  // carried from the subcategory. Identical carry across candidates, so the
  // delta between them is freight and nothing else.
  const landed = (sc, d, ti) => sell(d, ti) + entrySell(sc, ti);

  // ── The entry sequence ─────────────────────────────────
  // Empty → complete. Read occasionally, performed every time, so this is the
  // part that has to be comfortable. Each step is the real section rendering
  // real state; the caption says what she types on it.
  const dc = o => JSON.parse(JSON.stringify(o));
  const blankDest = (id, to) => ({
    id, to, consignee: null, transit: "", note: "", cbm: null,
    modes: ["", "", ""], notes: ["", "", ""],
    totals: [0, 0, 0], markup: M20(), flat: true,
  });
  const packOnly = (mut) => {
    const p = dc(packaging);
    p.destinations = [blankDest("d-mn", "Edina, MN 55439")];
    p.destinations[0].transit = "42 days";
    p.destinations[0].note = "QT-008101";
    p.destinations[0].cbm = [5.972, 12.5, 24.8];
    p.reason = "";
    p.customs.groups.forEach(g => { g.amount = [0, 0, 0]; });
    if (mut) mut(p);
    return [p];
  };
  const oceanFilled = p => {
    p.destinations[0].modes = [OCEAN, OCEAN, OCEAN];
    p.destinations[0].notes = packaging.destinations[0].notes.slice();
    p.destinations[0].totals = [4762.54, 7595.70, 12411.15];
    p.destinations[0].flat = false;
  };
  const customsFilled = p => {
    p.customs.groups[0].amount = [54.61, 105.18, 204.15];
    p.customs.groups[1].amount = [1793.75, 3395, 6545];
  };

  const sequence = [
    { n: "01", label: "Empty section", modal: false, subs: [],
      note: "Freight has nothing in it. No blank table and no empty leg row — an empty rate table would teach the one-leg shape this whole structure exists to correct. A prompt that names the model, and one button.",
      types: null,
      cost: null },

    { n: "02", label: "What ships", modal: true, subs: [],
      note: "The creation modal. Subcategory facts only — and it asks whether the shipment crosses a border, which is what determines whether a customs entry table exists at all. No rates: those go on the section, where candidates can be read against each other.",
      types: "what ships · Get W HOCI Spray — bottles + sprayers\nfrom · China · Wellpac + Maypak    forwarder · Straight Forwarding, Inc.\nincoterm · FOB Ningbo    cargo ready · 2026-08-22\nfor · BTL-100, PMP-4208    crosses a border · yes\nfirst destination · Edina, MN 55439    transit · 42 days",
      cost: "Three subcategories means three modal round-trips before any number can be typed. That is the sequence's worst moment — the modal's Add carries a secondary 'Add and start another'." },

    { n: "03", label: "Nothing costed", modal: false,
      subs: packOnly(),
      note: "One subcategory, one destination, no costs. Solo layout: no radio, no comparison, no reason row — there is nothing to choose between. The destination's three break cells are empty total-cost fields with markup beside them, and the customs entry table is present and empty because she said yes to the border question.",
      types: null,
      cost: null },

    { n: "04", label: "First figure", modal: false,
      subs: packOnly(p => { p.destinations[0].totals = [4762.54, 4762.54, 4762.54]; p.destinations[0].flat = true; }),
      note: "One value across breaks is ON by default, so the first number she types fills all three and all three sell figures resolve. At 27 totals this is the primary path, not a shortcut — for the domestic legs it is the whole job.",
      types: "T1 total cost · 4762.54   → fills T2 and T3\nmarkup · 20 (default, visible and editable in place)",
      cost: null },

    { n: "05", label: "Breaks differ", modal: false,
      subs: packOnly(oceanFilled),
      note: "Ocean freight does vary by break, so she presses 'differs by break' and types the other two. Order is all three breaks for one destination, then the next — because that is how the source is organised: one SF tab per destination, three volume columns across it.",
      types: "differs by break\nT2 · 7595.70    T3 · 12411.15",
      cost: null },

    { n: "06", label: "Customs entry", modal: false,
      subs: packOnly(p => { oceanFilled(p); customsFilled(p); }),
      note: "Duty and tariff, from the same SF tab, as amounts. Two rows: MPF and harbour maintenance fold into duty — Cally's call, since the SF quote carries a spread of misc charges she does not want itemised. Same row grammar as freight: amount × markup → sell.",
      types: "duty · 54.61 / 105.18 / 204.15\ntariff · 1793.75 / 3395 / 6545",
      cost: null },

    { n: "07", label: "Second destination", modal: false,
      subs: packOnly(p => {
        oceanFilled(p);
        customsFilled(p);
        const oh = dc(packaging.destinations[1]);
        oh.totals = [0, 0, 0]; oh.flat = false; oh.draft = true; oh.inherited = true; oh.note = "";
        p.destinations.push(oh);
        p.selected = "d-mn";
      }),
      note: "'+ another destination' appends a draft row IN PLACE, already expanded, name field focused — never a modal, because a candidate exists to be compared and a modal covers the rows it is compared against. It inherits freight type and markup from the row above; totals arrive empty. This is the moment the subcategory becomes a choice: the radios, the comparison line and the reason row all appear.",
      types: "destination · Aurora, OH    transit · 42 days\nT1 · 5195.29    T2 · 8312.50    T3 · 14579.00",
      cost: "A draft cannot be selected until it has a total — you cannot choose a candidate with no price." },

    { n: "08", label: "Choose + why", modal: false,
      subs: packOnly(p => {
        p.destinations = dc(packaging.destinations);
        p.customs = dc(packaging.customs);
        p.selected = "d-mn";
        p.reason = packaging.reason;
      }),
      note: "Third destination priced, one selected. The comparison line is the system's voice and states the deltas; the reason line is hers and states what the numbers cannot. Duty and tariff are identical across all three, so the delta is structurally ocean freight only.",
      types: "select · Edina, MN\nwhy · MN lands closest to the filler — Identipak is 18 miles out…",
      cost: null },

    { n: "09", label: "Complete", modal: false, subs: turnkey,
      note: "Two more subcategories via '+ what else ships'. Both domestic, so both answer no to the border question and neither gets a customs table. Bulk raw's totals genuinely differ by break; the shippers leg has one destination and stays light — no radio, no comparison, no reason row.",
      types: "bulk raw · 1945 / 3072 / 5500 · markup 20 / 30 / 30\nshippers · 431 / 594 / 985 · markup 20 / 30 / 30",
      cost: "At three subcategories × three destinations the typing is ~15 figures, not 27: one value across breaks covers the domestic lanes, and only the ocean legs need all three. The customs entry adds nine. The length is in the three creation modals, not the grid." },
  ];

  return {
    tiers, skus, turnkey, simple, stress, D233, sequence,
    unit, sell, price, chosen, gAmount, gSell, entrySell, entryAmount, landed,
  };
})();
