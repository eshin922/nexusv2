// Pricing Reframe v1 — fixtures
// Seven workflow scenarios drive the design harness.
// Path 3 hybrid: blended preserved as primary; per-tier compliance + tier-aware
// suggestions + risk callouts + ROOM-state recompute layer in as equal-weight secondary.
//
// Schema notes:
// - All tiers carry their own margin (per-tier reality)
// - Blended is portfolio-weighted average (sanity check, not destination)
// - sku_count × tier_count = full cell grid; per-tier blended is sum across SKUs
// - "Recommended" tier (★) is what the customer is expected to pick; v1.1 may
//   promote this to primary verdict (Path 2). Path 3 surfaces it as a chip.

window.NXPR = {

  project: {
    client: "Lumen & Co.",
    deal_name: "Q3 Replenish + Glow Capsule Launch",
    scenario: "Primary",
    version: 4,
  },

  // Firm policy (R5 carry-forward)
  policy: {
    target_margin_pct: 0.35,
    floor_margin_pct: 0.25,
  },

  // Seven scenarios. Each carries:
  //   blended (computed by us; passed for display realism)
  //   tiers: [{ id, units, margin_pct, sell_per_unit, recommended }]
  //   suggestions: tier-aware options the engine produced
  //   description: what this scenario is testing
  scenarios: {

    // ① All tiers above target
    all_healthy: {
      label: "① All tiers above target",
      description: "Green-light state. All four tiers at or above 35%. Blended at 38.4%.",
      blended_margin: 0.384,
      blended_state: "good",
      tiers: [
        { id: "T1", units: 5000,  margin_pct: 0.362, sell_per_unit: 4.45, recommended: false },
        { id: "T2", units: 10000, margin_pct: 0.388, sell_per_unit: 3.95, recommended: true  },
        { id: "T3", units: 25000, margin_pct: 0.401, sell_per_unit: 3.49, recommended: false },
        { id: "T4", units: 50000, margin_pct: 0.412, sell_per_unit: 3.18, recommended: false },
      ],
      suggestions: null,  // no suggestions when all healthy
    },

    // ② One tier below target, blended above target — the trigger scenario
    one_below_target: {
      label: "② One tier below target",
      description: "Edward's trigger scenario. T1 at 32.8% (below target). Blended at 38.7%, hiding T1 risk. Suggestion engine fires.",
      blended_margin: 0.387,
      blended_state: "good",
      blended_warning: "1 tier risk",  // path 3: pill copy adapts
      tiers: [
        { id: "T1", units: 5000,  margin_pct: 0.328, sell_per_unit: 4.45, recommended: false,
          risk_callout: "If customer picks T1, realized margin 32.8% (2.2pp under target)" },
        { id: "T2", units: 10000, margin_pct: 0.388, sell_per_unit: 3.95, recommended: true  },
        { id: "T3", units: 25000, margin_pct: 0.401, sell_per_unit: 3.49, recommended: false },
        { id: "T4", units: 50000, margin_pct: 0.412, sell_per_unit: 3.18, recommended: false },
      ],
      suggestions: {
        // Context-aware ranking per Q3: surgical first (one tier below)
        ranking: "surgical_first",
        options: [
          {
            id: "surgical", label: "Surgical · T1 only", recommended: true,
            description: "Apply +9% to T1 only · lands T1 at target",
            apply_to: ["T1"], apply_pct: 0.09,
            preview: [
              { id: "T1", new_margin: 0.357, delta_pp: 2.9 },
              { id: "T2", new_margin: 0.388, delta_pp: 0 },
              { id: "T3", new_margin: 0.401, delta_pp: 0 },
              { id: "T4", new_margin: 0.412, delta_pp: 0 },
            ],
          },
          {
            id: "global", label: "Global · all tiers",
            description: "Apply +3.4% globally · preserves tier ratios, lifts T1 to target",
            apply_to: ["T1", "T2", "T3", "T4"], apply_pct: 0.034,
            preview: [
              { id: "T1", new_margin: 0.351, delta_pp: 2.3 },
              { id: "T2", new_margin: 0.411, delta_pp: 2.3 },
              { id: "T3", new_margin: 0.422, delta_pp: 2.1 },
              { id: "T4", new_margin: 0.432, delta_pp: 2.0 },
            ],
          },
          {
            id: "accept_risk", label: "Accept risk · send as-is",
            description: "Send with T1 below target. T2 (recommended) at 38.8% — risk acceptable.",
            apply_to: [], apply_pct: 0,
            preview: null,
          },
        ],
      },
    },

    // ③ Multiple tiers below target, blended below target
    multi_below_target: {
      label: "③ Multiple tiers below target",
      description: "Clear 'needs review' state. T1, T2, and T3 below target; blended 32.4%. Suggestion engine fires with global suggestion ranked first.",
      blended_margin: 0.324,
      blended_state: "warn",
      blended_warning: "3 tiers below target",
      tiers: [
        { id: "T1", units: 5000,  margin_pct: 0.298, sell_per_unit: 4.20, recommended: false,
          risk_callout: "If customer picks T1, realized margin 29.8% (5.2pp under target)" },
        { id: "T2", units: 10000, margin_pct: 0.324, sell_per_unit: 3.72, recommended: true,
          risk_callout: "If customer picks T2 (recommended), realized margin 32.4% (2.6pp under target)" },
        { id: "T3", units: 25000, margin_pct: 0.342, sell_per_unit: 3.32, recommended: false,
          risk_callout: "If customer picks T3, realized margin 34.2% (0.8pp under target)" },
        { id: "T4", units: 50000, margin_pct: 0.358, sell_per_unit: 3.01, recommended: false },
      ],
      suggestions: {
        ranking: "global_first",  // surgical isn't applicable when 2+ below
        options: [
          {
            id: "global", label: "Global · all tiers", recommended: true,
            description: "Apply +4.2% globally · lifts T1 and T2 to target, preserves ratios",
            apply_to: ["T1", "T2", "T3", "T4"], apply_pct: 0.042,
            preview: [
              { id: "T1", new_margin: 0.354, delta_pp: 5.6 },
              { id: "T2", new_margin: 0.358, delta_pp: 3.4 },
              { id: "T3", new_margin: 0.371, delta_pp: 2.9 },
              { id: "T4", new_margin: 0.385, delta_pp: 2.7 },
            ],
          },
          {
            id: "surgical", label: "Surgical · T1 + T2 only",
            description: "Apply +6.2% to T1 and +3.4% to T2 · each lands at target separately",
            apply_to: ["T1", "T2"], apply_pct: null,  // mixed
            preview: [
              { id: "T1", new_margin: 0.353, delta_pp: 5.5 },
              { id: "T2", new_margin: 0.350, delta_pp: 2.6 },
              { id: "T3", new_margin: 0.342, delta_pp: 0 },
              { id: "T4", new_margin: 0.358, delta_pp: 0 },
            ],
          },
          // Accept-risk unavailable per Q3: only when T2+ recommended healthy.
          // T2 is below target here, so omitted.
        ],
        accept_risk_unavailable_reason: "T2 (recommended tier) is below target — accept-risk requires recommended tier to be healthy",
      },
    },

    // ④ One tier below floor — deal-blocking
    one_below_floor: {
      label: "④ One tier below floor",
      description: "Deal-blocking state. T1 at 22.4% (below 25% floor). Mark Accepted blocked; admin override required.",
      blended_margin: 0.354,
      blended_state: "warn",
      blended_warning: "1 tier blocked",
      tiers: [
        { id: "T1", units: 5000,  margin_pct: 0.224, sell_per_unit: 4.20, recommended: false,
          floor_breach: true,
          risk_callout: "T1 below floor by 2.6pp · sends are blocked at the firm policy gate" },
        { id: "T2", units: 10000, margin_pct: 0.358, sell_per_unit: 3.95, recommended: true  },
        { id: "T3", units: 25000, margin_pct: 0.388, sell_per_unit: 3.49, recommended: false },
        { id: "T4", units: 50000, margin_pct: 0.402, sell_per_unit: 3.18, recommended: false },
      ],
      suggestions: {
        ranking: "surgical_first",
        // Accept-risk unavailable (below floor)
        options: [
          {
            id: "surgical", label: "Surgical · T1 only", recommended: true,
            description: "Apply +18% to T1 only · lands T1 at target",
            apply_to: ["T1"], apply_pct: 0.18,
            preview: [
              { id: "T1", new_margin: 0.352, delta_pp: 12.8 },
              { id: "T2", new_margin: 0.358, delta_pp: 0 },
              { id: "T3", new_margin: 0.388, delta_pp: 0 },
              { id: "T4", new_margin: 0.402, delta_pp: 0 },
            ],
          },
          {
            id: "global", label: "Global · all tiers",
            description: "Apply +7.2% globally · lifts T1 above floor, preserves ratios",
            apply_to: ["T1", "T2", "T3", "T4"], apply_pct: 0.072,
            preview: [
              { id: "T1", new_margin: 0.282, delta_pp: 5.8 },
              { id: "T2", new_margin: 0.401, delta_pp: 4.3 },
              { id: "T3", new_margin: 0.418, delta_pp: 3.0 },
              { id: "T4", new_margin: 0.428, delta_pp: 2.6 },
            ],
            warning: "T1 still below target after global — surgical recommended",
          },
        ],
        accept_risk_unavailable_reason: "T1 below floor — admin override required, accept-risk path unavailable",
      },
    },

    // ⑤ Empty / new quote
    empty_quote: {
      label: "⑤ Empty / no tier data",
      description: "First-time entry. No tier data yet. Blended undefined; pricing surface waits for inputs.",
      blended_margin: null,
      blended_state: "empty",
      tiers: [],
      suggestions: null,
    },

    // ⑥ Adjustment in progress
    applying: {
      label: "⑥ Applying adjustment",
      description: "PM clicked Apply on the surgical suggestion. UI shows the in-flight state.",
      blended_margin: 0.387,
      blended_state: "good",
      blended_warning: "1 tier risk",
      applying: { suggestion_id: "surgical", started_at: "now", elapsed_ms: 1400 },
      tiers: [
        { id: "T1", units: 5000,  margin_pct: 0.328, sell_per_unit: 4.45, recommended: false,
          applying: true, target_margin: 0.357 },
        { id: "T2", units: 10000, margin_pct: 0.388, sell_per_unit: 3.95, recommended: true  },
        { id: "T3", units: 25000, margin_pct: 0.401, sell_per_unit: 3.49, recommended: false },
        { id: "T4", units: 50000, margin_pct: 0.412, sell_per_unit: 3.18, recommended: false },
      ],
      suggestions: null,
    },

    // ⑦ Post-apply
    post_apply: {
      label: "⑦ Adjustment applied",
      description: "Surgical suggestion landed. T1 lifted to target. Toast confirms; audit log captures the change.",
      blended_margin: 0.394,
      blended_state: "good",
      tiers: [
        { id: "T1", units: 5000,  margin_pct: 0.357, sell_per_unit: 4.85, recommended: false,
          just_changed: true, change_delta_pp: 2.9 },
        { id: "T2", units: 10000, margin_pct: 0.388, sell_per_unit: 3.95, recommended: true  },
        { id: "T3", units: 25000, margin_pct: 0.401, sell_per_unit: 3.49, recommended: false },
        { id: "T4", units: 50000, margin_pct: 0.412, sell_per_unit: 3.18, recommended: false },
      ],
      suggestions: null,
      toast: {
        kind: "success",
        message: "Surgical · T1 lifted from 32.8% to 35.7% (+2.9pp · within target)",
        audit_ref: "audit_id=a_2104",
      },
    },
  },
};
