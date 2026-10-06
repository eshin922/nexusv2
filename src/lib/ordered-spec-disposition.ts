/**
 * What a frozen ordered specification says about itself. A LEAF module: no
 * database, no `server-only`, so the classification can be proven directly.
 *
 * ── FIVE STATES, AND WHY NONE MAY STAND IN FOR ANOTHER ───────────────────
 *
 *   specified       a governed schema applies; the frozen values are its values
 *   no_schema       specifications intentionally do not apply — an ANSWER
 *   schema_pending  a schema is OWED here: the category was dispositioned as
 *                   needing one that is not implemented yet. NOT an answer, and
 *                   above all not `specified`
 *   unmapped        classified, but no governed disposition exists — NOT an answer
 *   no_type         no authoritative Product Type — NOT an answer
 *
 * `schema_pending` was added after DEFECT-2026-09-15: the previous classifier
 * ended in a bare `return "specified"`, total over the kinds that existed when
 * it was written, so a `schema_pending` pin froze as though the product
 * carried a specification. The same shape had already been fixed once in
 * `encodePinnedSchema`. This version is an exhaustive switch over the stored
 * pin vocabulary with a `never` binding, and an unknown stored value THROWS:
 * the send that would freeze it fails loudly instead of recording a claim
 * nobody made.
 */
import type {
  PinnedSpecSchema,
  SpecSchemaId,
} from "@/lib/product-structure/spec-schema-mapping";

export type FrozenSpecDisposition =
  | "specified"
  | "no_schema"
  | "schema_pending"
  | "unmapped"
  | "no_type";

/** Every disposition, in a fixed order. The DB CHECK must permit exactly these. */
export const FROZEN_SPEC_DISPOSITIONS: readonly FrozenSpecDisposition[] = [
  "specified",
  "no_schema",
  "schema_pending",
  "unmapped",
  "no_type",
];

/**
 * The governed schema ids. Kept as a `Record` keyed by `SpecSchemaId` so adding
 * an id to the type without adding it here is a COMPILE error.
 */
const SCHEMA_IDS: Record<SpecSchemaId, true> = {
  primary: true,
  secondary: true,
  tertiary: true,
  formulated: true,
};

function isSpecSchemaId(v: string): v is SpecSchemaId {
  return Object.prototype.hasOwnProperty.call(SCHEMA_IDS, v);
}

/**
 * Classify a live authority's PINNED schema for the frozen record.
 *
 * Reads the pin, never the live Product Type: the pin exists so a later
 * reclassification cannot reinterpret values already authored.
 *
 * `specSchema === null` is an unpinned row. It keeps its long-standing reading:
 * a Product Type with no pin is `unmapped` (nobody decided), no type at all is
 * `no_type`.
 */
export function frozenSpecDispositionOf(
  specSchema: string | null,
  productTypeId: string | null,
): FrozenSpecDisposition {
  if (specSchema === null) return productTypeId ? "unmapped" : "no_type";
  if (isSpecSchemaId(specSchema)) return "specified";
  const pin = specSchema as Exclude<PinnedSpecSchema, SpecSchemaId>;
  switch (pin) {
    case "no_schema":
      return "no_schema";
    case "schema_pending":
      return "schema_pending";
    case "unmapped":
      return "unmapped";
    case "no_type":
      return "no_type";
    default: {
      const unhandled: never = pin;
      throw new Error(
        `[ordered-spec] unknown pinned spec schema ${JSON.stringify(unhandled)}; ` +
          "refusing to freeze a disposition nobody stated",
      );
    }
  }
}

/**
 * Which frozen commercial lines carry an ordered specification. The
 * snapshot's own line kind decides — NOT the presence of `quote_leaf_id`:
 * an OTC charge carries the product it was incurred for, and a Direct Service
 * is a quote leaf too, yet neither is a specifiable item. Shared by the Order
 * Packet and the NetSuite ordered-spec export so the two cannot disagree.
 */
export const SPEC_BEARING_LINE_KINDS: ReadonlySet<string> = new Set([
  "item_group_member",
  "direct_product",
]);

export function isSpecBearingLineKind(lineKind: string): boolean {
  return SPEC_BEARING_LINE_KINDS.has(lineKind);
}
