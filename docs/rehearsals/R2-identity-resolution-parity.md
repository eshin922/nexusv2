# R2 · Identity-resolution parity

**Gate:** before implementation completes.
**Source of requirement:** [`PHASE-3-PRICING-WORKSPACE.md`](../../PHASE-3-PRICING-WORKSPACE.md) §2 · R2.
**Status:** **PASS**, 2026-08-10, against production data. See §Results.

This procedure was written from the specification, not from the identifier. The
requirement is quoted below verbatim so a future run can check the procedure
against it rather than against this document's paraphrase.

> Slice 1's compatibility window means the lift and the cost base it modifies
> are keyed through different identities.
>
> **Rehearse against real quote data:** for every commercial attachment, prove
> the canonical row and the legacy input membership refer to the same **Quote,
> Product, LEAF, quantity and position.**
>
> **Record:** the parity check across the full attachment set, and the count of
> any failing category.
>
> **Stop condition:** any missing, duplicate, cross-Quote or drifting mapping.
> **Do not resolve through `leaf_id` or inferred tuple matching.**

---

## 1 · Objective

Prove that the two identities in play during Slice 1's compatibility window
denote the same commercial attachment, in **both directions**, across every
attachment that exists.

The reason this is a gate and not a unit test: a lift is addressed by canonical
`quote_leaf_id`, and the cost base it modifies is keyed by legacy
`assembly_leaf_id`. If those disagree for even one attachment, a lift lands on a
different commercial line than the one the operator selected — and it lands
silently, because both ids are valid UUIDs that resolve to real rows.

**Both directions are swept.** A one-way sweep leaves the direction the cost
base actually uses unproven, and the two are not symmetric: a canonical row may
legitimately have no legacy mapping (direct form), while a legacy row with no
canonical parent is always a fault.

---

## 2 · Prerequisites / fixture state

**None. This rehearsal takes no fixture, and must not.**

The requirement says "against real quote data". A fixture would prove the
resolver works on rows built to satisfy it, which is the opposite of the
question. The sweep runs against the database as it stands.

- Read-only. No writes, no seeding, no cleanup.
- `.env.local` present with `DIRECT_URL` (session-mode pooler, `:5432`).
- Safe against production because it only reads; note that dev and prod share
  one Supabase project, so there is no other database to run it against.

---

## 3 · Operator steps

```
npm run rehearsal:r2
```

One command. It sweeps every `quote_leaves` row forward through
`lookupCanonicalAttachment`, then every `assembly_leaves` row back through
`lookupCanonicalAttachmentByLegacyId`.

---

## 4 · Expected observable results

```
R2 · identity-resolution parity
attachment set: N canonical rows

category breakdown (canonical side)
  ok                                 N

forward  canonical -> legacy   N/N resolved
reverse  legacy -> canonical   M/M resolved

PASS — 0 failing mappings
```

Any non-`ok` category, and any resolver refusal, prints the offending
`quote_leaf_id`, its quote, the category, and the resolver's own message.

---

## 5 · Canonical authority exercised

**`src/lib/product-structure/canonical-attachment-identity.ts` —
`assertValidMapping`.**

The verdict is the production resolver's, not the script's. `assertValidMapping`
already asserts exactly the five identities the specification names, and the
script calls it rather than restating it:

| Specification | Assertion |
|---|---|
| same **Quote** | `assemblyQuoteId !== canonical.quoteId` |
| same **Product / LEAF** | `legacy.leafId !== canonical.leafId` |
| same **quantity** | `Number(legacy.quantity) !== Number(canonical.quantity)` |
| same **position** | `legacy.position !== canonical.position` |
| — plus the attachment itself | `legacy.quoteLeafId !== canonical.id`, `legacy.assemblyId !== canonical.assemblyId` |

Missing and duplicate are caught upstream of that, by `rows.length !== 1`.

**The script does not reimplement the rule.** It adds the sweep (every
attachment rather than one) and the category breakdown — and the breakdown is
diagnostic, printed only to say *why* a resolver that has already refused did
so, in the vocabulary the stop condition is written in.

**H13** is the invariant this protects: *"Identity resolution fails closed. A
lift whose canonical-to-legacy mapping is missing, duplicate, cross-Quote or
drifting is rejected, not resolved by fallback."*

---

## 6 · Pass / fail criteria

**PASS** — every attachment resolves in both directions; zero rows in any of
`missing`, `duplicate`, `cross-Quote`, `drifting`, or
`direct-form carrying legacy state`. Exit code 0.

**FAIL** — any failing mapping in any category. Exit code 1.

**On failure, stop.** The specification is explicit that the repair is not to
widen the resolver: *"Do not resolve through `leaf_id` or inferred tuple
matching."* A tuple match would find *an* attachment with the same product and
quantity, which is precisely the wrong answer when a quote carries the same
component twice.

---

## 7 · Evidence to capture

Release evidence calls for an **"Identity parity report: R2's full attachment
sweep, with failing counts."** Capture the complete stdout — it is that report.
It carries the attachment-set size, per-category counts, both directional
totals, and the verdict.

---

## 8 · Known exclusions

**None from OD-012.** This rehearsal is data-level. It does not stage, apply, or
persist anything, and it does not need a lift to exist — it proves the identity
a lift *would* resolve through.

**None from A-2.** Provenance is not identity. R2 asks whether two ids denote
the same attachment, not who set what.

**Not blocked by `CellAction`.** No operator affordance is involved.

**One real scope limit:** the sweep proves parity for attachments that exist. It
cannot prove parity for a form with no rows. See the direct-form note below.

---

## Results · 2026-08-10

Run against production data, commit `22d6820`.

```
attachment set: 137 canonical rows

category breakdown (canonical side)
  ok                                 137

forward  canonical -> legacy   137/137 resolved
reverse  legacy -> canonical   137/137 resolved

PASS — 0 failing mappings
  No missing, duplicate, cross-Quote or drifting mapping in either direction.
```

**PASS.** Zero failing mappings in either direction, zero rows in any failing
category.

**Recorded limit — the direct form is unexercised.** All 137 attachments are
grouped-form (`assembly_id IS NOT NULL`); there are **zero** direct-form rows in
the database. So the branch of `assertValidMapping` that permits a canonical row
with no legacy mapping — and the category that would catch a direct-form row
wrongly carrying legacy state — passed vacuously.

That is not a defect in the rehearsal and not a reason to build a fixture: the
specification asks for parity against real data, and the real data has no
direct-form attachments yet. It is recorded because the day the first one
appears, this gate's coverage changes without the sweep's output changing shape,
and a future reader should know that today's PASS did not cover it.
[OD-017](../OPEN_DECISIONS.md) is where the direct form becomes the main path.
