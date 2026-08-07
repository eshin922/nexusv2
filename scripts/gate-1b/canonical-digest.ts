/**
 * The one canonicaliser the S-7 baseline is computed with.
 *
 * Extracted because it was briefly duplicated, and the copy silently omitted
 * the number branch. Every digest then differed, which reads exactly like a
 * commercial regression and is not one — the most expensive possible shape of
 * bug for a preservation check, since it manufactures the failure the check
 * exists to detect.
 *
 * Any script comparing against the baseline imports THIS. A second
 * implementation of a hash function is a second implementation, and the whole
 * of Gate 1B is an argument against those.
 */

/** Stable stringify: key order must not depend on object construction order. */
export function canonical(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? v.toPrecision(17) : String(v);
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
