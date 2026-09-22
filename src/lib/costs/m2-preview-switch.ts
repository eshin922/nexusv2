/**
 * The M2 read-only Costs preview switch.
 *
 * ── WHY A URL PARAMETER AND NOT AN ENVIRONMENT FLAG ───────────────────────
 *
 * M2 is a LABELLED MILESTONE PREVIEW, not a rollout. The switch has to satisfy
 * three properties at once, and only one mechanism satisfies all three:
 *
 *   1. DISABLED BY DEFAULT. Absent parameter means the original workspace, so
 *      every existing link, bookmark and redirect keeps its current behaviour
 *      with no migration and no deployment step.
 *   2. DISABLING RESTORES THE CURRENT UI WITH NO DATA CHANGE. Nothing about the
 *      preview is persisted — not a column, not a cookie, not a setting — so
 *      "turn it off" is "remove a query parameter", and there is no state left
 *      behind that an old reader would have to understand. That is the rollback
 *      property the staged plan asks for at M2, made structural rather than
 *      promised.
 *   3. NO ENVIRONMENT OR CREDENTIAL CHANGE. The bounded pass forbids both.
 *
 * A per-quote or per-user persisted preference would fail (2) and (3): it is a
 * written fact, and the old writer has no idea what it means.
 *
 * ── WHY THE VALUE IS NAMED RATHER THAN A BOOLEAN ──────────────────────────
 *
 * `?preview=1` cannot survive a second preview. The milestone is named in the
 * value so a later one is additive and an unrecognised value falls through to
 * the original workspace rather than to whichever preview happened to ship
 * last.
 */

/** The query parameter. Shared with every link builder so it is stated once. */
export const COSTS_PREVIEW_PARAM = "preview";

/** The one recognised value in this pass. */
export const COSTS_M2_PREVIEW_VALUE = "costs-m2";

/** M3 adds existing writers without changing the reviewed read-only M2 route. */
export const COSTS_M3_PREVIEW_VALUE = "costs-m3";

/**
 * What the parameter can arrive as from Next's `searchParams`.
 *
 * Repeated parameters arrive as an array. A caller that only handled `string`
 * would silently read `undefined` for `?preview=x&preview=costs-m2`, which is a
 * switch that is off for a reason nobody can see.
 */
export type PreviewParam = string | string[] | undefined;

/**
 * Is the M2 preview requested?
 *
 * FAILS CLOSED. Anything that is not exactly the recognised value — absent,
 * empty, misspelled, a different milestone — returns false and the original
 * workspace renders. A preview that appeared on an unrecognised value would be
 * a surface an operator could reach by accident.
 */
export function isCostsM2PreviewEnabled(value: PreviewParam): boolean {
  if (value === undefined) return false;
  const values = Array.isArray(value) ? value : [value];
  return values.some((v) => v === COSTS_M2_PREVIEW_VALUE);
}

/** The M3 editable preview is independently opt-in and also fails closed. */
export function isCostsM3PreviewEnabled(value: PreviewParam): boolean {
  if (value === undefined) return false;
  const values = Array.isArray(value) ? value : [value];
  return values.some((v) => v === COSTS_M3_PREVIEW_VALUE);
}

/**
 * The href that turns the preview on or off, preserving every other parameter.
 *
 * Preserving the rest is not a nicety: `section` and the active tier both live
 * in the query string, and dropping them on the way into the preview would make
 * entering it look like it had reset the operator's place. Leaving the preview
 * has to land them back where they were.
 */
export function costsPreviewHref(
  pathname: string,
  current: URLSearchParams | Record<string, PreviewParam>,
  enabled: boolean,
): string {
  const next =
    current instanceof URLSearchParams
      ? new URLSearchParams(current)
      : recordToParams(current);
  if (enabled) next.set(COSTS_PREVIEW_PARAM, COSTS_M2_PREVIEW_VALUE);
  else next.delete(COSTS_PREVIEW_PARAM);
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function recordToParams(
  record: Record<string, PreviewParam>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  return params;
}
