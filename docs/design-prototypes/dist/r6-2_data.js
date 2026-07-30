// R6.2 Freight Panel — REVISION 1 fixtures
// Changes from original 6.2:
// - CBM/unit removed from customs cluster (returns P3 with calculator)
// - Insurance bundled toggle removed (returns P3)
// - transit_lead_weeks replaced by cargo_ready_date + vessel_etd (P1)
// - Multi-leg moves P2 → P1 (active +Add leg)
// - Per-component markup added: freight/duty/tariff (P1, default 0.30, inline pills)
// - crosses_international_border flag drives customs visibility (widened)
// - customer_arranges ready_date renamed cargo_ready_date, promoted to leg head
// - PDF slot rendered P1, upload mechanism P2

window.NXR6_2 = {

  scenarios: {

    // ① DPS-arranges, single-leg DDP (the canonical case, revised)
    dps_arranges: {
      mode: "dps_arranges",
      leg_group: {
        id: "lg_1",
        label: "Outbound · Shenzhen → Lumen & Co. DC (Phoenix)",
        // P1 derived: journey transit = max(vessel_etd) - min(cargo_ready_date)
        journey_transit_weeks: 4.5,
        legs: [
          {
            id: "fr_1",
            direction: "outbound",
            label: "Shenzhen → Long Beach → Phoenix",
            mode: "Ocean FCL",
            carrier: "Sino Logistics",
            incoterm: "DDP",
            origin: "Shenzhen Yantian Port",
            destination: "Phoenix, AZ DC",
            // REVISION: dates replace transit_lead_weeks (P1)
            cargo_ready_date: "2026-06-15",
            vessel_etd: "2026-06-22",
            // REVISION: international border crossing flag (P1)
            crosses_international_border: true,
            // REVISION: per-component markup (P1, default 0.30, overridable)
            freight_markup_pct: 0.30,
            duty_markup_pct: 0.30,
            tariff_markup_pct: 0.30,
            forwarder_quote_pdf: {
              filename: "sino-q3-lumen-2026.pdf",
              uploaded_at: "2026-05-08",
              size_kb: 84,
            },
            // REVISION: cbm_per_unit removed
            customs: {
              duty_pct: 0.058,
              tariff_pct: 0.075,
            },
            treatment: "bundled",
            tiers: [
              { id: "T1", units: 5000,  total_freight: 1820, per_unit: 0.36 },
              { id: "T2", units: 10000, total_freight: 3200, per_unit: 0.32 },
              { id: "T3", units: 25000, total_freight: 6800, per_unit: 0.27 },
              { id: "T4", units: 50000, total_freight: null, per_unit: null },
            ],
          },
        ],
      },
    },

    // ② NEW: Multi-leg journey (P1 now — Shenzhen → Korea → US)
    multi_leg: {
      mode: "dps_arranges",
      leg_group: {
        id: "lg_ml",
        label: "Outbound · Shenzhen → Busan → Long Beach",
        journey_transit_weeks: 5.8,
        legs: [
          {
            id: "fr_ml_1",
            direction: "outbound",
            label: "Shenzhen → Busan",
            mode: "Ocean LCL",
            carrier: "Pacific Forwarders",
            incoterm: "DDP",
            origin: "Shenzhen Yantian Port",
            destination: "Busan, Korea (transshipment)",
            cargo_ready_date: "2026-06-15",
            vessel_etd: "2026-06-22",
            crosses_international_border: true, // Shenzhen → Busan IS a border
            freight_markup_pct: 0.30,
            duty_markup_pct: 0.30,
            tariff_markup_pct: 0.30,
            forwarder_quote_pdf: null,
            customs: { duty_pct: 0.025, tariff_pct: 0.012 }, // Korea duty
            treatment: "bundled",
            tiers: [
              { id: "T1", units: 5000,  total_freight: 720,  per_unit: 0.14 },
              { id: "T2", units: 10000, total_freight: 1280, per_unit: 0.13 },
              { id: "T3", units: 25000, total_freight: 2840, per_unit: 0.11 },
              { id: "T4", units: 50000, total_freight: null, per_unit: null },
            ],
          },
          {
            id: "fr_ml_2",
            direction: "outbound",
            label: "Busan → Long Beach",
            mode: "Ocean FCL",
            carrier: "Sino Logistics",
            incoterm: "DDP",
            origin: "Busan, Korea",
            destination: "Long Beach, CA Port",
            cargo_ready_date: "2026-06-26",
            vessel_etd: "2026-07-04",
            crosses_international_border: true, // Korea → US IS a border
            freight_markup_pct: 0.30,
            duty_markup_pct: 0.30,
            tariff_markup_pct: 0.30, // PM may zero this during anomaly per Cally
            forwarder_quote_pdf: {
              filename: "sino-busan-la-2026.pdf",
              uploaded_at: "2026-05-10",
              size_kb: 92,
            },
            customs: { duty_pct: 0.058, tariff_pct: 0.075 }, // US duty + Section 301
            treatment: "bundled",
            tiers: [
              { id: "T1", units: 5000,  total_freight: 1240, per_unit: 0.25 },
              { id: "T2", units: 10000, total_freight: 2180, per_unit: 0.22 },
              { id: "T3", units: 25000, total_freight: 4620, per_unit: 0.18 },
              { id: "T4", units: 50000, total_freight: null, per_unit: null },
            ],
          },
        ],
      },
    },

    customer_arranges: {
      mode: "customer_arranges",
      leg_group: {
        id: "lg_2",
        label: "Outbound · Customer-arranged pickup",
        journey_transit_weeks: null,
        legs: [
          {
            id: "fr_ca_1",
            direction: "outbound",
            label: "Customer pickup",
            mode: "EXW pickup",
            carrier: null,
            incoterm: "EXW",
            origin: "Marin CM, Pomona CA",
            destination: null,
            // REVISION: cargo_ready_date promoted out of customer_arranges_meta
            cargo_ready_date: "2026-07-22",
            vessel_etd: null,
            crosses_international_border: false,
            freight_markup_pct: 0.30,
            duty_markup_pct: 0.30,
            tariff_markup_pct: 0.30,
            forwarder_quote_pdf: null,
            customs: null,
            // REVISION: ready_date removed from meta (now on leg head)
            customer_arranges_meta: {
              customer_contact: "Beth Yamamoto · logistics@lumenco.com",
              audit_note: "Lumen has 3PL contract with Estes. Pickup window 7am–4pm.",
            },
            treatment: null,
            tiers: [
              { id: "T1", units: 5000,  total_freight: 0, per_unit: 0 },
              { id: "T2", units: 10000, total_freight: 0, per_unit: 0 },
              { id: "T3", units: 25000, total_freight: 0, per_unit: 0 },
            ],
          },
        ],
      },
    },

    empty: { mode: "empty", leg_group: null },
  },

  incoterms: [
    { value: "DDP", label: "DDP", desc: "Delivered Duty Paid" },
    { value: "DAP", label: "DAP", desc: "Delivered At Place" },
    { value: "FOB", label: "FOB", desc: "Free On Board" },
    { value: "EXW", label: "EXW", desc: "Ex Works" },
    { value: "FCA", label: "FCA", desc: "Free Carrier" },
    { value: "CIF", label: "CIF", desc: "Cost Insurance Freight" },
  ],

  modes: [
    "Ocean FCL", "Ocean LCL", "Air freight", "Air express",
    "LTL truck", "Truckload", "Drayage", "EXW pickup", "Other",
  ],

  // Default markup pct — applied per-component, overridable per-leg
  default_markup_pct: 0.30,
};
