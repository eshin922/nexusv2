/* global window */
// ─────────────────────────────────────────────────────────────────────
// Pricing-surface classifier · single source of truth
// ─────────────────────────────────────────────────────────────────────
// Every state-bearing surface in the redesign — state line, status pill,
// CTA enablement, action ranking, callouts, row chips, summary card,
// detail-zone rollups — reads from one classifier output object per render.
// No surface computes its own state. The §1 duplication problem (multiple
// surfaces reading "47.1% blended" from different derivations) was a
// source-of-truth failure; the structural fix is one classifier, one
// render pass, all surfaces consume.
//
// Mode is a property of the quote, not the SKU. Computed from worst-case
// known cell. Over-client-target is a parallel flag that composes with
// mode, not a separate mode. Missing data produces a "provisional" qualifier
// rather than silently classifying as sendable.

window.PSR = window.PSR || {};

PSR.classify = function classify(quote) {
  const policy = quote.policy;

  // ── 1. Flatten quote into (sku × tier) cells ────────────────────
  const cells = [];
  for (const sku of quote.skus) {
    for (const tier of quote.tiers) {
      const cellRaw = sku.cells[tier.id] || {};
      const missing = cellRaw.missing === true || cellRaw.margin_pct == null;
      // Per-cell status — classifier-owned, consumed by every surface.
      // The §3 source-of-truth rule: no component re-derives this.
      const status = missing                                              ? "unknown"      :
        cellRaw.margin_pct <  policy.floor_margin_pct                     ? "below_floor"  :
        cellRaw.margin_pct <  policy.target_margin_pct                    ? "below_target" :
                                                                            "above_target";
      cells.push({
        sku_id: sku.id,
        sku_name: sku.name,
        tier_id: tier.id,
        tier_qty: tier.qty,
        margin_pct: cellRaw.margin_pct ?? null,
        sell_unit: cellRaw.sell_unit ?? null,
        cost_unit: cellRaw.cost_unit ?? null,
        cost_stack: cellRaw.cost_stack ?? null,
        client_target_unit: sku.client_target_unit ?? null,
        client_target_delta: (sku.client_target_unit != null && cellRaw.sell_unit != null)
          ? cellRaw.sell_unit - sku.client_target_unit : null,
        over_client_target: sku.client_target_unit != null && cellRaw.sell_unit != null
          && cellRaw.sell_unit > sku.client_target_unit,
        missing,
        status,
        override_applied: cellRaw.override_applied === true,
      });
    }
  }

  const known   = cells.filter(c => !c.missing);
  const unknown = cells.filter(c =>  c.missing);

  const belowFloor  = known.filter(c => c.status === "below_floor");
  const belowTarget = known.filter(c => c.status === "below_target");

  // ── 2. Mode — worst-case classifier ─────────────────────────────
  let mode;
  if (belowFloor.length  > 0) mode = "blocked";
  else if (belowTarget.length > 0) mode = "suggestion_led";
  else                             mode = "sendable";

  // ── 3. Over-client-target — flag, not mode ──────────────────────
  const overClientTarget = cells.filter(c =>
    c.client_target_unit != null &&
    c.sell_unit != null &&
    c.sell_unit > c.client_target_unit
  );

  // ── 4. Per-tier rollup (worst margin across SKUs for that tier) ─
  const tierRoll = quote.tiers.map(t => {
    const tierCells     = cells.filter(c => c.tier_id === t.id);
    const tierKnown     = tierCells.filter(c => !c.missing);
    const minMargin     = tierKnown.length ? Math.min(...tierKnown.map(c => c.margin_pct)) : null;
    const blendedMargin = tierKnown.length ?
      tierKnown.reduce((s, c) => s + c.margin_pct, 0) / tierKnown.length : null;
    const status =
      minMargin == null                              ? "unknown"      :
      minMargin <  policy.floor_margin_pct           ? "below_floor"  :
      minMargin <  policy.target_margin_pct          ? "below_target" :
                                                       "above_target";
    return {
      ...t,
      min_margin_pct: minMargin,
      blended_margin_pct: blendedMargin,
      status,
      has_override: tierCells.some(c => c.override_applied),
      has_missing:  tierCells.some(c => c.missing),
    };
  });

  // ── 5. Per-SKU rollup (for per-SKU-diversity surfacing) ─────────
  const skuRoll = quote.skus.map(sku => {
    const skuCells   = cells.filter(c => c.sku_id === sku.id);
    const skuKnown   = skuCells.filter(c => !c.missing);
    const minMargin  = skuKnown.length ? Math.min(...skuKnown.map(c => c.margin_pct)) : null;
    // Per-tier strip pulls each cell's classifier-assigned status — no re-derivation.
    const allTiers   = skuCells.map(c => ({
      tier_id: c.tier_id,
      margin_pct: c.margin_pct,
      status: c.status,
      override_applied: c.override_applied,
    }));
    const status =
      minMargin == null                              ? "unknown"      :
      minMargin <  policy.floor_margin_pct           ? "below_floor"  :
      minMargin <  policy.target_margin_pct          ? "below_target" :
                                                       "above_target";
    const overTarget = skuCells.some(c => c.over_client_target);
    return { ...sku, min_margin_pct: minMargin, status, all_tiers: allTiers, over_client_target: overTarget };
  });

  // ── 6. Action ranking ───────────────────────────────────────────
  // Locked heuristic (designer notes §4):
  //   blocked dominates over-client-target — fix the floor first.
  //   suggestion-led — surgical wins when exactly one tier is below;
  //   global wins when 2+ tiers are below (since surgical would compound).
  //   over-client-target in sendable mode = soft "tighten" affordance,
  //   never marked recommended.
  // When multiple actions exist in ACTION zone, exactly one carries ★ Recommended.
  // Suggestions guard (Edward fix #4): if mode requires a suggestion but
  // quote.suggestions doesn't carry one, render an inert "calculating suggestion"
  // action rather than fabricate one.
  const actions = [];
  const tiersBelowFloor  = new Set(belowFloor.map(c => c.tier_id));
  const tiersBelowTarget = new Set(belowTarget.map(c => c.tier_id));
  const sugg = quote.suggestions || {};

  // Helper: project blended margin after applying a suggestion. Classifier
  // owns this projection (Edward fix #2) — components consume from action.
  const projectBlended = (kind) => {
    if (kind === "apply_surgical" && sugg.surgical) {
      // Approx: the surgical lift recovers the worst tier; recompute blended
      // by replacing that tier's worst margin with new_margin and re-averaging.
      const s = sugg.surgical;
      if (s.new_margin == null) return null;
      const all = cells.filter(c => !c.missing).map(c =>
        c.tier_id === s.tier_id && c.margin_pct === Math.min(
          ...cells.filter(x => x.tier_id === s.tier_id && !x.missing).map(x => x.margin_pct)
        ) ? s.new_margin : c.margin_pct
      );
      return all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
    }
    if (kind === "apply_global" && sugg.global) {
      return sugg.global.new_blended ?? null;
    }
    return null;
  };

  if (mode === "blocked") {
    if (sugg.surgical) {
      actions.push({
        kind: "apply_surgical",
        label: `Apply Surgical · lift ${labelTiers(tiersBelowFloor)} above floor`,
        sublabel: `Recommended adjustment per SKU · re-renders quote in place`,
        recommended: true,
        primary: true,
        projected_blended_after_apply: projectBlended("apply_surgical"),
      });
    } else {
      actions.push({
        kind: "calculating_suggestion",
        label: "Calculating suggestion…",
        sublabel: "Suggestion engine is computing a lift path. Refresh in a moment.",
        recommended: true,
        primary: true,
        disabled: true,
      });
    }
    if (policy.allow_override) {
      actions.push({
        kind: "request_override",
        label: "Request admin override",
        sublabel: "Routes to firm admin · quote sits in waiting state",
        recommended: false,
        primary: false,
      });
    } else {
      // Edward fix #5: allow_override === false fallback.
      // No override path; surface the policy reality as an inert affordance
      // so the PM doesn't go looking for an option that doesn't exist on this account.
      actions.push({
        kind: "override_unavailable",
        label: "Admin override unavailable on this account",
        sublabel: "Firm policy prohibits below-floor overrides. Surgical lift is the only send path.",
        recommended: false,
        primary: false,
        disabled: true,
      });
    }
  } else if (mode === "suggestion_led") {
    const surgicalWins = tiersBelowTarget.size === 1;
    if (surgicalWins && sugg.surgical) {
      actions.push({
        kind: "apply_surgical",
        label: `Apply Surgical · lift ${labelTiers(tiersBelowTarget)} to target`,
        sublabel: "Adjusts the offending tier only · other tiers unchanged",
        recommended: true,
        primary: true,
        projected_blended_after_apply: projectBlended("apply_surgical"),
      });
    } else if (!surgicalWins && sugg.global) {
      actions.push({
        kind: "apply_global",
        label: "Apply Global · lift all tiers proportionally",
        sublabel: `${tiersBelowTarget.size} tiers below target · surgical would compound`,
        recommended: true,
        primary: true,
        projected_blended_after_apply: projectBlended("apply_global"),
      });
    } else {
      actions.push({
        kind: "calculating_suggestion",
        label: "Calculating suggestion…",
        sublabel: "Suggestion engine is computing a lift path. Refresh in a moment.",
        recommended: true,
        primary: true,
        disabled: true,
      });
    }
    actions.push({
      kind: "preview_pdf",
      label: "Preview quote PDF",
      sublabel: "Send below-target (review risk first)",
      recommended: false,
      primary: false,
      demoted: true,
    });
  } else { // sendable
    actions.push({
      kind: "preview_pdf",
      label: "Preview quote PDF",
      sublabel: null,
      recommended: false,
      primary: true,
    });
    if (overClientTarget.length > 0) {
      actions.push({
        kind: "tighten_to_target",
        label: `Tighten to client benchmark · ${overClientTarget.length} ${overClientTarget.length === 1 ? "SKU" : "SKUs"}`,
        sublabel: "Pricing above client's stated target — leaving headroom on the table",
        recommended: false,
        primary: false,
        soft: true,
      });
    }
  }

  // Provisional / data-incomplete handling: classifier never silently
  // treats unknown margins as fine. If any cell is unknown:
  //   - blocked stays blocked (known floor breach is decisive)
  //   - suggestion_led stays suggestion_led
  //   - sendable becomes "sendable_provisional" — CTA stays visible but
  //     inert with an explainer; status carries the asterisk.
  const dataIncomplete = unknown.length > 0;
  if (dataIncomplete && mode === "sendable") {
    actions[0].disabled = true;
    actions[0].disabled_reason = `${unknown.length} ${unknown.length === 1 ? "cell" : "cells"} awaiting raws · margin unknown`;
  }

  // ── 7. State-line copy (one source — never restated) ────────────
  // Per Edward's resolution: state line carries STATUS ONLY.
  // The blended margin number lives in the summary card (sendable) or
  // the state callout/card (suggestion-led / blocked). State line never
  // carries the number.
  let stateLine;
  if (mode === "sendable") {
    const qualifiers = [];
    if (overClientTarget.length > 0) {
      qualifiers.push(`${overClientTarget.length} ${overClientTarget.length === 1 ? "SKU" : "SKUs"} over client target`);
    }
    if (dataIncomplete) {
      qualifiers.push(`${unknown.length} ${unknown.length === 1 ? "cell" : "cells"} awaiting raws`);
    }
    stateLine = {
      lead: "All tiers above target",
      status: dataIncomplete ? "provisional" : "sendable",
      qualifiers,
    };
  } else if (mode === "suggestion_led") {
    const qualifiers = [];
    if (dataIncomplete) {
      qualifiers.push(`${unknown.length} ${unknown.length === 1 ? "cell" : "cells"} awaiting raws`);
    }
    if (overClientTarget.length > 0) {
      qualifiers.push(`${overClientTarget.length} over client target`);
    }
    stateLine = {
      lead: `${tiersBelowTarget.size} ${tiersBelowTarget.size === 1 ? "tier" : "tiers"} below target`,
      status: "review",
      qualifiers,
    };
  } else { // blocked
    // Edward fix #3: data_incomplete qualifier must surface in blocked mode too.
    // A blocked quote with missing raws carries more uncertainty than blocked alone.
    const qualifiers = [];
    if (dataIncomplete) {
      qualifiers.push(`${unknown.length} ${unknown.length === 1 ? "cell" : "cells"} awaiting raws`);
    }
    if (overClientTarget.length > 0) {
      qualifiers.push("mixed status · per-SKU view in detail");
    }
    if (!policy.allow_override) {
      qualifiers.push("override unavailable · firm policy");
    }
    stateLine = {
      lead: `${tiersBelowFloor.size} ${tiersBelowFloor.size === 1 ? "tier" : "tiers"} below floor`,
      status: "blocked",
      qualifiers,
    };
  }

  // ── 8. Summary card (sendable only — composition, not status) ───
  const summaryCard = mode === "sendable" ? {
    sku_count: quote.skus.length,
    tier_count: quote.tiers.length,
    recommended_tier: quote.recommended_tier_id,
    recommended_tier_value: (() => {
      const t = tierRoll.find(x => x.id === quote.recommended_tier_id);
      if (!t) return null;
      const tierCells = cells.filter(c => c.tier_id === t.id && !c.missing);
      return tierCells.reduce((s, c) => s + (c.sell_unit ?? 0) * t.qty, 0);
    })(),
    blended_margin_pct: quote.blended_margin_pct,
  } : null;

  return {
    mode,
    mode_label: mode === "sendable" ? "Sendable"
              : mode === "suggestion_led" ? "Suggestion-led"
              : "Blocked",
    blended_margin_pct: quote.blended_margin_pct,
    state_line: stateLine,
    summary_card: summaryCard,
    flags: {
      over_client_target: overClientTarget.length > 0,
      over_client_target_count: overClientTarget.length,
      data_incomplete: dataIncomplete,
      missing_count: unknown.length,
      override_applied: tierRoll.some(t => t.has_override),
      accept_risk_unavailable: mode === "blocked",
      override_unavailable: mode === "blocked" && !policy.allow_override,
    },
    tiers: tierRoll,
    skus: skuRoll,
    cells,
    below_floor: belowFloor,
    below_target: belowTarget,
    over_client_target: overClientTarget,
    actions,
    policy,
    quote,
  };
};

function labelTiers(tierSet) {
  if (tierSet.size === 0) return "—";
  if (tierSet.size === 1) return "Tier " + [...tierSet][0];
  return [...tierSet].map(t => "T" + t).join(", ");
}
