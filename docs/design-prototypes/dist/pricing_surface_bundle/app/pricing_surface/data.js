/* global window */
// ─────────────────────────────────────────────────────────────────────
// Pricing-surface scenarios — 11 fixtures across 6 clusters.
// Every scenario is fed through PSR.classify; no fixture hand-codes the
// state-line / mode / actions. Fixtures only express the data shape;
// the classifier produces every readout.
// ─────────────────────────────────────────────────────────────────────

window.PSR = window.PSR || {};

const POLICY = {
  target_margin_pct: 0.45,
  floor_margin_pct:  0.30,
  allow_override:    true,
};

// ── Fixture helpers ─────────────────────────────────────────────────
function tiers(qtys) {
  return qtys.map((q, i) => ({ id: i + 1, qty: q, label: "Tier " + (i + 1) }));
}
function cell(margin, sell, opts = {}) {
  const cost_unit = sell != null && margin != null ? sell * (1 - margin) : null;
  return {
    margin_pct: margin,
    sell_unit: sell,
    cost_unit,
    cost_stack: opts.cost_stack ?? { pkg: cost_unit ? cost_unit * 0.20 : 0,
                                     prod: cost_unit ? cost_unit * 0.55 : 0,
                                     frt:  cost_unit ? cost_unit * 0.15 : 0,
                                     dt:   cost_unit ? cost_unit * 0.10 : 0 },
    override_applied: opts.override ?? false,
    missing: opts.missing ?? false,
  };
}
function missingCell() {
  return { margin_pct: null, sell_unit: null, cost_unit: null, cost_stack: null,
           override_applied: false, missing: true };
}

// ─────────────────────────────────────────────────────────────────────
// SCENARIOS
// ─────────────────────────────────────────────────────────────────────

PSR.scenarios = {

  // ── Cluster A · Sendable ──────────────────────────────────────────

  s01_sendable_vanilla: {
    label: "① Sendable · vanilla",
    cluster: "A · Sendable",
    cluster_label: "Sendable (80% case)",
    blurb: "All five tiers above target. Page reads as a single state line + summary card + collapsed detail. Reinforces the thesis: page is almost empty when the quote is fine.",
    quote: {
      qid: "Q-2026-0411",
      client: "Brookfield Lifestyle Co.",
      blended_margin_pct: 0.471,
      recommended_tier_id: 2,
      policy: POLICY,
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Cotton tote · natural", client_target_unit: 14.20, cells: {
          1: cell(0.46, 9.10), 2: cell(0.47, 8.85), 3: cell(0.48, 8.55), 4: cell(0.50, 8.10), 5: cell(0.52, 7.65) } },
        { id: "S2", name: "Hardcover notebook", client_target_unit: 22.50, cells: {
          1: cell(0.45, 16.20), 2: cell(0.46, 15.80), 3: cell(0.47, 15.30), 4: cell(0.49, 14.50), 5: cell(0.51, 13.80) } },
        { id: "S3", name: "Bamboo pen set", client_target_unit: 8.90, cells: {
          1: cell(0.46, 5.85), 2: cell(0.47, 5.65), 3: cell(0.48, 5.45), 4: cell(0.49, 5.15), 5: cell(0.51, 4.85) } },
        { id: "S4", name: "Ceramic mug · branded", client_target_unit: 11.80, cells: {
          1: cell(0.48, 7.40), 2: cell(0.49, 7.20), 3: cell(0.50, 6.95), 4: cell(0.51, 6.55), 5: cell(0.53, 6.10) } },
        { id: "S5", name: "Drawstring backpack", client_target_unit: 17.50, cells: {
          1: cell(0.47, 12.10), 2: cell(0.48, 11.75), 3: cell(0.49, 11.30), 4: cell(0.50, 10.65), 5: cell(0.52, 9.95) } },
      ],
    },
  },

  s02_sendable_headroom: {
    label: "② Sendable · with headroom",
    cluster: "A · Sendable",
    cluster_label: "Sendable (80% case)",
    blurb: "Above target with comfortable headroom across all tiers. Same minimal layout — no headroom callout in primary attention. Diagnostic context surfaces in DETAIL when expanded.",
    quote: {
      qid: "Q-2026-0418",
      client: "Northshore Outfitters",
      blended_margin_pct: 0.532,
      recommended_tier_id: 3,
      policy: POLICY,
      tiers: tiers([250, 500, 1000, 2500, 5000]),
      skus: [
        { id: "S1", name: "Performance polo · embroidered", client_target_unit: 28.40, cells: {
          1: cell(0.52, 18.80), 2: cell(0.53, 18.20), 3: cell(0.54, 17.40), 4: cell(0.56, 16.30), 5: cell(0.58, 15.10) } },
        { id: "S2", name: "Insulated water bottle 24oz", client_target_unit: 16.50, cells: {
          1: cell(0.51, 11.70), 2: cell(0.52, 11.35), 3: cell(0.53, 10.85), 4: cell(0.55, 10.10), 5: cell(0.57, 9.30) } },
        { id: "S3", name: "Embroidered cap · structured", client_target_unit: 14.80, cells: {
          1: cell(0.53, 10.20), 2: cell(0.54, 9.85), 3: cell(0.55, 9.40), 4: cell(0.57, 8.80), 5: cell(0.59, 8.10) } },
      ],
    },
  },

  s03_sendable_2tier: {
    label: "③ Sendable · 2-tier quote",
    cluster: "A · Sendable",
    cluster_label: "Sendable (80% case)",
    blurb: "Narrowest-credible quote (2 tiers, 2 SKUs). Proves the one-line state + summary-card shape holds at low data density — page doesn't feel emptier than the 5-tier case.",
    quote: {
      qid: "Q-2026-0422",
      client: "Park & Vine Co-op",
      blended_margin_pct: 0.488,
      recommended_tier_id: 1,
      policy: POLICY,
      tiers: tiers([50, 150]),
      skus: [
        { id: "S1", name: "Organic cotton tee · printed", client_target_unit: 19.50, cells: {
          1: cell(0.47, 13.20), 2: cell(0.49, 12.45) } },
        { id: "S2", name: "Canvas market tote", client_target_unit: 12.80, cells: {
          1: cell(0.48, 8.70), 2: cell(0.51, 8.10) } },
      ],
    },
  },

  // ── Cluster B · Suggestion-led ────────────────────────────────────

  s04_suggestion_surgical: {
    label: "④ Suggestion-led · Surgical",
    cluster: "B · Suggestion-led",
    cluster_label: "Suggestion-led (page grows)",
    blurb: "One tier (T1) below target, others fine. Surgical wins because it's exactly one tier — Global would compound. Page grows: state callout + ranked ACTION + collapsed DETAIL.",
    quote: {
      qid: "Q-2026-0429",
      client: "Cedar & Co.",
      blended_margin_pct: 0.421,
      recommended_tier_id: 3,
      policy: POLICY,
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Heritage leather journal", client_target_unit: 42.00, cells: {
          1: cell(0.38, 30.20), 2: cell(0.45, 27.80), 3: cell(0.47, 26.50), 4: cell(0.49, 25.10), 5: cell(0.52, 23.40) } },
        { id: "S2", name: "Brass desk organizer", client_target_unit: 28.50, cells: {
          1: cell(0.39, 21.40), 2: cell(0.46, 19.50), 3: cell(0.47, 18.70), 4: cell(0.49, 17.80), 5: cell(0.51, 16.80) } },
        { id: "S3", name: "Felt laptop sleeve · custom", client_target_unit: 22.40, cells: {
          1: cell(0.40, 16.20), 2: cell(0.45, 15.10), 3: cell(0.46, 14.50), 4: cell(0.48, 13.80), 5: cell(0.50, 12.95) } },
      ],
      suggestions: {
        surgical: { tier_id: 1, lift_pct: 0.12, new_margin: 0.46 },
      },
    },
  },

  s05_suggestion_global: {
    label: "⑤ Suggestion-led · Global",
    cluster: "B · Suggestion-led",
    cluster_label: "Suggestion-led (page grows)",
    blurb: "Three tiers (T1, T2, T3) below target. Global wins because surgical would compound (lifting three tiers separately distorts the volume curve). Ranking is mode-aware.",
    quote: {
      qid: "Q-2026-0501",
      client: "Vellum Hospitality Group",
      blended_margin_pct: 0.418,
      recommended_tier_id: 4,
      policy: POLICY,
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Logo-embossed leather coaster set", client_target_unit: 34.00, cells: {
          1: cell(0.39, 24.50), 2: cell(0.41, 23.40), 3: cell(0.43, 22.20), 4: cell(0.47, 20.50), 5: cell(0.51, 18.80) } },
        { id: "S2", name: "Welcome amenity bottle · 200ml", client_target_unit: 8.90, cells: {
          1: cell(0.40, 6.20), 2: cell(0.42, 5.95), 3: cell(0.44, 5.65), 4: cell(0.48, 5.20), 5: cell(0.52, 4.70) } },
        { id: "S3", name: "Linen napkin set · monogram", client_target_unit: 18.50, cells: {
          1: cell(0.41, 13.20), 2: cell(0.43, 12.60), 3: cell(0.44, 12.10), 4: cell(0.47, 11.40), 5: cell(0.51, 10.50) } },
      ],
      suggestions: {
        global: { lift_pct: 0.08, new_blended: 0.476 },
      },
    },
  },

  // ── Cluster C · Blocked ───────────────────────────────────────────

  s06_blocked_one_tier: {
    label: "⑥ Blocked · single tier",
    cluster: "C · Blocked",
    cluster_label: "Blocked (full state card)",
    blurb: "T1 below floor at 26.4% (vs 30% floor). Ranked actions: ★ Apply Surgical (lifts above floor) and Request Override (admin path). Accept-risk unavailable.",
    quote: {
      qid: "Q-2026-0507",
      client: "Arbor Wellness Brands",
      blended_margin_pct: 0.398,
      recommended_tier_id: 3,
      policy: POLICY,
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Aromatherapy roller · 10ml", client_target_unit: 12.50, cells: {
          1: cell(0.26, 9.30), 2: cell(0.38, 8.40), 3: cell(0.45, 7.60), 4: cell(0.49, 7.00), 5: cell(0.53, 6.40) } },
        { id: "S2", name: "Recycled glass diffuser", client_target_unit: 38.00, cells: {
          1: cell(0.28, 28.50), 2: cell(0.40, 25.20), 3: cell(0.46, 22.80), 4: cell(0.50, 21.00), 5: cell(0.54, 19.40) } },
        { id: "S3", name: "Cotton bath mitt · set of 3", client_target_unit: 16.80, cells: {
          1: cell(0.29, 12.10), 2: cell(0.41, 10.80), 3: cell(0.47, 9.80), 4: cell(0.51, 9.00), 5: cell(0.54, 8.30) } },
      ],
      suggestions: {
        surgical: { tier_id: 1, lift_pct: 0.18, new_margin: 0.31 },
      },
    },
  },

  s07_blocked_per_sku_diversity: {
    label: "⑦ Blocked · per-SKU diversity",
    cluster: "C · Blocked",
    cluster_label: "Blocked (full state card)",
    blurb: "Worst SKU has T1 below floor; another SKU is sendable across all tiers; a third is priced over client target. Mode = blocked (worst-case wins). Per-SKU view surfaces in DETAIL.",
    quote: {
      qid: "Q-2026-0509",
      client: "Highland & Holt Group",
      blended_margin_pct: 0.435,
      recommended_tier_id: 3,
      policy: POLICY,
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Reclaimed wood serving board", client_target_unit: 48.00, cells: {
          1: cell(0.27, 36.80), 2: cell(0.39, 32.10), 3: cell(0.45, 29.40), 4: cell(0.48, 27.80), 5: cell(0.52, 25.50) } },
        { id: "S2", name: "Cast-iron mini skillet · branded", client_target_unit: 24.00, cells: {
          1: cell(0.48, 16.40), 2: cell(0.50, 15.80), 3: cell(0.52, 15.10), 4: cell(0.54, 14.30), 5: cell(0.56, 13.50) } },
        { id: "S3", name: "Linen apron · embroidered", client_target_unit: 22.00, cells: {
          1: cell(0.49, 26.40), 2: cell(0.51, 25.50), 3: cell(0.53, 24.50), 4: cell(0.55, 23.20), 5: cell(0.57, 22.00) } },
      ],
      suggestions: {
        surgical: { tier_id: 1, lift_pct: 0.16, sku_id: "S1" },
      },
    },
  },

  s08_blocked_accept_risk: {
    label: "⑧ Blocked · accept-risk unavailable",
    cluster: "C · Blocked",
    cluster_label: "Blocked (full state card)",
    blurb: "Below-floor blocked AND firm policy prohibits accept-risk on below-floor. Inert affordance with explainer banner — preserves discoverability without offering a path that doesn't exist.",
    quote: {
      qid: "Q-2026-0511",
      client: "Mantel & Co. (margin-protected)",
      blended_margin_pct: 0.378,
      recommended_tier_id: 3,
      policy: { ...POLICY, allow_accept_risk: false },
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Engraved barware set · stemless", client_target_unit: 36.00, cells: {
          1: cell(0.24, 27.00), 2: cell(0.35, 24.10), 3: cell(0.43, 22.00), 4: cell(0.47, 20.60), 5: cell(0.51, 18.90) } },
        { id: "S2", name: "Reclaimed leather valet tray", client_target_unit: 28.50, cells: {
          1: cell(0.26, 21.50), 2: cell(0.37, 19.20), 3: cell(0.44, 17.40), 4: cell(0.48, 16.20), 5: cell(0.52, 14.90) } },
      ],
      suggestions: {
        surgical: { tier_id: 1, lift_pct: 0.20, new_margin: 0.32 },
      },
    },
  },

  // ── Cluster D · Compound conditions ───────────────────────────────

  s09_sendable_over_client_target: {
    label: "⑨ Sendable + over client target",
    cluster: "D · Compound",
    cluster_label: "Compound (flag composes with mode)",
    blurb: "All tiers above target AND two SKUs priced above the client's stated target. Mode stays sendable; over-target surfaces as a soft 'tighten' affordance + qualifier on the state line.",
    quote: {
      qid: "Q-2026-0514",
      client: "Meridian Travel Co.",
      blended_margin_pct: 0.518,
      recommended_tier_id: 2,
      policy: POLICY,
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Travel kit · canvas roll", client_target_unit: 24.00, cells: {
          1: cell(0.52, 27.50), 2: cell(0.54, 26.60), 3: cell(0.55, 25.50), 4: cell(0.57, 24.10), 5: cell(0.59, 22.50) } },
        { id: "S2", name: "Passport sleeve · embossed", client_target_unit: 14.50, cells: {
          1: cell(0.50, 16.20), 2: cell(0.51, 15.70), 3: cell(0.52, 15.10), 4: cell(0.54, 14.30), 5: cell(0.56, 13.30) } },
        { id: "S3", name: "Luggage tag · leather", client_target_unit: 9.80, cells: {
          1: cell(0.49, 7.10), 2: cell(0.50, 6.85), 3: cell(0.51, 6.60), 4: cell(0.53, 6.20), 5: cell(0.55, 5.75) } },
      ],
    },
  },

  // ── Cluster E · Data state ────────────────────────────────────────

  s10_provisional_missing_raws: {
    label: "⑩ Provisional · missing raws",
    cluster: "E · Data state",
    cluster_label: "Provisional (data incomplete)",
    blurb: "Two cells awaiting raws — margin unknown. Classifier returns sendable_provisional: state line carries an asterisk, CTA visible but inert, status = 'provisional'. We never silently treat unknown as fine.",
    quote: {
      qid: "Q-2026-0516",
      client: "Atelier Hospitality",
      blended_margin_pct: 0.462,
      recommended_tier_id: 2,
      policy: POLICY,
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Hand-blown glass carafe", client_target_unit: 32.00, cells: {
          1: missingCell(), 2: cell(0.45, 22.40), 3: cell(0.47, 21.20), 4: cell(0.49, 20.10), 5: cell(0.52, 18.60) } },
        { id: "S2", name: "Walnut serving board", client_target_unit: 28.00, cells: {
          1: cell(0.46, 19.40), 2: cell(0.47, 18.80), 3: cell(0.48, 18.10), 4: missingCell(), 5: cell(0.53, 15.80) } },
        { id: "S3", name: "Linen menu sleeve", client_target_unit: 14.20, cells: {
          1: cell(0.47, 9.70), 2: cell(0.48, 9.40), 3: cell(0.49, 9.05), 4: cell(0.51, 8.55), 5: cell(0.53, 7.95) } },
      ],
    },
  },

  // ── Cluster F · Transition ────────────────────────────────────────

  s11_post_surgical_applied: {
    label: "⑪ Post-Surgical applied",
    cluster: "F · Transition",
    cluster_label: "Transition (mode re-renders in place)",
    blurb: "Scenario ⑥ after Apply Surgical. T1 lifted from 26.4% to 33.1% margin. Mode transitioned blocked → sendable in place — no navigation. State line, callout, and CTA re-rendered; DETAIL keeps its expanded/collapsed state from before the apply.",
    quote: {
      qid: "Q-2026-0507",
      client: "Arbor Wellness Brands",
      blended_margin_pct: 0.476,
      recommended_tier_id: 3,
      policy: POLICY,
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Aromatherapy roller · 10ml", client_target_unit: 12.50, cells: {
          1: cell(0.45, 10.90, { override: true }), 2: cell(0.46, 8.40), 3: cell(0.47, 7.60), 4: cell(0.49, 7.00), 5: cell(0.53, 6.40) } },
        { id: "S2", name: "Recycled glass diffuser", client_target_unit: 38.00, cells: {
          1: cell(0.46, 33.40, { override: true }), 2: cell(0.47, 25.20), 3: cell(0.48, 22.80), 4: cell(0.50, 21.00), 5: cell(0.54, 19.40) } },
        { id: "S3", name: "Cotton bath mitt · set of 3", client_target_unit: 16.80, cells: {
          1: cell(0.47, 14.20, { override: true }), 2: cell(0.48, 10.80), 3: cell(0.49, 9.80), 4: cell(0.51, 9.00), 5: cell(0.54, 8.30) } },
      ],
      transition: { from: "blocked", to: "sendable", via: "apply_surgical", t1_lifted_pp: 12 },
    },
  },

  // ── Cluster D · Compound · suggestion + flag (post-ship review) ──

  s12_suggestion_over_client_target: {
    label: "⑫ Suggestion-led + over client target",
    cluster: "D · Compound",
    cluster_label: "Compound (flag composes with mode)",
    blurb: "One tier below target AND two SKUs priced above client benchmark. Suggestion stays primary — fixing the floor breach takes precedence over harvesting headroom. Over-target chip surfaces in DETAIL only; no competing 'Tighten' action in the ACTION zone.",
    quote: {
      qid: "Q-2026-0518",
      client: "Aspen Trade Co.",
      blended_margin_pct: 0.428,
      recommended_tier_id: 3,
      policy: POLICY,
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Wool blanket · jacquard", client_target_unit: 64.00, cells: {
          1: cell(0.38, 46.20), 2: cell(0.46, 43.10), 3: cell(0.48, 41.40), 4: cell(0.50, 39.20), 5: cell(0.53, 36.40) } },
        { id: "S2", name: "Beeswax candle · vessel set", client_target_unit: 18.00, cells: {
          1: cell(0.41, 21.80), 2: cell(0.47, 20.40), 3: cell(0.49, 19.50), 4: cell(0.51, 18.50), 5: cell(0.54, 17.20) } },
        { id: "S3", name: "Carved cedar coaster set", client_target_unit: 14.50, cells: {
          1: cell(0.40, 16.70), 2: cell(0.46, 15.60), 3: cell(0.48, 14.90), 4: cell(0.50, 14.10), 5: cell(0.53, 13.10) } },
      ],
      suggestions: {
        surgical: { tier_id: 1, lift_pct: 0.14, new_margin: 0.46 },
      },
    },
  },

  s13_escalation_below_floor: {
    label: "⑬ Escalation · mid-edit drop below floor",
    cluster: "F · Transition",
    cluster_label: "Transition (mode re-renders in place)",
    blurb: "PM lowered the global adjustment by 8pp mid-edit; T1 crossed below floor. Mode escalated suggestion-led → blocked in place. The 'just updated' hint stays on the state line for 30s. DETAIL kept its prior expanded/collapsed state — no surprise expansion on escalation.",
    quote: {
      qid: "Q-2026-0521",
      client: "Glass & Ash Studios",
      blended_margin_pct: 0.382,
      recommended_tier_id: 3,
      policy: POLICY,
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Hand-thrown ceramic mug", client_target_unit: 16.50, cells: {
          1: cell(0.22, 12.40), 2: cell(0.41, 10.80), 3: cell(0.45, 10.10), 4: cell(0.48, 9.40), 5: cell(0.52, 8.50) } },
        { id: "S2", name: "Sand-cast brass bottle opener", client_target_unit: 14.00, cells: {
          1: cell(0.24, 10.70), 2: cell(0.42, 9.20), 3: cell(0.46, 8.50), 4: cell(0.49, 7.90), 5: cell(0.53, 7.10) } },
      ],
      suggestions: {
        surgical: { tier_id: 1, lift_pct: 0.16, new_margin: 0.31 },
      },
      transition: { from: "suggestion_led", to: "blocked", via: "global_adjust_keystroke", adj_pp: 8 },
    },
  },

  s14_blocked_no_override: {
    label: "⑭ Blocked · override unavailable",
    cluster: "C · Blocked",
    cluster_label: "Blocked (full state card)",
    blurb: "T1 below floor AND firm policy disables admin overrides on this account class. Apply Surgical is the only send path. 'Override unavailable' surfaces as an inert action card — PMs don't go searching for a path that doesn't exist on this account.",
    quote: {
      qid: "Q-2026-0523",
      client: "Pendleton Mercantile (no-override)",
      blended_margin_pct: 0.394,
      recommended_tier_id: 3,
      policy: { ...POLICY, allow_override: false, allow_accept_risk: false },
      tiers: tiers([100, 250, 500, 1000, 2500]),
      skus: [
        { id: "S1", name: "Waxed canvas dopp kit", client_target_unit: 32.00, cells: {
          1: cell(0.26, 23.80), 2: cell(0.38, 21.40), 3: cell(0.45, 19.60), 4: cell(0.48, 18.40), 5: cell(0.52, 16.80) } },
        { id: "S2", name: "Selvedge denim apron", client_target_unit: 38.00, cells: {
          1: cell(0.27, 28.50), 2: cell(0.40, 25.40), 3: cell(0.46, 23.10), 4: cell(0.49, 21.60), 5: cell(0.53, 19.80) } },
        { id: "S3", name: "Hand-stamped leather tag set", client_target_unit: 12.50, cells: {
          1: cell(0.28, 9.40), 2: cell(0.41, 8.20), 3: cell(0.47, 7.50), 4: cell(0.50, 6.95), 5: cell(0.54, 6.30) } },
      ],
      suggestions: {
        surgical: { tier_id: 1, lift_pct: 0.18, new_margin: 0.32 },
      },
    },
  },

};

// ── Scenario keys grouped by cluster, in render order ────────────────
PSR.scenario_order = [
  "s01_sendable_vanilla", "s02_sendable_headroom", "s03_sendable_2tier",
  "s04_suggestion_surgical", "s05_suggestion_global",
  "s06_blocked_one_tier", "s07_blocked_per_sku_diversity", "s08_blocked_accept_risk", "s14_blocked_no_override",
  "s09_sendable_over_client_target", "s12_suggestion_over_client_target",
  "s10_provisional_missing_raws",
  "s11_post_surgical_applied", "s13_escalation_below_floor",
];
