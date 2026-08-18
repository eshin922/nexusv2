# Bounded implementation plan — Stage 3, service mapping, and per-use `Other Service`

**Status:** plan. Nothing implemented.
**Requested by:** Edward, 2026-08-17 (#291 re-review disposition).
**Explicitly out of scope:** Sales Order projection of Direct Service lines.

Three workstreams. **A** and **B** are independent of each other; **C** depends
on **B**. None of them may enable SO projection, and §0 below is the reason
that sentence needs enforcing rather than merely stating.

---

## §0 · The finding that reshapes the sequencing

**Today a quote carrying a Direct Service cannot complete — and that is real
protection, arrived at by accident.**

`mark-complete.ts:378-392` builds `uniqueSkus` from every assembly member plus
`tree.directProducts`, and resolves each by SKU-match. A Direct Service *is* a
`quote_leaf` with `assembly_id IS NULL`, so it lands in `directProducts`, its
`SVC-*` SKU fails to resolve, and `throw new Error(resolutionError)` blocks the
completion.

Nothing decided that. It follows from the canonical SKUs being Nexus-invented.

The consequence is the whole point of this section: **the moment workstream B
supplies a resolved NetSuite item for a service, that block disappears** — and
`mark-complete` will happily emit the service as a flat Direct-Product-shaped
SO line, at whatever quantity and rate the Direct Product path computes, with
no allocation semantics and no review. SO projection would ship as a *side
effect of the mapping work*, which is exactly what the disposition defers.

This is the Pattern 56 shape stated in `CLAUDE.md`, in a new medium: a
guarantee supplied for free by an unrelated failure, removed by fixing the
unrelated failure. The mitigation is not care — it is that **workstream B must
replace the accidental block with a deliberate one, in the same slice**, and
the deliberate block is removed by the projection slice rather than by B.

After B, a quote with a Direct Service refuses completion for one of two
*stated* reasons:

| Condition | Message |
|---|---|
| identity unmapped or stale | names the service, points at Settings — actionable |
| mapped, projection not yet certified | "Direct Service Sales Order projection is not enabled" — accurate, and makes the deferral visible rather than latent |

Both are blocks. Only the first is an operator's to clear. Neither guesses.

---

## A · Stage 3 — Production ownership XOR

### A.1 What changes and why it is not novel

`assembly_production_inputs.assembly_id` is `NOT NULL REFERENCES assemblies`, so
a Direct Service's production economics have nowhere to live. Migration `0077`
already established the exact shape for a value owned by *either* a group or a
top-level unit: nullable `assembly_id`, nullable `quote_leaf_id`, CHECK that
exactly one is set, partial unique index per branch.

### A.2 The invariant that stops being free

Today "a Direct Product cannot own production" is guaranteed by the FK — the
column cannot hold a leaf at all. After the XOR, a `quote_leaf_id` on a
production row becomes *legal*, and "only a service-classified leaf may own
production" needs an explicit guard.

**This guard must ship in the same migration slice as the XOR.** Shipping the
relaxation first leaves a window in which the database will accept production
economics on a folding carton, in direct contradiction of BV-012 §1.b.

### A.3 How to enforce it — recommendation and the trade-off

The predicate is two hops: production row → `quote_leaves.leaf_id` →
`leaves.commercial_kind`. A plain CHECK cannot cross tables.

**Recommended — denormalize `commercial_kind` onto `quote_leaves`, then
enforce declaratively:**

1. `UNIQUE (id, commercial_kind)` on `leaves`.
2. `quote_leaves.commercial_kind`, with a composite FK
   `(leaf_id, commercial_kind) → leaves (id, commercial_kind)` so the copy
   cannot disagree with its source.
3. `assembly_production_inputs.owner_commercial_kind`, `CHECK` that it is
   `'service'` whenever `quote_leaf_id` is set, and a composite FK
   `(quote_leaf_id, owner_commercial_kind) → quote_leaves (id, commercial_kind)`.

**Why not a constraint trigger.** OD-017 is the reason. A constraint trigger on
a *referencing* table silently refused a write the action layer permitted, and
the pre-migration probe missed it because it checked triggers on the table
being altered. Declarative constraints are visible in `\d`, enforced by the
planner, and cannot be conditionally skipped.

**The cost, stated plainly.** Denormalization is a second copy of a fact, and a
second copy can drift. Here it cannot, for a structural reason worth making
explicit rather than assuming: **`leaves.commercial_kind` is an identity, not
an attribute.** A product does not become a service. So the same slice should
add a trigger or rule forbidding `UPDATE` of `commercial_kind` on an existing
leaf — which converts "it never changes in practice" into "it cannot change",
and is what makes the denormalized copy safe rather than merely currently
correct.

If Edward prefers to avoid the denormalization, the fallback is an action-layer
guard plus a standing verification query. That is weaker in exactly the way
Pattern 56 warns about — it holds until someone adds a writer — and should be
chosen deliberately, not by default.

### A.4 The attachment prohibition, finally declarative

Separately and more cheaply: BV-012 §5.c ("a service may not be an Item Group
member") is currently enforced only by the action gate. With
`UNIQUE (id, commercial_kind)` on `leaves` in place, `assembly_leaves` gains
`member_commercial_kind NOT NULL DEFAULT 'product' CHECK (= 'product')` and a
composite FK to `leaves (id, commercial_kind)`. One hop, no denormalization
question, no trigger. The gate stays — it produces the operator-facing sentence
— but the database stops depending on it.

### A.5 Migration classification

Per the deployment-order rule in `CLAUDE.md` — order is set by compatibility,
not by a fixed direction.

| Change | Class | Safe ahead of code? |
|---|---|---|
| `quote_leaves.commercial_kind` (nullable, backfilled) | additive | yes |
| `assembly_production_inputs.quote_leaf_id` (nullable) | additive | yes |
| `assembly_id` `DROP NOT NULL` | relaxing | yes for writers; **readers must handle NULL in the same deploy** |
| XOR `CHECK` | tightening — satisfied by every existing row (all have `assembly_id`, none has `quote_leaf_id`) | with the census |
| composite FKs, `UNIQUE (id, commercial_kind)` | tightening | **needs a deployed-writer proof** |
| `assembly_leaves.member_commercial_kind` + FK | tightening | **needs a census proving no member is a service** |

Each tightening step needs its census run and recorded *before* the migration,
not after. `0066` is the precedent: a model-level `.notNull()` is a
declaration, not a runtime check, and was true and untrue simultaneously.

The `DROP NOT NULL` row deserves its own note. Relaxing never breaks a writer,
but it does break a *reader* that assumes non-null — `costing-adapter` reads
`assembly_id` and would receive NULL for a service row. No service row exists
until this slice creates one, so the ordering is safe; the code that handles
NULL must nonetheless land in the same deploy.

### A.6 Authoring surface

Gated on **service classification**, never on presence of values. #282
established one Production surface per Item Group and none on leaves; a surface
that appeared because a row existed would be #282 undone by the first stray
write.

### A.7 Blocking decision

**Which Production inputs does each service expose?** Open question 3 in
`docs/validation/direct-service-architecture-trace.md`, still unanswered. The
disposition says library identity determines it, but not by what mechanism —
a per-type `field_schema` (the column exists and is unused for this), a curated
mapping, or operator choice.

**A cannot be built without this.** It decides the shape of the authoring
surface and possibly of the row itself. Everything above is the plumbing; this
is what flows through it.

---

## B · NetSuite mapping Settings — the four fixed identities

Formulation, Filling / Blending, Pack-out / Assembly, Testing / Micros: one
firm-level mapping each. Design accepted at
[`direct-service-netsuite-mapping-design.md`](direct-service-netsuite-mapping-design.md).

### B.1 Steps

1. **Table.** `netsuite_service_item_map` — `service_identity` (PK, the
   governed enum, four rows), `netsuite_item_code`, `netsuite_internal_id`,
   `resolved_at`, `resolved_by_user_id`. Purely additive.
2. **Save action.** Resolves the entered item code through the **existing**
   `resolveNetsuiteItem`, stores the returned internal ID. `not_found` and
   `ambiguous` refuse at save time, which is the recoverable moment. Admin-gated
   via `requireAdminAction`.
3. **Verify / Remap.** Explicit admin action, re-resolving and updating
   `resolved_at`. Per the disposition: no blind re-resolution on every push.
4. **State derivation.** Three-valued — `unmapped` / `mapped` / `stale`. A
   NetSuite call that *errors* is **indeterminate**, never rewritten as stale:
   folding a transient API failure into "stale" would block firm-wide
   completion from one bad request. This is the OD-027 lesson — a lookup that
   catches errors and returns "missing" cannot establish nonexistence.
5. **Settings surface** in the existing NetSuite / Integrations area. One row
   per service: Nexus service · item code · internal ID · state · Verify/Remap.
6. **The two blocks of §0**, in `mark-complete` before the SKU-resolution loop,
   with services excluded from that loop entirely — no SKU guessing on `SVC-*`.

`other_service` is deliberately absent from this table. Adding a fifth row
"for symmetry" would be the generic default the disposition prohibits.

### B.2 Preflight vs completion

Preflight confirms the stored mapping is still usable **only if the existing
NetSuite API can do it cheaply and reliably** — to be measured, not assumed. If
one round trip per mapped identity is not cheap, preflight reads stored state
only and the block relies on the admin Verify action. Either way an
indeterminate read stays indeterminate.

### B.3 Not Pattern 52

A routing table, not a commercial term. What actually pushed is recorded on the
Sales Order and in the `quote_completed` audit row's `diff_json.netsuite`
subtree, so re-mapping later cannot retroactively re-route anything already
pushed. No freeze-list entry.

---

## C · Per-use `Other Service` mapping

`other_service` is the catch-all and carries no single accounting meaning, so
it takes a per-use selection rather than a firm default.

**Note the asymmetry is principled, not pragmatic.** B is firm-level and
therefore not frozen; C is a decision made *on a quote*, so it freezes with the
quote. Same subject, opposite Pattern 52 treatment, because they are different
kinds of decision.

### C.1 Steps

1. **Sparse sibling table** `quote_leaf_service_item`, keyed on `quote_leaf_id`
   — the convention already used for cell overrides and targets, rather than
   two mostly-NULL columns on the hot `quote_leaves` table. Carries the item
   code, the authoritative internal ID, and `resolved_at`.
2. **Selection is governed and resolved** — the operator picks from NetSuite
   service items resolved through the existing resolver. **No free-text.** The
   stored value is the internal ID; the code is stored for recognition only and
   is never what the write references.
3. **Freeze.** Add the table's columns to
   [`pattern-52-freeze-list.md`](pattern-52-freeze-list.md) and call
   `assertNotFrozen` at the top of its writer, so an accepted quote's selection
   cannot drift before push.
4. **Block.** A quote carrying an `other_service` line with no selection cannot
   complete, naming the line. No fallback to the four fixed mappings, and no
   generic default.

### C.2 Open

Whether the selection is per **line** or per **quote**. Per line is the safer
default — two `Other Service` lines on one quote may genuinely be two different
things, which is the entire reason `other_service` has no firm default. Worth
confirming rather than inferring.

---

## Sequencing

```
A ── Stage 3 XOR ──────────────┐   blocked on A.7 (which inputs per service)
                               ├── SO projection slice (NOT authorized)
B ── mapping Settings ── C ────┘
```

**A and B are independent and may run in either order or in parallel.** A is
Costs-side and blocked on a business answer; B is Settings-side and blocked on
nothing. If A.7 does not resolve quickly, **B first** is the better use of the
time.

C requires B's resolver plumbing and state vocabulary.

Nothing here authorizes SO projection. The deliberate block from §0 is the
marker for where that slice begins — it should be removed by the slice that
certifies the projection, and by nothing else.

---

## Evidence obligations

Carried from the standing discipline; listed because each has already caught
something real on this workstream.

- **Fresh invariance witness**, captured from current `main` with
  `scripts/capture-costing-witness.ts`. Not S-7 — it is red on untouched main
  for unrelated drift.
- **Falsify, do not grep.** A duplicate-identity invariant is proven by
  attempting the duplicate. An attribution invariant is proven by moving the
  anchor and holding every quantity constant. A census filter that cannot
  express a failure reports zero because it can only ever report zero.
- **`npx tsc --noEmit` AND `npm run test:unit`, both after the last edit.** The
  suite runs under `--experimental-strip-types`, which erases types rather than
  checking them, so a green suite is not evidence the code compiles — including
  when the last edit was to a test.
- **Ancestry check before every push.**
- **Cross-consumer audit by enumeration**, not by assumption: reads, writes,
  realtime subscriptions, publication membership, and raw SQL under `src/lib/`.

---

## Decisions needed before work starts

| # | Question | Blocks | Kind |
|---|---|---|---|
| 1 | Which Production inputs does each service identity expose, and by what mechanism? | **A entirely** | business |
| 2 | Denormalize `commercial_kind` onto `quote_leaves` for declarative enforcement, or action-layer guard plus verification query? | A.3 | architecture — recommendation given |
| 3 | Is the per-use `Other Service` selection per line or per quote? | C | business — per line recommended |
| 4 | Can preflight verify a stored mapping cheaply against the NetSuite API? | B.2 | measurement |
