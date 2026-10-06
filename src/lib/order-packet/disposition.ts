/**
 * Frozen spec disposition → Order Packet state. A LEAF module so the mapping
 * can be asserted without a database. See `reader.ts` for the meaning of each
 * packet state.
 */
import type { FrozenSpecDisposition } from "@/lib/ordered-spec-disposition";

export type SpecDisposition =
  | "specified"
  | "governed_no_spec"
  | "not_governed"
  | "not_spec_bearing"
  | "unresolved";

/**
 * Exhaustive: a new frozen disposition is a compile error here rather than a
 * silent `governed_no_spec`. Only `no_schema` is a governed "no specification
 * applies"; `schema_pending`, `unmapped` and `no_type` are the absence of a
 * governed answer and must never read as one.
 */
export function packetDispositionOf(d: FrozenSpecDisposition): SpecDisposition {
  switch (d) {
    case "specified":
      return "specified";
    case "no_schema":
      return "governed_no_spec";
    case "schema_pending":
    case "unmapped":
    case "no_type":
      return "not_governed";
    default: {
      const unhandled: never = d;
      throw new Error(`[order-packet] unknown frozen disposition ${JSON.stringify(unhandled)}`);
    }
  }
}
