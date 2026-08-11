/**
 * The current payload, restricted to the SHAPE the baseline captured.
 *
 * A-1 draws the line at *exposing computation structure is permitted, changing
 * an existing number is not*, and the raw digest cannot see that line: a key the
 * baseline never held has no captured scalar to be identical to, but it changes
 * the hash exactly as a moved value would. P3-017 published five new per-tier
 * quantities and every quote in the basket reported FAIL for
 * `sellBeforeAdjustmentPerUnit: null -> <value>` — an ADDITION, read as a
 * movement because `canonical(undefined)` and `canonical(null)` are the same
 * string.
 *
 * So the comparison is made against the baseline's own key set. Every scalar it
 * captured is still compared byte-for-byte at full float precision; keys it
 * never held are set aside and REPORTED, never silently dropped. A key the
 * baseline holds and the payload no longer does survives projection as
 * `undefined` and fails, which is correct — a captured scalar disappearing is
 * not an addition.
 *
 * This is not a re-baseline. Nothing on disk changes, and no current value is
 * ever accepted as a new reference.
 */
export function projectOntoBaseline(base: unknown, cur: unknown, added: string[], path = ""): unknown {
  if (base === null || typeof base !== "object" || cur === null || typeof cur !== "object") {
    return cur;
  }
  if (Array.isArray(base) !== Array.isArray(cur)) return cur;
  if (Array.isArray(base) && Array.isArray(cur)) {
    // A length change is a shape change, not an addition. Left intact so
    // `firstDifference` reports it.
    if (base.length !== cur.length) return cur;
    return base.map((b, i) => projectOntoBaseline(b, cur[i], added, `${path}[${i}]`));
  }
  const bo = base as Record<string, unknown>;
  const co = cur as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(bo)) {
    out[k] = projectOntoBaseline(bo[k], co[k], added, path ? `${path}.${k}` : k);
  }
  for (const k of Object.keys(co)) {
    if (!(k in bo)) added.push(path ? `${path}.${k}` : k);
  }
  return out;
}

