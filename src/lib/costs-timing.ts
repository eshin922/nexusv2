/**
 * Costs write-to-render timing instrumentation.
 *
 * TEMPORARY — environment-gated measurement for the Costs Plumbing
 * Certification (Section 4, nine-action responsiveness audit). Remove once the
 * audit is closed and the responsiveness verdict is recorded.
 *
 * ---------------------------------------------------------------------------
 * Why a shared helper rather than per-surface marks
 * ---------------------------------------------------------------------------
 *
 * The audit has to distinguish three different explanations for a slow edit:
 *
 *   1. a Freight-specific problem
 *   2. a shared Costs-provider problem
 *   3. a broader deployed-performance baseline
 *
 * Those are only separable if Packaging, Production and Freight report the
 * SAME stages measured the SAME way. Per-surface ad-hoc marks would produce
 * three incomparable sets of numbers and could not settle the question.
 *
 * ---------------------------------------------------------------------------
 * Stages
 * ---------------------------------------------------------------------------
 *
 *   submit            operator input committed; the clock starts
 *   action start      inside the transition, before the server action
 *   action complete   server action resolved — persistence is done
 *   refresh coalesced a pending reconciliation was cancelled and re-armed
 *                     (emitted only where coalescing exists; its ABSENCE on a
 *                     burst is itself the amplification signal)
 *   refresh start     reconciliation actually dispatched
 *   browser update    fired on the next animation frame, so it reports when
 *                     the operator can READ the value, not when a promise
 *                     resolved
 *
 * ---------------------------------------------------------------------------
 * Gating
 * ---------------------------------------------------------------------------
 *
 * Enabled outside production. Vercel sets NEXT_PUBLIC_VERCEL_ENV to
 * "production" | "preview" | "development", so preview deployments — where the
 * audit runs — emit, while production stays silent. Local dev emits because the
 * var is absent.
 *
 * Deliberately NOT gated on NODE_ENV: preview builds run NODE_ENV=production,
 * which would silence exactly the environment being measured.
 */

const ENABLED = process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";

export type CostsTimingStage =
  | "submit"
  | "action start"
  | "action complete"
  | "refresh coalesced"
  | "refresh start"
  | "browser update";

export type CostsTimingMark = (stage: CostsTimingStage) => void;

/**
 * Start a timing span for one operator action.
 *
 * @param surface  "packaging" | "production" | "freight" — the audit groups by
 *                 this, so it must match across surfaces.
 * @param action   the specific mutation, e.g. "tier-cost", "markup",
 *                 "duty-tariff", "create-shipment". Distinguishes the nine
 *                 audited actions within a surface.
 *
 * Returns a no-op in production, so call sites need no conditional.
 */
export function startCostsTiming(
  surface: "packaging" | "production" | "freight",
  action: string,
): CostsTimingMark {
  if (!ENABLED) return () => {};
  const t0 = performance.now();
  return (stage) => {
    const ms = (performance.now() - t0).toFixed(0);
    // Single-line, fixed-width, greppable: `[costs-timing]` collects the whole
    // audit from one console filter across all three surfaces.
    console.log(
      `[costs-timing] ${surface.padEnd(10)} ${action.padEnd(18)} ${stage.padEnd(18)} ${ms.padStart(6)} ms`,
    );
  };
}
