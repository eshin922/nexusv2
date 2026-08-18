# Bounded implementation plan — Stage 3, service mapping, and per-use `Other Service`

**Status:** GOVERNING implementation plan. All business decisions resolved
2026-08-17; the one measurement is taken and recorded at §B.2.
**Requested by:** Edward, 2026-08-17 (#291 re-review disposition).
**Amended:** 2026-08-17 with the #292 review dispositions, inline.
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

### A.3 RESOLVED — declarative enforcement

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

**Disposition: the declarative approach, all five parts** — denormalized
`commercial_kind` on `quote_leaves`; composite FK back to `leaves`;
Production-owner composite FK proving a leaf owner is `service`; declarative
member prohibition proving members are `product`; immutability of
`leaves.commercial_kind` in the same slice.

The action-layer fallback is **rejected as a primary boundary.** The gates stay
— they produce the operator-facing sentence, which a constraint violation
cannot — but the database enforces the invariants independently of them. Two
defences, and neither is load-bearing alone.

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

### A.7 RESOLVED — one governed Production input per service identity

**Each canonical Direct Service exposes exactly ONE Production input, fixed by
its service identity. Not operator-selectable.**

| Service identity | Production input |
|---|---|
| `formulation` | R&D / Formulation |
| `filling_blending` | Filling / Blending |
| `packout_assembly` | CM Assembly / Pack-out |
| `testing_micros` | Testing / Micros |
| `other_service` | Other Service |

**A Direct Service must not expose the generic Item Group Production table.**
That is the load-bearing half. A one-row-per-identity surface and a full table
filtered to one row look similar and are not: the filtered table is a table
that currently shows one thing, and the first widening of the filter — or the
first stray row — turns it back into an Item Group surface on a leaf, which is
#282 undone. The surface renders the single input the identity names, and has
no capacity to render another.

Explicitly still **excluded** from a Direct Service, remaining Item Group / OTC
economics unless separately approved: Bulk Raw, Setup, Tooling, Artwork,
Freight / Duties / Tariffs, Customs, Dies, Print Plates, Samples / PPS,
Processing Fee, Cartons.

The mapping is a constant in code keyed by the `direct_service_identity` enum,
beside `DIRECT_SERVICE_LABELS`. Not a database table: it is governed
vocabulary, closed, and changing it should require a code change and this
document, not an UPDATE. Not `product_types.field_schema` either — that
mechanism is operator/admin-populated, and this must not be operator-selectable.

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

### B.2 MEASURED — the query is cheap; preflight is the wrong place for it

Taken against the NetSuite **sandbox**, read-only SuiteQL, 2026-08-17.

| Path | n | fails | min | p50 | p90 | max |
|---|---|---|---|---|---|---|
| **A** baseline SKU-match, 1 SKU — *already on the live push path* | 5 | 0 | 162 | 198 | — | 278 |
| **B** validate 1 stored internal ID | 5 | 0 | 192 | 288 | — | 922 |
| **C** validate **all 4** in one round trip | 15 | 0 | 154 | 183 | 309 | 450 |
| **D** REST `getRecord` | 5 | **5** | — | — | — | — |

**The query is cheap.** Validating all four mappings in one batched round trip
costs about what *one* SKU-match costs, and the push path already pays that per
unique SKU sequentially — a ten-SKU quote spends ~2s there today. One batched
validation is roughly a 10% addition. Batching is also strictly better than
per-identity: four separate calls would cost four times a query that is not
cheaper individually (B's p50 is *higher* than C's).

**It is also reliable, and reliable in the specific way the state machine
needs.** Two correctness probes, not just timings:

- A nonexistent ID returns **0 rows and does not throw**. So absence is
  *authoritative* and is distinguishable from a failed read, which throws.
  That is precisely the `not_found` vs `read_failed` distinction §B.1.4
  depends on — it is a measured property of the API, not an assumption.
- Rows with `isinactive='T'` are visible when not filtered out, so
  deactivation is **detectable** rather than presenting as disappearance.

**D failed all five attempts**, and the failure is informative rather than
incidental: `getRecord` requires the record type in the URL, and these items
are `NonInvtPart`, not `serviceSaleItem`. A validator built on REST would have
to know each item's type before it could look it up — which is part of what it
is trying to find out. SuiteQL is type-agnostic and is the right instrument.

**But the answer to "should preflight do it" is NO, and not for cost reasons.**

`loadSalesOrderPreflight` is **DB-only today** — its own comment says so:
*"Cheap DB-only reads (customer-map lookup + hubspot deal cache row + latest
netsuite_so_pushes row)."* It makes zero NetSuite calls, and it runs on **every
Quote-tab render** for an accepted or complete quote
(`quote/page.tsx:230-233`).

Putting a NetSuite round trip there would introduce a network dependency into a
page render — and specifically into the page an operator opens **to find out
what went wrong with their push**. A NetSuite outage would then take out the
diagnostic surface along with the push. The query being fast does not fix that;
the objection is to the dependency, not the latency.

**Disposition:**

- **Preflight displays stored state only** — `mapped` / `unmapped` / `stale`
  as last known, from the DB, no network. Cheap, and honest about being a
  cached view.
- **Live validation runs in the completion action**, immediately before push,
  as one batched SuiteQL over every mapping the quote needs. That path already
  requires the network, already spends this much per SKU, and is the only
  moment at which staleness actually matters.
- **Admin Verify/Remap** remains the explicit refresh, as dispositioned.
- An indeterminate read stays indeterminate everywhere. At push time that means
  the completion **fails closed** with a NetSuite-unreachable message — not a
  silent pass, and not a false "stale".

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

### C.2 RESOLVED — per service line

Two `Other Service` lines on one quote may represent different accounting
destinations. A quote-level selection would collapse them — which is the same
error as a firm-wide default, one scope down, and for the same reason.

The resolved internal ID freezes with **that line's** accepted state, not with
the quote as an undifferentiated whole. So the freeze-list entry is the sparse
row keyed on `quote_leaf_id`, and `assertNotFrozen` is called per line.

---

## Sequencing

```
A ── Stage 3 XOR ──────────────┐   blocked on A.7 (which inputs per service)
                               ├── SO projection slice (NOT authorized)
B ── mapping Settings ── C ────┘
```

**B runs first, per disposition.** A is Costs-side and now unblocked too
(A.7 resolved), but B is the shorter path and carries the §0 obligation, which
should not sit latent while A is built.

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

## Decisions — all resolved 2026-08-17

| # | Question | Resolution |
|---|---|---|
| 1 | Which Production inputs does each service identity expose? | **A.7** — exactly one per identity, fixed by identity, not operator-selectable |
| 2 | Declarative enforcement or action-layer guard? | **A.3** — declarative, all five parts; action layer explicitly rejected as the primary boundary |
| 3 | Per-use `Other Service`: per line or per quote? | **C.2** — per line |
| 4 | Can preflight verify a mapping cheaply? | **B.2** — the query is cheap and reliable, but preflight is DB-only by design and renders on page load; live validation moves to the completion action |

**Sequencing disposition: B first.**
