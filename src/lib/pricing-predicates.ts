// Pricing surface — canonical tier-margin-vs-policy predicates.
//
// Originally extracted from pricing-suggestions.ts (Bug #D round-2
// fix) on 2026-05-19. Pricing-reframe consumers retired during
// slice-pricing-surface-redesign Step 8 tear-down; this module
// stays as the canonical predicate library for the surfaces below.
//
// Surfaces consuming this module:
//   - src/lib/pricing-suggestions.ts        — suggestion engine
//                                              ranking + filtering
//   - src/lib/pricing-classifier.ts         — Pricing surface
//                                              redesign single-
//                                              source classifier
//                                              (mode + per-cell
//                                              status; consumed by
//                                              STATE/ACTION/DETAIL
//                                              zone components)
//
// Forward consumers (banked for awareness): Phase A.1 v2 spec entry
// completeness chips, Quote umbrella Tier Selection sub-tab health
// summary.
//
// **Tolerance rationale (TARGET_TOLERANCE = 0.001):**
//
// Display rounds tier margin to 1 decimal place (e.g., raw
// 39.99997% renders as "40.0%"). Without tolerance, the < predicate
// flags such a tier as below-target despite reading at-target —
// suggestion engine proposes a +0.0% lift; PM clicks Apply
// indefinitely; audit log accumulates noise; quote stuck in
// "TIER RISK" verdict copy.
//
// Tolerance of 0.001 (0.1%) sits one decimal beyond display
// precision. Effect:
//   - Tier displaying "40.0%" cannot be flagged below — raw value
//     would need to be < 39.9% (display "39.9%") to qualify.
//   - Tier displaying "39.9%" CAN still be flagged below-target.
//     Real below-target signal preserved.
//
// Tolerance is a starting point; if CB re-smoke surfaces edge cases
// on real data, calibrate up/down. Banked as v1 measurement item.

export const TARGET_TOLERANCE = 0.001;

export function isBelowTarget(marginPct: number, target: number): boolean {
  return marginPct < target - TARGET_TOLERANCE;
}

export function isBelowFloor(marginPct: number, floor: number): boolean {
  return marginPct < floor - TARGET_TOLERANCE;
}
