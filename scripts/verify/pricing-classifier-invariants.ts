// slice-pricing-surface-redesign Step 3 — classifier invariant
// verifier. Asserts the seven structural invariants the brief §15
// enumerates. Run via:
//
//   node --experimental-strip-types
//     scripts/verify/pricing-classifier-invariants.ts
//
// Failure mode: process.exit(1) with the failing invariant + the
// classifier output that broke it. Hooked into prebuild alongside
// the boundary + autosave verifiers.
//
// Invariants:
//   1. Mode taxonomy exhaustive — every classify() return resolves
//      to exactly one of sendable | suggestion_led | blocked
//   2. Exactly-one-recommended — suggestion_led + blocked modes
//      emit exactly one action with recommended: true
//   3. Per-cell ↔ per-tier ↔ per-SKU agreement — rollups don't
//      contradict the per-cell classifier output
//   4. Provisional symmetry — missing data never silently classifies
//      as sendable; sendable + data_incomplete → state_line.status
//      === "provisional" + primary action disabled
//   5. Blocked-implies-accept-risk-gating — accept_risk_unavailable
//      flag fires only on blocked mode when policy disallows
//   6. allow_override semantics — when blocked + !policy.allow_override,
//      action emitted is override_unavailable (inert), NOT
//      request_override; flags.override_unavailable === true
//   7. calculating_suggestion fallback — when mode requires a
//      suggestion but quote.suggestions doesn't carry one,
//      classifier emits kind: 'calculating_suggestion' with
//      disabled: true
//
// Fixtures cover the 14 CD scenarios (s01..s14) per designer notes
// §6. Each fixture is constructed inline to keep the verifier self-
// contained and avoid coupling to the prototype's data.js shape.

// Relative .ts imports — verifier runs via raw Node
// --experimental-strip-types so the path-alias `@/` doesn't
// resolve. Production app code uses `@/lib/...` via tsconfig
// + Next bundler. Classifier itself uses the same .ts-suffixed
// relative path for its predicate import for the same reason.
// tsconfig `allowImportingTsExtensions: true` keeps tsc happy.
import {
  classify,
  type QuoteInput,
  type QuotePolicyInput,
  type QuoteState,
} from "../../src/lib/pricing-classifier.ts";

// ──────────────────────────────────────────────────────────────────
// Fixture builders — minimal QuoteInput shapes per scenario
// ──────────────────────────────────────────────────────────────────

const POLICY: QuotePolicyInput = {
  target_margin_pct: 0.35,
  floor_margin_pct: 0.25,
  allow_override: true,
  allow_accept_risk: true,
};

function cell(
  margin: number | null,
  opts: {
    sell?: number;
    cost?: number;
    override?: boolean;
    missing?: boolean;
  } = {},
) {
  return {
    margin_pct: margin,
    sell_unit: opts.sell ?? 10,
    cost_unit: opts.cost ?? 7,
    cost_stack: null,
    override_applied: opts.override === true,
    missing: opts.missing === true,
  };
}

function quote(opts: {
  margins: number[][];
  recommendedTierId?: number;
  blended?: number;
  clientTargets?: (number | null)[];
  suggestions?: QuoteInput["suggestions"];
  missingCells?: Array<[number, number]>; // [skuIdx, tierIdx]
  suggestionInfeasible?: boolean;
}): QuoteInput {
  const tierCount = opts.margins[0]?.length ?? 0;
  const tiers = Array.from({ length: tierCount }, (_, i) => ({
    id: i + 1,
    qty: 1000 * (i + 1),
  }));
  const skus = opts.margins.map((row, skuIdx) => {
    const cells: Record<number, ReturnType<typeof cell>> = {};
    row.forEach((m, tierIdx) => {
      const missing =
        opts.missingCells?.some(
          ([s, t]) => s === skuIdx && t === tierIdx,
        ) ?? false;
      cells[tierIdx + 1] = cell(missing ? null : m, { missing });
    });
    return {
      id: `sku-${skuIdx + 1}`,
      name: `SKU ${skuIdx + 1}`,
      client_target_unit: opts.clientTargets?.[skuIdx] ?? null,
      cells,
    };
  });
  const allKnown = opts.margins.flat();
  const computedBlended =
    allKnown.length > 0
      ? allKnown.reduce((s, m) => s + m, 0) / allKnown.length
      : null;
  return {
    skus,
    tiers,
    blended_margin_pct: opts.blended ?? computedBlended,
    recommended_tier_id:
      opts.recommendedTierId ?? (tiers.length > 0 ? tiers[0].id : null),
    suggestions: opts.suggestions,
    suggestion_infeasible: opts.suggestionInfeasible,
  };
}

// ──────────────────────────────────────────────────────────────────
// Invariant assertions
// ──────────────────────────────────────────────────────────────────

const VALID_MODES = new Set(["sendable", "suggestion_led", "blocked"]);
const VALID_STATE_LINE_STATUSES = new Set([
  "sendable",
  "review",
  "blocked",
  "provisional",
]);

const failures: string[] = [];

function assert(
  condition: boolean,
  scenarioId: string,
  invariantId: string,
  detail: string,
) {
  if (!condition) {
    failures.push(`  ✗ ${scenarioId} · invariant ${invariantId}: ${detail}`);
  }
}

function runScenario(
  scenarioId: string,
  input: QuoteInput,
  policy: QuotePolicyInput,
  expectations: {
    mode: QuoteState["mode"];
    stateLineStatus?: QuoteState["state_line"]["status"];
    overrideUnavailable?: boolean;
    acceptRiskUnavailable?: boolean;
    expectCalculatingSuggestion?: boolean;
    expectSuggestionInfeasible?: boolean;
  },
) {
  const out = classify(input, policy);

  // Invariant 1 · Mode taxonomy
  assert(
    VALID_MODES.has(out.mode),
    scenarioId,
    "1",
    `mode '${out.mode}' is not in {sendable, suggestion_led, blocked}`,
  );
  assert(
    out.mode === expectations.mode,
    scenarioId,
    "1",
    `expected mode=${expectations.mode} got mode=${out.mode}`,
  );
  assert(
    VALID_STATE_LINE_STATUSES.has(out.state_line.status),
    scenarioId,
    "1",
    `state_line.status '${out.state_line.status}' not in valid 4-value set`,
  );
  if (expectations.stateLineStatus) {
    assert(
      out.state_line.status === expectations.stateLineStatus,
      scenarioId,
      "1",
      `expected state_line.status=${expectations.stateLineStatus} got ${out.state_line.status}`,
    );
  }

  // Invariant 2 · Exactly-one-recommended on suggestion_led + blocked
  if (out.mode === "suggestion_led" || out.mode === "blocked") {
    const recommendedCount = out.actions.filter(
      (a) => a.recommended === true,
    ).length;
    assert(
      recommendedCount === 1,
      scenarioId,
      "2",
      `mode=${out.mode} expects exactly 1 recommended action; got ${recommendedCount}`,
    );
  }

  // Invariant 3 · Per-cell ↔ per-tier ↔ per-SKU rollup agreement
  for (const tier of out.tiers) {
    const tierCells = out.cells.filter((c) => c.tier_id === tier.id);
    const known = tierCells.filter((c) => !c.missing);
    if (known.length === 0) {
      assert(
        tier.status === "unknown",
        scenarioId,
        "3",
        `tier=${tier.id} has zero known cells but status=${tier.status}`,
      );
      continue;
    }
    const observedMin = Math.min(...known.map((c) => c.margin_pct as number));
    assert(
      tier.min_margin_pct === observedMin,
      scenarioId,
      "3",
      `tier=${tier.id} min_margin rollup=${tier.min_margin_pct} disagrees with cells observed=${observedMin}`,
    );
    // Tier status must reflect the worst (min) cell's bucket
    const worstCell = known.find((c) => c.margin_pct === observedMin);
    assert(
      tier.status === worstCell?.status,
      scenarioId,
      "3",
      `tier=${tier.id} status=${tier.status} disagrees with worst cell status=${worstCell?.status}`,
    );
  }
  for (const sku of out.skus) {
    const skuCells = out.cells.filter((c) => c.sku_id === sku.id);
    const known = skuCells.filter((c) => !c.missing);
    if (known.length === 0) {
      assert(
        sku.status === "unknown",
        scenarioId,
        "3",
        `sku=${sku.id} has zero known cells but status=${sku.status}`,
      );
      continue;
    }
    const observedMin = Math.min(...known.map((c) => c.margin_pct as number));
    assert(
      sku.min_margin_pct === observedMin,
      scenarioId,
      "3",
      `sku=${sku.id} min_margin rollup=${sku.min_margin_pct} disagrees with cells observed=${observedMin}`,
    );
  }

  // Invariant 4 · Provisional symmetry
  if (out.flags.data_incomplete && out.mode === "sendable") {
    assert(
      out.state_line.status === "provisional",
      scenarioId,
      "4",
      `sendable + data_incomplete must surface state_line.status=provisional; got ${out.state_line.status}`,
    );
    const primary = out.actions[0];
    assert(
      primary.disabled === true && !!primary.disabled_reason,
      scenarioId,
      "4",
      `provisional sendable must disable primary action with a reason; got disabled=${primary.disabled} reason='${primary.disabled_reason}'`,
    );
  }

  // Invariant 5 · accept_risk_unavailable gating
  assert(
    out.flags.accept_risk_unavailable ===
      (out.mode === "blocked" && !policy.allow_accept_risk),
    scenarioId,
    "5",
    `accept_risk_unavailable=${out.flags.accept_risk_unavailable} disagrees with (blocked && !allow_accept_risk)`,
  );
  if (expectations.acceptRiskUnavailable !== undefined) {
    assert(
      out.flags.accept_risk_unavailable === expectations.acceptRiskUnavailable,
      scenarioId,
      "5",
      `expected accept_risk_unavailable=${expectations.acceptRiskUnavailable} got ${out.flags.accept_risk_unavailable}`,
    );
  }

  // Invariant 6 · allow_override semantics
  if (out.mode === "blocked") {
    assert(
      out.flags.override_unavailable === !policy.allow_override,
      scenarioId,
      "6",
      `blocked mode: flags.override_unavailable=${out.flags.override_unavailable} should equal !policy.allow_override=${!policy.allow_override}`,
    );
    const overrideAction = out.actions.find(
      (a) =>
        a.kind === "override_unavailable" || a.kind === "request_override",
    );
    if (policy.allow_override) {
      assert(
        overrideAction?.kind === "request_override",
        scenarioId,
        "6",
        `allow_override=true expects 'request_override' action; got '${overrideAction?.kind}'`,
      );
    } else {
      assert(
        overrideAction?.kind === "override_unavailable",
        scenarioId,
        "6",
        `allow_override=false expects 'override_unavailable' action; got '${overrideAction?.kind}'`,
      );
      assert(
        overrideAction.disabled === true,
        scenarioId,
        "6",
        `override_unavailable action must be disabled (inert)`,
      );
    }
  }
  if (expectations.overrideUnavailable !== undefined) {
    assert(
      out.flags.override_unavailable === expectations.overrideUnavailable,
      scenarioId,
      "6",
      `expected flags.override_unavailable=${expectations.overrideUnavailable} got ${out.flags.override_unavailable}`,
    );
  }

  // Invariant 7 · calculating_suggestion fallback
  const calcAction = out.actions.find(
    (a) => a.kind === "calculating_suggestion",
  );
  if (calcAction) {
    assert(
      calcAction.disabled === true,
      scenarioId,
      "7",
      `calculating_suggestion action must be disabled (inert)`,
    );
    assert(
      calcAction.recommended === true,
      scenarioId,
      "7",
      `calculating_suggestion action takes the recommended slot during pending`,
    );
  }
  if (expectations.expectCalculatingSuggestion) {
    assert(
      !!calcAction,
      scenarioId,
      "7",
      `expected a calculating_suggestion action; none emitted`,
    );
  }

  // Invariant 7-B · suggestion_infeasible terminal-inert action
  // (CB Step 9 re-walk BUG-1 disposition). When the engine returns
  // null due to structural infeasibility (zero revenue / field bound
  // overflow), adapter flips QuoteInput.suggestion_infeasible=true;
  // classifier emits kind=suggestion_infeasible (disabled+recommended).
  const infeasibleAction = out.actions.find(
    (a) => a.kind === "suggestion_infeasible",
  );
  if (infeasibleAction) {
    assert(
      infeasibleAction.disabled === true,
      scenarioId,
      "7-B",
      `suggestion_infeasible action must be disabled (inert)`,
    );
    assert(
      infeasibleAction.recommended === true,
      scenarioId,
      "7-B",
      `suggestion_infeasible action takes the recommended slot`,
    );
  }
  if (expectations.expectSuggestionInfeasible) {
    assert(
      !!infeasibleAction,
      scenarioId,
      "7-B",
      `expected a suggestion_infeasible action; none emitted`,
    );
    assert(
      !calcAction,
      scenarioId,
      "7-B",
      `suggestion_infeasible expected; calculating_suggestion must not also fire`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────
// 14 scenarios per CD designer notes §6 + round-2 additions (§9)
// ──────────────────────────────────────────────────────────────────

// s01 · sendable vanilla — 5 SKUs × 5 tiers, all above target
runScenario(
  "s01_sendable_vanilla",
  quote({
    margins: Array(5).fill([0.4, 0.42, 0.45, 0.48, 0.5]),
  }),
  POLICY,
  { mode: "sendable", stateLineStatus: "sendable" },
);

// s02 · sendable headroom — high blended (50%+); no headroom callout
runScenario(
  "s02_sendable_headroom",
  quote({
    margins: Array(5).fill([0.52, 0.54, 0.55, 0.56, 0.58]),
  }),
  POLICY,
  { mode: "sendable", stateLineStatus: "sendable" },
);

// s03 · sendable 2-tier — minimal viable layout
runScenario(
  "s03_sendable_2tier",
  quote({
    margins: Array(3).fill([0.4, 0.45]),
  }),
  POLICY,
  { mode: "sendable", stateLineStatus: "sendable" },
);

// s04 · suggestion_led surgical — exactly 1 tier below target
runScenario(
  "s04_suggestion_surgical",
  quote({
    margins: Array(3).fill([0.3, 0.42, 0.45]),
    suggestions: {
      surgical: { tier_id: 1, lift_pct: 0.05, new_margin: 0.36 },
    },
  }),
  POLICY,
  { mode: "suggestion_led", stateLineStatus: "review" },
);

// s05 · suggestion_led global — 3 tiers below target → global wins
runScenario(
  "s05_suggestion_global",
  quote({
    margins: Array(3).fill([0.3, 0.31, 0.32, 0.45]),
    suggestions: {
      global: { lift_pct: 0.05, new_blended: 0.38 },
    },
  }),
  POLICY,
  { mode: "suggestion_led", stateLineStatus: "review" },
);

// s06 · blocked one tier — full state card; suggestion present
runScenario(
  "s06_blocked_one_tier",
  quote({
    margins: Array(3).fill([0.2, 0.4, 0.45]),
    suggestions: {
      surgical: { tier_id: 1, lift_pct: 0.1, new_margin: 0.3 },
    },
  }),
  POLICY,
  { mode: "blocked", stateLineStatus: "blocked" },
);

// s07 · blocked per-SKU diversity — worst SKU dominates
runScenario(
  "s07_blocked_per_sku_diversity",
  quote({
    margins: [
      [0.1, 0.2, 0.25],
      [0.4, 0.45, 0.5],
      [0.4, 0.45, 0.5],
    ],
    suggestions: {
      surgical: { tier_id: 1, lift_pct: 0.15, new_margin: 0.3 },
    },
  }),
  POLICY,
  { mode: "blocked", stateLineStatus: "blocked" },
);

// s08 · blocked accept-risk — accept_risk_unavailable banner
runScenario(
  "s08_blocked_accept_risk",
  quote({
    margins: Array(3).fill([0.18, 0.4, 0.45]),
    suggestions: {
      surgical: { tier_id: 1, lift_pct: 0.1, new_margin: 0.3 },
    },
  }),
  { ...POLICY, allow_accept_risk: false },
  {
    mode: "blocked",
    stateLineStatus: "blocked",
    acceptRiskUnavailable: true,
  },
);

// s09 · sendable over-client-target — flag composes with sendable
runScenario(
  "s09_sendable_over_client_target",
  quote({
    margins: Array(3).fill([0.45, 0.48, 0.5]),
    clientTargets: [9, 9, 9], // sell_unit=10 > client_target=9 → over
  }),
  POLICY,
  { mode: "sendable", stateLineStatus: "sendable" },
);

// s10 · provisional missing raws — one cell missing on otherwise-sendable
runScenario(
  "s10_provisional_missing_raws",
  quote({
    margins: Array(3).fill([0.45, 0.48, 0.5]),
    missingCells: [[0, 0]],
  }),
  POLICY,
  { mode: "sendable", stateLineStatus: "provisional" },
);

// s11 · post-surgical-applied (recovery) — same as s01 (no below-target tiers)
runScenario(
  "s11_post_surgical_applied",
  quote({
    margins: Array(5).fill([0.4, 0.42, 0.45, 0.48, 0.5]),
  }),
  POLICY,
  { mode: "sendable", stateLineStatus: "sendable" },
);

// s12 · suggestion_led + over-client-target — suggestion primary; over chip DETAIL only
runScenario(
  "s12_suggestion_over_client_target",
  quote({
    margins: Array(3).fill([0.3, 0.42, 0.45]),
    clientTargets: [9, 9, 9],
    suggestions: {
      surgical: { tier_id: 1, lift_pct: 0.05, new_margin: 0.36 },
    },
  }),
  POLICY,
  { mode: "suggestion_led", stateLineStatus: "review" },
);

// s13 · escalation-below-floor (mid-edit) — same shape as s06
runScenario(
  "s13_escalation_below_floor",
  quote({
    margins: Array(3).fill([0.2, 0.4, 0.45]),
    suggestions: {
      surgical: { tier_id: 1, lift_pct: 0.1, new_margin: 0.3 },
    },
  }),
  POLICY,
  { mode: "blocked", stateLineStatus: "blocked" },
);

// s14 · blocked no-override — policy disallows; override_unavailable inert
runScenario(
  "s14_blocked_no_override",
  quote({
    margins: Array(3).fill([0.2, 0.4, 0.45]),
    suggestions: {
      surgical: { tier_id: 1, lift_pct: 0.1, new_margin: 0.3 },
    },
  }),
  { ...POLICY, allow_override: false },
  {
    mode: "blocked",
    stateLineStatus: "blocked",
    overrideUnavailable: true,
  },
);

// Additional invariant-7 coverage: blocked mode WITHOUT a surgical
// suggestion must emit calculating_suggestion in the recommended slot
runScenario(
  "extra_blocked_no_suggestion",
  quote({
    margins: Array(3).fill([0.2, 0.4, 0.45]),
    // suggestions intentionally absent
  }),
  POLICY,
  {
    mode: "blocked",
    stateLineStatus: "blocked",
    expectCalculatingSuggestion: true,
  },
);

// Additional coverage: suggestion_led WITHOUT a matching suggestion
// (single-tier-below + no surgical) must emit calculating_suggestion
runScenario(
  "extra_suggestion_led_no_suggestion",
  quote({
    margins: Array(3).fill([0.3, 0.42, 0.45]),
    // suggestions absent — engine hasn't returned yet
  }),
  POLICY,
  {
    mode: "suggestion_led",
    stateLineStatus: "review",
    expectCalculatingSuggestion: true,
  },
);

// CB Step 9 re-walk BUG-1 — suggestion_infeasible coverage.
//
// extra_blocked_suggestion_infeasible: blocked mode + engine returned
// nothing usable (zero-revenue tiers or numeric overflow). Classifier
// must emit suggestion_infeasible (terminal inert), NOT
// calculating_suggestion (in-flight inert).
runScenario(
  "extra_blocked_suggestion_infeasible",
  quote({
    margins: Array(3).fill([0.2, 0.4, 0.45]),
    // suggestions absent because adapter knows engine returned null
    suggestionInfeasible: true,
  }),
  POLICY,
  {
    mode: "blocked",
    stateLineStatus: "blocked",
    expectSuggestionInfeasible: true,
  },
);

// extra_suggestion_led_suggestion_infeasible: suggestion-led mode with
// engine-infeasibility (rare — one tier below target but math overflow).
runScenario(
  "extra_suggestion_led_suggestion_infeasible",
  quote({
    margins: Array(3).fill([0.3, 0.42, 0.45]),
    suggestionInfeasible: true,
  }),
  POLICY,
  {
    mode: "suggestion_led",
    stateLineStatus: "review",
    expectSuggestionInfeasible: true,
  },
);

// ──────────────────────────────────────────────────────────────────
// Report
// ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error("✗ pricing-classifier invariant verifier FAILED");
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log(
  "✓ pricing-classifier invariants verified across 18 scenarios (s01-s14 + 4 extras)",
);
