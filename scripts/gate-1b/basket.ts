/**
 * The one definition of the S-7 preservation basket.
 *
 * Extracted for the same reason `canonical-digest.ts` was: the capture script
 * and the verifier must agree on which quotes are measured, and two copies of a
 * selection rule drift into a difference that reads exactly like a commercial
 * regression and is not one. That is the most expensive possible shape of bug
 * for a preservation check, because it manufactures the failure the check
 * exists to detect.
 *
 * ── WHY A NAMESPACE IS EXCLUDED ──────────────────────────────────────────────
 *
 * S-7 is a PRESERVATION invariant: every commercial scalar is byte-identical to
 * the value captured before the node graph existed. A quote can serve that only
 * if it holds still.
 *
 * Validation quotes are the opposite by design — they are instruments, created
 * to be driven through workflows and mutated. `ZZ-VALIDATION-tier-propagation`
 * exists, in its own words, as a *"DISPOSABLE VALIDATION ARTIFACT — do not use
 * for commercial work"*. It cannot simultaneously be a stable reference. AM-005
 * records two separate occasions on which it moved, three hours apart, each
 * time reported by S-7 as a commercial number moving — true, and silent about
 * the software.
 *
 * The condition that made this reachable is standing, not incidental: dev and
 * prod share one Supabase project (see CLAUDE.md), so hand-made validation
 * scenarios live in production because there is nowhere else to put them, and
 * the basket is a QUERY rather than a list, so each one joins the release's
 * governing evidence automatically and silently.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 *
 * Not an ID exclusion. Excluding `52bd0077…` would fix the instance and leave
 * the mechanism — the next validation quote joins the basket the moment it is
 * created. The namespace is the governed unit, and it is already a convention
 * the estate follows.
 *
 * Not a weakening of the comparison. Every quote that remains is compared
 * exactly as before, at full float precision, against its captured digest.
 * Excluding a mutable instrument from a preservation basket makes the remaining
 * comparison MEAN something; it does not make it looser.
 *
 * Not a re-baseline. `docs/gate-1b/costing-baseline.json` is untouched. The
 * excluded quote's captured entry stays on disk exactly as recorded — it is
 * simply not consulted, on either side.
 */

import { sql, type SQL } from "drizzle-orm";

/**
 * The governed validation namespace.
 *
 * A quote whose `scenario_label` starts with this is an instrument, not a
 * reference. The convention predates this exclusion; this is the first place
 * that gives it force.
 */
export const VALIDATION_NAMESPACE = "ZZ-VALIDATION-";

/** Whether a scenario label names a validation instrument. */
export function isValidationInstrument(scenarioLabel: string | null | undefined): boolean {
  return typeof scenarioLabel === "string" && scenarioLabel.startsWith(VALIDATION_NAMESPACE);
}

/**
 * The basket predicate, for the `where` clause of both scripts' selection.
 *
 * Structure-bearing quotes, minus the validation namespace. `IS DISTINCT FROM`
 * semantics are handled by `NOT LIKE` returning NULL for a NULL label, so the
 * null-guard is explicit rather than accidental: a quote with no scenario label
 * is a real quote and stays in.
 */
export function basketPredicate(): SQL {
  return sql`
    exists (
      select 1 from assemblies a
       join assembly_leaves al on al.assembly_id = a.id
      where a.quote_id = q.id
    )
    and (q.scenario_label is null or q.scenario_label not like ${VALIDATION_NAMESPACE + "%"})
  `;
}

/**
 * Whether a baseline ENTRY belongs to the current basket.
 *
 * The exclusion has to apply to both sides or the verifier reports the excluded
 * quote as "in baseline, absent now — coverage silently shrank", which is the
 * same red under a different heading.
 *
 * Checked against the recorded label rather than against a live lookup, so an
 * excluded quote that is later deleted outright still resolves correctly. Entry
 * labels are `"{deal name} / {scenario label}"`; the scenario half is what the
 * namespace applies to, so an unlucky deal name cannot exclude a real quote.
 */
export function baselineEntryInBasket(label: string): boolean {
  const scenario = label.includes(" / ") ? label.slice(label.lastIndexOf(" / ") + 3) : label;
  return !isValidationInstrument(scenario);
}
