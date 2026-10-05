/**
 * The outward projection of a FROZEN ordered specification. A LEAF module: no
 * database, no `server-only`, no NetSuite client — so the rule that decides
 * what leaves Nexus can be proven on its own.
 *
 * ── WHAT IS WITHHELD, AND WHERE THE RULE LIVES ───────────────────────────
 *
 * Approved disclosure decision, 2026-10-05: every frozen spec value of a Sales
 * Order product line goes to NetSuite EXCEPT `fm_actives` (Actives / reference
 * formula), which stays in Nexus pending a separate disclosure decision.
 *
 * That rule lives HERE and only here. Every outward surface — the NetSuite
 * ordered-spec record, its readable text, and the Order Packet a NetSuite user
 * reaches by link — takes its values through `redactWithheldSpecValues`, so
 * there is no second list to fall out of step. Adding a key to
 * `WITHHELD_SPEC_KEYS` withholds it everywhere at once.
 *
 * Errors and diagnostics name KEYS, never values. A refusal message that quoted
 * the offending value would leak exactly what the refusal protects.
 *
 * ── TWO HASHES, TWO DIFFERENT CLAIMS ─────────────────────────────────────
 *
 *   sourceHash  the frozen row's own `content_hash`, re-verified here against
 *               its values. Identifies WHICH frozen specification this is
 *               without copying the withheld value. It does not prove the
 *               withheld value was exported — it was not.
 *   exportHash  the same canonical hash (`orderedSpecContentHash`) over the
 *               values ACTUALLY transmitted, with the same pinned product type
 *               and schema. What a NetSuite read-back must reproduce.
 *
 * When nothing is withheld the two are equal; when something is, they differ,
 * and the difference is recorded rather than hidden.
 */
import type { FrozenSpecDisposition } from "@/lib/ordered-spec-disposition";
import { canonicalize, orderedSpecContentHash } from "@/lib/ordered-spec-hash";

/**
 * Version of the allowlist/redaction and empty-value rules. A change here
 * changes what an already-posted NetSuite record would contain, so it requires
 * an explicit migration plan for posted records — never a silent bump.
 */
export const ORDERED_SPEC_PROJECTION_VERSION = "nx-ordered-spec-projection/1";

/** Keys that never leave Nexus on any outward surface. */
export const WITHHELD_SPEC_KEYS: readonly string[] = ["fm_actives"];

const WITHHELD = new Set(WITHHELD_SPEC_KEYS);

/** Present and meaningful: not null/undefined and not whitespace-only text. */
function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

export type RedactedSpecValues = {
  /** The frozen values with every withheld key removed. */
  values: Record<string, unknown>;
  /**
   * Withheld keys that carried a value in the frozen row, sorted. Empty when
   * nothing meaningful was withheld — an empty or absent `fm_actives` is not a
   * redaction, and reporting it as one would claim a withheld fact exists.
   */
  redactedKeys: string[];
};

/** The single redaction rule. Every outward surface goes through this. */
export function redactWithheldSpecValues(
  values: Record<string, unknown> | null | undefined,
): RedactedSpecValues {
  const out: Record<string, unknown> = {};
  const redacted: string[] = [];
  for (const [k, v] of Object.entries(values ?? {})) {
    if (WITHHELD.has(k)) {
      if (hasValue(v)) redacted.push(k);
      continue;
    }
    out[k] = v;
  }
  return { values: out, redactedKeys: redacted.sort() };
}

export type SpecFieldDef = { key: string; label: string };

export type OrderedSpecProjectionInput = {
  disposition: FrozenSpecDisposition;
  specValues: Record<string, unknown> | null;
  productTypeId: string | null;
  specSchema: string | null;
  /** The frozen row's `content_hash`. */
  contentHash: string;
  /**
   * The pinned schema's fields, in display order. Required for `specified`;
   * ignored otherwise.
   */
  fields: SpecFieldDef[] | null;
};

export type OrderedSpecProjection = {
  projectionVersion: string;
  disposition: FrozenSpecDisposition;
  /**
   * True for `schema_pending`, `unmapped` and `no_type`: a posted product line
   * whose specification is NOT a governed answer. Exported as a status record
   * so it is visible in NetSuite, never as a specification.
   */
  exception: boolean;
  productTypeId: string | null;
  specSchema: string | null;
  /** Exported values, canonical (key-sorted). Never contains a withheld key. */
  values: Record<string, unknown>;
  redactedKeys: string[];
  /**
   * Keys present in the frozen row that were NOT exported because the
   * disposition is not `specified`. Keys only. Non-empty means someone authored
   * values on a product with no governed schema — surfaced, not silently lost.
   */
  unexportedKeys: string[];
  sourceHash: string;
  exportHash: string;
  /** "Label: value" lines for exported values, plus a withheld notice. */
  readable: string;
};

export type ProjectionRefusal =
  | { reason: "source_hash_mismatch" }
  | { reason: "schema_fields_missing" }
  | { reason: "keys_outside_schema"; keys: string[] }
  | { reason: "non_scalar_value"; keys: string[] };

export type ProjectionResult =
  | { ok: true; projection: OrderedSpecProjection }
  | { ok: false; refusal: ProjectionRefusal };

const EXCEPTION_DISPOSITIONS: ReadonlySet<FrozenSpecDisposition> = new Set([
  "schema_pending",
  "unmapped",
  "no_type",
]);

export const WITHHELD_NOTICE = "Formula reference withheld — held in Nexus";

function isScalar(v: unknown): boolean {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/**
 * Build the NetSuite projection of ONE frozen ordered specification.
 *
 * Refuses rather than repairs: a source hash that does not reproduce, a value
 * key outside the pinned schema, or a non-scalar value is a fact about the
 * source that someone has to look at. Dropping it quietly would export a
 * specification that differs from the one frozen, with no record of how.
 */
export function projectOrderedSpecForExport(
  input: OrderedSpecProjectionInput,
): ProjectionResult {
  const source = input.specValues ?? {};
  const recomputed = orderedSpecContentHash({
    specValues: source,
    productTypeId: input.productTypeId,
    specSchema: input.specSchema,
  });
  if (recomputed !== input.contentHash) {
    return { ok: false, refusal: { reason: "source_hash_mismatch" } };
  }

  const nonScalar = Object.keys(source).filter((k) => !isScalar(source[k])).sort();
  if (nonScalar.length > 0) {
    return { ok: false, refusal: { reason: "non_scalar_value", keys: nonScalar } };
  }

  const specified = input.disposition === "specified";
  let exported: Record<string, unknown> = {};
  let redactedKeys: string[] = [];
  let unexportedKeys: string[] = [];
  let readable = "";

  if (specified) {
    if (!input.fields || input.fields.length === 0) {
      return { ok: false, refusal: { reason: "schema_fields_missing" } };
    }
    const allowed = new Set(input.fields.map((f) => f.key));
    const outside = Object.keys(source).filter((k) => !allowed.has(k)).sort();
    if (outside.length > 0) {
      return { ok: false, refusal: { reason: "keys_outside_schema", keys: outside } };
    }
    const r = redactWithheldSpecValues(source);
    exported = r.values;
    redactedKeys = r.redactedKeys;

    const lines: string[] = [];
    for (const f of input.fields) {
      if (WITHHELD.has(f.key)) continue;
      const v = exported[f.key];
      if (hasValue(v)) lines.push(`${f.label}: ${String(v)}`);
    }
    if (redactedKeys.length > 0) lines.push(WITHHELD_NOTICE);
    readable = lines.join("\n");
  } else {
    // A non-`specified` row exports NO values, governed answer or not. Any
    // keys it carried are reported by name so the exception is visible.
    unexportedKeys = Object.keys(source).filter((k) => hasValue(source[k])).sort();
  }

  const values = canonicalize(exported) as Record<string, unknown>;
  const exportHash = orderedSpecContentHash({
    specValues: values,
    productTypeId: input.productTypeId,
    specSchema: input.specSchema,
  });

  return {
    ok: true,
    projection: {
      projectionVersion: ORDERED_SPEC_PROJECTION_VERSION,
      disposition: input.disposition,
      exception: EXCEPTION_DISPOSITIONS.has(input.disposition),
      productTypeId: input.productTypeId,
      specSchema: input.specSchema,
      values,
      redactedKeys,
      unexportedKeys,
      sourceHash: input.contentHash,
      exportHash,
      readable,
    },
  };
}

export type ReadBackComparison = { matches: true } | { matches: false; mismatched: string[] };

/**
 * Compare what NetSuite holds against what was projected. Every field the plan
 * names is compared; the export hash is RECOMPUTED from the read-back values
 * rather than trusted from the stored hash field, so a record whose JSON and
 * hash were both written wrongly cannot agree with itself.
 */
export function compareReadBack(
  expected: OrderedSpecProjection & { lineKey: string; itemId: string },
  observed: {
    lineKey: string | null;
    itemId: string | null;
    disposition: string | null;
    projectionVersion: string | null;
    sourceHash: string | null;
    exportHash: string | null;
    redactedKeys: string[] | null;
    valuesJson: string | null;
  },
): ReadBackComparison {
  const mismatched: string[] = [];
  const eq = (name: string, a: unknown, b: unknown) => {
    if (a !== b) mismatched.push(name);
  };
  eq("line_key", expected.lineKey, observed.lineKey);
  eq("item", expected.itemId, observed.itemId);
  eq("disposition", expected.disposition, observed.disposition);
  eq("projection_version", expected.projectionVersion, observed.projectionVersion);
  eq("source_hash", expected.sourceHash, observed.sourceHash);
  eq("export_hash", expected.exportHash, observed.exportHash);
  eq(
    "redacted_keys",
    JSON.stringify(expected.redactedKeys),
    JSON.stringify([...(observed.redactedKeys ?? [])].sort()),
  );

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = observed.valuesJson === null ? null : (JSON.parse(observed.valuesJson) as Record<string, unknown>);
  } catch {
    parsed = null;
  }
  if (parsed === null) {
    mismatched.push("values");
  } else {
    for (const k of Object.keys(parsed)) {
      if (WITHHELD.has(k)) mismatched.push("values_contain_withheld_key");
    }
    eq(
      "values",
      JSON.stringify(canonicalize(expected.values)),
      JSON.stringify(canonicalize(parsed)),
    );
    const rehash = orderedSpecContentHash({
      specValues: parsed,
      productTypeId: expected.productTypeId,
      specSchema: expected.specSchema,
    });
    eq("export_hash_recomputed", expected.exportHash, rehash);
  }
  return mismatched.length === 0 ? { matches: true } : { matches: false, mismatched };
}
