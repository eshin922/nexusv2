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
 * The governed disposable-instrument namespace.
 *
 * ── WHY THIS WIDENED (Step 0, 2026-09-08) ────────────────────────────────
 *
 * The rule was `scenario_label LIKE 'ZZ-VALIDATION-%'`. Measured against the
 * live estate it excluded THREE quotes while FOURTEEN instruments sat in the
 * basket, because the convention had moved: instruments are now named at the
 * DEAL level (`ZZ-VALIDATION — Soak Lineage VIII`) with scenario labels like
 * `ZZ-SOAK-run-7`, `CERT-300 frozen line set`, `UAT-1 direct product`. None of
 * those matches a scenario-label prefix of `ZZ-VALIDATION-`.
 *
 * This is exactly the mechanism the original exclusion was written to prevent
 * — "the next validation quote joins the basket the moment it is created" —
 * reaching the basket through a naming route the rule did not cover.
 *
 * So the prefix is now `ZZ-`, the estate's standing marker for a disposable
 * artifact, and it is checked on BOTH the deal name and the scenario label.
 * One prefix covers `ZZ-VALIDATION` and `ZZ-SOAK` together and does not need
 * revisiting when the next instrument family appears.
 *
 * `TRAINING` is deliberately NOT excluded. The O1-O5 corpus is frozen and
 * certified; a complete quote that will never move again is the BEST kind of
 * preservation reference, not an instrument.
 */
export const INSTRUMENT_PREFIX = "ZZ-";

/**
 * The DEAL-side marker, deliberately narrower than the scenario-side one.
 *
 * ── THE TRADE, MADE ON MEASUREMENT ───────────────────────────────────────
 *
 * A prior decision held that "a deal name is customer data and cannot be
 * allowed to decide basket membership", guarding against a real customer whose
 * name happens to start with the marker being silently dropped from
 * preservation coverage. That concern is sound and is why this is not simply
 * `ZZ-`.
 *
 * What that decision did not have was the measurement. FOURTEEN instruments
 * were sitting in the basket because the convention had moved to the deal
 * level, and the scenario-only rule was excluding three quotes. Against that,
 * a census of all 46 projects finds ZERO real customer deals beginning `ZZ-`:
 * the 16 that match are eleven `ZZ-VALIDATION` instrument deals and five
 * `TRAINING ·` corpus deals matched only on their CLIENT name.
 *
 * So the rule takes the full `ZZ-VALIDATION` rather than bare `ZZ-`. A
 * customer genuinely named `ZZ-VALIDATION…` would still be excluded, and that
 * residual is accepted knowingly rather than by omission — if one ever
 * appears, this is the line to revisit.
 *
 * `client_name` is NOT consulted. The TRAINING corpus carries the validation
 * customer as its client, and excluding on that would drop the five certified
 * O1-O5 quotes, which are the best references in the estate.
 */
export const DEAL_INSTRUMENT_PREFIX = "ZZ-VALIDATION";

/** Retained for callers that import it; the meaning is unchanged. */
export const VALIDATION_NAMESPACE = "ZZ-VALIDATION-";

/**
 * Whether a deal name or scenario label names a disposable instrument.
 *
 * Either half is sufficient: the deal carries the namespace for the soak and
 * certification lineages, the scenario carries it for the older standalone
 * instruments.
 */
export function isValidationInstrument(
  scenarioLabel: string | null | undefined,
  dealName?: string | null | undefined,
): boolean {
  const scenario =
    typeof scenarioLabel === "string" && scenarioLabel.startsWith(INSTRUMENT_PREFIX);
  // The DEAL rule is narrower than the scenario rule on purpose -- see
  // DEAL_INSTRUMENT_PREFIX for the trade it makes and why.
  const deal = typeof dealName === "string" && dealName.startsWith(DEAL_INSTRUMENT_PREFIX);
  return scenario || deal;
}

/**
 * Quote statuses eligible to serve as a preservation reference.
 *
 * ── WHY MUTABILITY IS A BASKET RULE, NOT A FAILURE TO TRIAGE ─────────────
 *
 * A draft is MEANT to change. HARNESS-1 recorded eight failures on unmodified
 * `main` from four drafts and called them benign, which they were — but a
 * check whose red state is routinely benign teaches the reader to discount it,
 * and that is the whole value of a preservation gate.
 *
 * OD-013 records the sharper version: an operator entering costs while an
 * increment was in flight moved `blendedMarginPct 0.1847 -> 0.2275`, and the
 * instrument could not, on its own, distinguish that from an engine
 * regression. Excluding drafts removes the entire class rather than paying a
 * manual bisect each time it recurs.
 *
 * Immutability here is not a convention. `assertNotFrozen` and the Pattern 52
 * draft-lock make a sent, accepted or complete quote's own cost data
 * unwritable, so these rows hold still by construction.
 *
 * What this does NOT do is make the remaining comparison looser: every quote
 * that stays is compared exactly as before, at full float precision.
 */
export const REFERENCE_STATUSES = ["sent", "accepted", "complete"] as const;

/** Whether a quote status can serve as a preservation reference. */
export function isReferenceStatus(status: string | null | undefined): boolean {
  return (REFERENCE_STATUSES as readonly string[]).includes(String(status));
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
    and (q.scenario_label is null or q.scenario_label not like ${INSTRUMENT_PREFIX + "%"})
    and not exists (
      -- SELF-CONTAINED, deliberately. A first version read "p.deal_name"
      -- directly; the capture script joins "projects p" and the verifier does
      -- not, so it would have failed at runtime in one caller and not the
      -- other -- and tsc cannot see inside a SQL template to say so. A
      -- shared predicate that depends on the caller's FROM clause is the same
      -- two-copies hazard this file exists to remove.
      select 1 from projects pr
       where pr.id = q.project_id
         and pr.deal_name like ${DEAL_INSTRUMENT_PREFIX + "%"}
    )
    and q.status::text = any(${sql.raw(
      `ARRAY[${REFERENCE_STATUSES.map((s) => `'${s}'`).join(",")}]`,
    )})
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
export function baselineEntryInBasket(label: string, status?: string | null): boolean {
  const i = label.lastIndexOf(" / ");
  const scenario = i >= 0 ? label.slice(i + 3) : label;
  const deal = i >= 0 ? label.slice(0, i) : "";
  if (isValidationInstrument(scenario, deal)) return false;
  // `status` is optional so a caller that has not been updated still gets the
  // namespace half rather than a type error -- but the verifier DOES pass it,
  // and it must, or the two sides disagree about drafts and every excluded
  // draft is reported as "in baseline, absent now".
  if (status !== undefined && !isReferenceStatus(status)) return false;
  return true;
}
