/**
 * O5 · the spec comparator, used at EVERY boundary.
 *
 * One comparator, one expectation. Each lifecycle boundary reads its own copy
 * of the specifications and hands it here, and the comparison is always against
 * `o5-expected.ts` — never against the previous boundary. Comparing each stage
 * to the one before it proves only that the chain is self-consistent; a value
 * that drifts at stage 2 would then be "correct" at every stage after it.
 *
 * ── WHAT IT CHECKS, AND WHY EACH ONE IS SEPARATE ────────────────────────
 *
 * MISSING vs BLANK is the distinction the whole thing turns on. A key that is
 * absent, a key present with an empty string, and a key present with the
 * em-dash placeholder are three different states, and only one of them is what
 * an intentional blank is supposed to become. Collapsing them is exactly the
 * failure the three deliberate blanks exist to catch, so the comparator
 * reports them as distinct kinds rather than as one "no value" bucket.
 *
 * EXTRA keys matter too: a boundary that invents a field — a default filled
 * in, a library value inherited, a placeholder materialised — is as wrong as
 * one that drops a field, and is much easier to miss because nothing looks
 * empty.
 */
import { O5_PP_SPEC, O5_SP_SPEC, O5_TP_SPEC, O5_INTENTIONAL_BLANKS, O5_NUMERIC_FIELD } from "./o5-expected.ts";

export const O5_EXPECTED_ALL: Record<string, string> = {
  ...O5_PP_SPEC,
  ...O5_SP_SPEC,
  ...O5_TP_SPEC,
};

export type SpecFinding = {
  kind: "missing" | "extra" | "value_mismatch" | "blank_filled" | "populated_blanked" | "placeholder_for_blank";
  key: string;
  expected?: string;
  actual?: string;
};

/**
 * `actual` is the boundary's own view. Pass the values EXACTLY as that
 * boundary holds them — do not normalise, trim or coerce on the way in, or the
 * comparator stops being able to see the thing it is looking for.
 */
export function compareSpecs(
  actual: Record<string, unknown>,
  opts?: { subset?: readonly string[] },
): SpecFinding[] {
  const findings: SpecFinding[] = [];
  const keys = opts?.subset ?? Object.keys(O5_EXPECTED_ALL);
  const blanks = new Set<string>(O5_INTENTIONAL_BLANKS);

  for (const key of keys) {
    const exp = O5_EXPECTED_ALL[key];
    const has = Object.prototype.hasOwnProperty.call(actual, key);
    const raw = actual[key];
    const isBlankExpected = blanks.has(key);

    // An intentional blank may legitimately be absent OR empty — a spec store
    // that omits empty keys is not wrong. What it must never be is populated,
    // and it must never be the em-dash the UI renders for "nothing here": that
    // string is a PRESENTATION of absence, and persisting it would make the
    // placeholder into data.
    if (isBlankExpected) {
      if (!has || raw === null || raw === undefined || raw === "") continue;
      const s = String(raw);
      if (s === "—" || s === "-" || s.trim() === "") {
        findings.push({ kind: "placeholder_for_blank", key, actual: s });
        continue;
      }
      findings.push({ kind: "blank_filled", key, expected: "", actual: s });
      continue;
    }

    if (!has || raw === null || raw === undefined) {
      findings.push({ kind: "missing", key, expected: exp });
      continue;
    }
    if (raw === "") {
      findings.push({ kind: "populated_blanked", key, expected: exp, actual: "" });
      continue;
    }
    // The numeric field is compared as a STRING on purpose. Whether it
    // round-trips as 24, "24" or 24.0 is part of what O5 certifies, and
    // coercing here would hide a change of form.
    const s = String(raw);
    if (s !== exp) findings.push({ kind: "value_mismatch", key, expected: exp, actual: s });
  }

  if (!opts?.subset) {
    for (const key of Object.keys(actual)) {
      if (!(key in O5_EXPECTED_ALL)) {
        findings.push({ kind: "extra", key, actual: String(actual[key]) });
      }
    }
  }
  return findings;
}

export function reportSpecs(label: string, actual: Record<string, unknown>): boolean {
  const findings = compareSpecs(actual);
  const present = Object.keys(O5_EXPECTED_ALL).filter((k) => {
    const v = actual[k];
    return v !== undefined && v !== null && v !== "";
  }).length;

  console.log(`\n── ${label} ──`);
  console.log(`  keys expected   ${Object.keys(O5_EXPECTED_ALL).length}  (28 populated + 3 intentional blanks)`);
  console.log(`  keys populated  ${present}`);
  const numeric = actual[O5_NUMERIC_FIELD];
  console.log(`  ${O5_NUMERIC_FIELD}  ${JSON.stringify(numeric)}  (typeof ${typeof numeric})`);
  for (const b of O5_INTENTIONAL_BLANKS) {
    const v = actual[b];
    const state = !(b in actual) ? "absent" : v === "" ? "empty string" : v === null ? "null" : `PRESENT: ${JSON.stringify(v)}`;
    console.log(`  blank ${b.padEnd(16)} ${state}`);
  }
  if (findings.length === 0) {
    console.log(`  RESULT          MATCHES THE PRE-AUTHORED EXPECTATION`);
    return true;
  }
  console.log(`  RESULT          ${findings.length} DISCREPANCIES`);
  for (const f of findings) {
    console.log(`    [${f.kind}] ${f.key}`);
    if (f.expected !== undefined) console.log(`       expected ${JSON.stringify(f.expected)}`);
    if (f.actual !== undefined) console.log(`       actual   ${JSON.stringify(f.actual)}`);
  }
  return false;
}
