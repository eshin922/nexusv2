# DEFECT · `schema_pending` freezes into an order packet as `specified`

**Found 2026-09-15 · open · pre-existing · NOT caused by and NOT fixed by the
Ingestibles/Topicals gap-fill.**

Recorded separately so it is not folded into that work and lost with it.

## What happens

`dispositionOf` in `src/lib/ordered-spec-freeze.ts` classifies a pinned
authority for the frozen record:

```ts
function dispositionOf(specSchema, productTypeId): FrozenSpecDisposition {
  if (specSchema === "no_schema") return "no_schema";
  if (specSchema === "unmapped")  return "unmapped";
  if (specSchema === "no_type")   return "no_type";
  if (specSchema === null) return productTypeId ? "unmapped" : "no_type";
  return "specified";          // ← everything else
}
```

`schema_pending` is not named, so it falls through to **`specified`**.

## Why that is wrong

`schema_pending` means *a schema is owed here* — somebody looked at the
category, found no schema implemented, and recorded that. `specified` means
*this item had a specification and here it is*.

The freeze exists precisely to keep those apart. Its own header says the
disposition column is there so that "this item had no spec" and "we failed to
capture one" are never the same observation in a historical record. A
`schema_pending` product freezes as though it carried a specification, and the
frozen record then asserts something nobody stated.

It is the same collapse that was already fixed once inside
`encodePinnedSchema`, where a bare `return "unmapped"` encoded
`schema_pending` as `unmapped` and lost the distinction at the moment it was
persisted. That fall-through was replaced with an exhaustive switch and a
`never` binding. **`dispositionOf` still has the original shape** — a
fall-through `return`, total over the kinds that existed when it was written.

## Who is affected today

**52 products** classified `Raw ingredients`, the only value currently mapped
`SCHEMA_PENDING`. Any of them frozen into an order packet is recorded as
`specified` with empty values.

## Why it is not fixed here

`FrozenSpecDisposition` and the database CHECK on
`quote_snapshot_leaf_specs.disposition` both permit exactly four values —
`specified | no_schema | unmapped | no_type`. Fixing this means either adding a
fifth, which is a migration and a decision about what already-frozen rows mean,
or mapping `schema_pending` onto one of the existing four, which is a judgement
about historical records.

Neither belongs in a gap-fill that adds two product types. Both need their own
review.

## What would fix it

1. Decide what a `schema_pending` item should say in a frozen packet — a fifth
   disposition, or one of the four with stated reasoning.
2. Give `dispositionOf` an exhaustive switch with a `never` binding, so the
   next pin kind is a compile error rather than a silent `specified`.
3. Decide what the already-frozen rows mean, if any exist.

## Evidence

- `src/lib/ordered-spec-freeze.ts` — `dispositionOf`, the fall-through.
- `src/lib/product-structure/spec-schema-mapping.ts` — `encodePinnedSchema`,
  the same bug already fixed once, with its comment explaining why.
- Live CHECK: `qsls_disposition_known` permits four values.
- `MAPPING` maps exactly one value to `SCHEMA_PENDING`: `Raw ingredients`, 52
  products.

Surfaced while tracing which changes activate the `formulated` schema. The
`formulated` path itself is unaffected: it falls through to `specified`, which
is correct for a product that does carry a specification.
