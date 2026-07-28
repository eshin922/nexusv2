// Pure function tree: no `import "server-only"` so the pure-function
// primitives are unit-testable via `node --experimental-strip-types`.
// Boundary is enforced structurally — nothing outside src/lib/netsuite/
// imports composition-hash directly, and the netsuite/ tree is only
// wired into server-side action code by 8c-3 (verifier allow-list
// change lands there).
import { createHash } from "node:crypto";

// Slice 12 Step 8c-1 — Composition hash for Item Group identity.
//
// Per CA §4A amendment (2026-07-28): groups are per-CUSTOMER ×
// composition. Two customers ordering an identical component set get
// separate groups. Same customer + same composition → reuse. Same
// customer + different composition → new group.
//
// Inputs, in this canonical order, drive the hash:
//   1. customer_netsuite_id (string)
//   2. base_sku             (string; the assembly's SKU — the parent
//                            identity anchor per CA "Same composition
//                            under two base SKUs must be two groups")
//   3. members              (array of {ns_item_id, quantity} sorted by
//                            ns_item_id ascending). Every leaf on the
//                            assembly participates — physical, OTC, and
//                            freight lines alike.
//
// Per-member quantity IS included in the hash (CA Q2 disposition,
// 2026-07-28): "1 bottle + 1 pump" is structurally distinct from
// "2 bottles + 1 pump". Existing sandbox groups all use quantity=1;
// if that stays true, the hash input becomes constant — harmless. If
// multi-quantity emerges, we're already correct.
//
// Canonicalization steps:
//   - customer_netsuite_id + base_sku: trimmed (no case-fold; NetSuite
//     ids are case-sensitive in general and lowercasing risks
//     collisions on customer-facing SKUs).
//   - members: sorted by ns_item_id ascending; each member's quantity
//     normalized to a string (JSON.stringify Number differs by locale
//     in some engines).
//   - JSON.stringify with sorted keys → SHA-256 → hex.
//
// Output: 64-char lowercase hex string.

export interface CompositionMember {
  netsuiteItemId: string;
  quantity: number;
}

export interface CompositionHashInput {
  customerNetsuiteId: string;
  baseSku: string;
  members: CompositionMember[];
}

/**
 * Compute the composition hash. Deterministic in inputs — same inputs
 * always produce the same output. Sort-agnostic — reordering `members`
 * produces the same hash.
 */
export function computeCompositionHash(input: CompositionHashInput): string {
  const canonicalized = canonicalize(input);
  const serialized = JSON.stringify(canonicalized);
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Produce a debug string that includes the canonicalized input alongside
 * the hash. Useful for audit-log diff_json + fixture-mismatch diagnosis.
 */
export function computeCompositionHashDebug(input: CompositionHashInput): {
  hash: string;
  canonical: CanonicalizedInput;
  serialized: string;
} {
  const canonical = canonicalize(input);
  const serialized = JSON.stringify(canonical);
  const hash = createHash("sha256").update(serialized).digest("hex");
  return { hash, canonical, serialized };
}

// ---------- internals ----------

interface CanonicalizedInput {
  customerNetsuiteId: string;
  baseSku: string;
  members: Array<{ id: string; qty: string }>;
}

function canonicalize(input: CompositionHashInput): CanonicalizedInput {
  const customerNetsuiteId = input.customerNetsuiteId.trim();
  const baseSku = input.baseSku.trim();

  if (!customerNetsuiteId)
    throw new Error("[composition-hash] customerNetsuiteId is required");
  if (!baseSku) throw new Error("[composition-hash] baseSku is required");
  if (!input.members?.length)
    throw new Error("[composition-hash] members must be non-empty");

  const members = input.members
    .map((m) => {
      const id = String(m.netsuiteItemId).trim();
      if (!id)
        throw new Error("[composition-hash] member.netsuiteItemId is required");
      if (
        !Number.isFinite(m.quantity) ||
        m.quantity <= 0 ||
        !Number.isInteger(m.quantity)
      )
        throw new Error(
          `[composition-hash] member.quantity must be a positive integer (got ${m.quantity} for id ${id})`,
        );
      return { id, qty: String(m.quantity) };
    })
    // Sort strictly by id ascending; ties in id would be a duplicate
    // member which we also treat as an error (below).
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Duplicate-member detection: if two members share the same ns item
  // id, the caller should have merged their quantities upstream. We
  // fail-loud here rather than silently collapse — that's a real bug
  // in the assembly definition and it must surface.
  for (let i = 1; i < members.length; i++) {
    if (members[i].id === members[i - 1].id) {
      throw new Error(
        `[composition-hash] duplicate member ns item id ${members[i].id} — merge quantities upstream`,
      );
    }
  }

  return { customerNetsuiteId, baseSku, members };
}

/**
 * Convention: the netsuite_external_id we write on new groups is
 * `nxs-grp-<full-hash>`. Prefix identifies Nexus-authored groups
 * unambiguously in NetSuite; full hash means externalId collisions
 * are impossible without composition-hash collisions (SHA-256 —
 * effectively never).
 */
export function externalIdForHash(compositionHash: string): string {
  return `nxs-grp-${compositionHash}`;
}
