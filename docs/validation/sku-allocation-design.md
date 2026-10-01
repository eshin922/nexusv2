# SKU identity, allocation and recovery — design

**Status: PROPOSED. No implementation, no migration, no seeding, no backfill.**
Author: CC, 2026-09-11. Revised 2026-09-11 after review. Requires approval
before any code or DDL.

## Corrections to the survey and narrative this rests on

**The MISTR identifiers are not established as supplier part numbers.** I wrote
that they "look like" them because their shape differs from
`DPS-<BRAND>-<NNNN>`. A different format does not establish a different
purpose, and putting that inference beside real evidence makes it read as
evidence. They stay untouched.

**The NetSuite survey was SANDBOX** — `7924416_SB2`,
`accountIsSandbox: true`. I listed it beside Nexus and HubSpot as though the
three were the same class of evidence. **Production NetSuite inventory is
unsurveyed**, and surveying it is a prerequisite before any counter is seeded.

**The duplicate narrative was overstated.** What is ESTABLISHED: two
`MISTR - 4oz Lube Silicone` leaves exist, created 31 seconds apart, carrying
different HubSpot product ids, both with no SKU. That is the record.

What I asserted beyond it — that a failed-search retry caused them — is a
hypothesis. Nothing in the data shows what the operator did between 17:25:56
and 17:26:27, and the create path at that time had no search-then-create step
that could have failed. The duplicates motivate this design; they do not
demonstrate its failure mode, and stating otherwise let a plausible story stand
in for evidence.

## What is verified

| fact | source |
|---|---|
| `DPS-<BRAND>-<NNNN>`, per-brand numbering from 1001 | 254 Nexus SKUs across 53 brands |
| 227 numeric parts, 49 distinct | per-brand, not global |
| HubSpot carries the same values | 260 matching SKUs |
| `hs_sku` has `hasUniqueValue: true` | the live property definition |
| many existing SKUs have neither brand nor sequence | `PK0000233`, `Label_Gummy_Debloat_v01`, `10017` |
| NetSuite carries `DPS-` item ids | **sandbox only** |

**What `hasUniqueValue: true` does NOT mean.** HubSpot rejects a duplicate
create; it does not return the existing product. Create is **not idempotent**.

## 1 · Uniqueness is catalog-wide, and independent of format

The constraint is on the **complete normalized SKU** — trim, collapse internal
whitespace, upper-case — across the entire catalog, for generated, imported and
manually entered values alike.

A single `catalog_sku_identity` index holds every known SKU regardless of shape.
Brand and sequence are **formatting and allocation mechanisms for values Nexus
generates**. They are not the constraint, they are not required for a SKU to be
valid, and they are not required to participate in uniqueness.

**Uniqueness and non-reuse. NOT gapless numbering.** A failed reservation, a
conflicted one, or an abandoned intent legitimately leaves a gap in a brand's
sequence. Gaps are expected, are not defects, and must never be "repaired" — a
counter only moves forward, and a released number would violate non-reuse.

Assigned SKUs are immutable and are never recycled, including after archival.

## 2 · How manual and existing SKUs participate

Existing identifiers are preserved exactly. Nothing is rewritten into the
generated format.

`sku_allocations` therefore has **nullable** `brand_token` and `seq`:

| origin | brand_token / seq | how it enters |
|---|---|---|
| Nexus-generated | both set | allocation loop below |
| operator-supplied at create | both NULL | validated, normalized, registered |
| existing catalog identity | both NULL | reconciliation input (§5) |

A CHECK enforces the pairing: both present or both absent, never one. The
uniqueness index is on `sku_normalized` alone, so a `PK0000233` and a
`DPS-ELE-1048` compete in exactly the same namespace.

An operator supplying an existing external SKU is validated against the same
index and refused on collision — the same path, not a bypass.

## 3 · Occupancy is not ownership

**A matching SKU proves someone holds that value. It does not prove this
creation intent created the product holding it.** Adopting on a SKU match alone
would attach an unrelated product to this leaf, and the failure is silent: the
leaf looks complete and points at someone else's record.

Ownership requires positive evidence:

1. **Correlation token — and only under two constraints.** The create payload
   carries the allocation id in a dedicated HubSpot property
   (e.g. `nexus_allocation_id`). A product whose token equals this allocation's
   id is this intent's product.

   The token is ownership evidence ONLY when both hold:

   - **Unique to the intent.** It is the allocation id: one per creation
     intent, never reused, never shared between intents. A token that could
     belong to two intents proves nothing about either.
   - **Controlled by the integration.** The property must be writable only by
     this integration and not operator-editable in the HubSpot UI. If a person
     can set it, a copied value forges ownership, and the strongest evidence in
     this design becomes the easiest to fake.

   If the property cannot be made integration-controlled, the token is
   downgraded to corroboration and adoption is NOT available — the allocation
   stays `conflicted` for a human. That is a prerequisite to settle before
   implementation, not a detail to discover during it.

   *Creating the property is an admin action outside this design.*

2. **Absent the token, ownership cannot be established.** Creation timestamp
   inside the attempt window and matching name/cost are corroborating, not
   probative: a concurrent operator creating the same product with the same
   SKU produces the same signature.

So: **no token, no adoption.** The allocation goes to `conflicted`, which
blocks completion and names what a human must resolve. Never auto-adopt by SKU
alone.

## 4 · Concurrency, crash recovery, and retry safety

### Intent is persisted before the external request

The allocation row is written and committed **before** any HubSpot call. A
crash between the call and recording its response therefore leaves a durable
record that a request may be outstanding, which is the whole point: the
alternative is an in-flight request nobody remembers making.

### One worker issues the create

A competing worker must not issue a second create for the same intent. The
claim is a conditional update, so it is decided by the database:

**Two states may issue a create, and they are different transitions.** The
earlier wording — "only `allocated` is create-eligible" — contradicted the
retry protocol above, which re-issues a create during reconciliation. Both
paths are listed here because a rule stated in one section and broken in
another is worse than either version alone.

| from | claim | issues | to |
|---|---|---|---|
| `allocated` | create claim | FIRST create | `create_in_flight` |
| `create_in_flight`, lease expired | reconcile claim | nothing | `create_uncertain` |
| `create_uncertain` | retry claim | SAME create, SAME SKU | `create_in_flight` |
| `complete`, `conflicted` | — | never | terminal |

**Neither create path may allocate a replacement SKU.** The SKU is fixed when
the allocation row is written and is immutable for the life of the intent: a
retry that minted a fresh SKU would abandon the identity whose uniqueness is
the only thing making the retry safe.

A lease expiring still never makes anything create-eligible DIRECTLY — it makes
the row reconcilable, and reconciliation is what may then retry:

```sql
-- CREATE claim. `allocated` only.
UPDATE sku_allocations
   SET state = 'create_in_flight',
       claim_id = $new_claim, claimed_by = $worker,
       claim_expires_at = now() + $lease,
       attempt_count = attempt_count + 1,
       version = version + 1
 WHERE id = $id AND state = 'allocated' AND version = $seen_version
RETURNING id, claim_id, version;
```

```sql
-- RECONCILE claim. Expired in-flight work, and nothing else.
UPDATE sku_allocations
   SET state = 'create_uncertain',
       claim_id = $new_claim, claimed_by = $worker,
       claim_expires_at = now() + $lease,
       version = version + 1
 WHERE id = $id
   AND state = 'create_in_flight'
   AND claim_expires_at < now()
   AND version = $seen_version
RETURNING id, claim_id, version;
```

```sql
-- RETRY claim. Reconciled work only, and bounded.
UPDATE sku_allocations
   SET state = 'create_in_flight',
       claim_id = $new_claim, claimed_by = $worker,
       claim_expires_at = now() + $lease,
       attempt_count = attempt_count + 1,
       version = version + 1
 WHERE id = $id
   AND state = 'create_uncertain'
   AND attempt_count < $max_attempts
   AND next_attempt_after <= now()
   AND version = $seen_version
RETURNING id, claim_id, version;
```

**Bounded, with backoff.** A duplicate refusal that cannot be resolved by the
token, and a lookup that is temporarily unreadable, both set
`next_attempt_after` on an increasing delay and leave the row
`create_uncertain`. Exhausting `max_attempts` moves it to `conflicted` for a
human rather than retrying forever — an unbounded retry against an external
system is a load generator, not a recovery.

`complete` and `conflicted` are **terminal**. They appear in no claim
predicate, so no lease expiry, retry sweep or operator action can return them
to create-eligibility. A finished allocation cannot be un-finished by a clock.

**Fencing on every subsequent write.** A worker that stalled past its lease
must not overwrite a newer decision made in its absence:

```sql
UPDATE sku_allocations
   SET state = $next, hubspot_product_id = $id, version = version + 1
 WHERE id = $id AND claim_id = $my_claim AND version = $my_version;
```

Zero rows updated means the claim moved on. The stale worker reports and
touches nothing — it does not retry, because the work it was doing is no longer
its work. Without this, a delayed response from a worker everyone had written
off can overwrite a `conflicted` verdict with a stale `complete`.

An expired lease does NOT mean the request failed. It means the outcome is
unknown, which is why it routes to reconciliation rather than to a fresh
create.

### States

| state | meaning | next |
|---|---|---|
| `allocated` | SKU reserved, nothing sent | claim, then create |
| `create_in_flight` | a request is or was outstanding | on lease expiry → reconcile |
| `create_uncertain` | outcome unknown | reconcile |
| `hubspot_created` | product exists and is PROVEN ours | insert leaf |
| `complete` | leaf and product both exist | none |
| `conflicted` | SKU occupied, ownership unproven | human resolution |

### Retry safety rests on the constraint, not on timing

There is no "authoritative absence" in this design, and the earlier draft was
wrong to define one. Repeated empty reads separated by a settle window are a
heuristic dressed as a guarantee: they describe how long I guessed was long
enough, and a guess about propagation is exactly the thing that fails under
load, which is when it matters.

**What is established**, by read-only probe rather than assumption:
`GET /crm/v3/objects/products/{sku}?idProperty=hs_sku` returns **200 with the
object** for a SKU that exists and **404** for one that does not. That is a
direct object read keyed on the unique property — a different path from the
`/search` index.

**What is NOT established:** whether that lookup is read-your-writes. HubSpot
publishes no guarantee I can cite, and confirming it empirically requires a
write this design is not authorised to make. So the protocol below never needs
it to be true.

**The retry protocol.** Safety comes from `hs_sku` being unique-enforced, plus
correlation-token reconciliation. Timing plays no part.

1. On an uncertain outcome, retry the **create**, with the same allocated SKU.
2. Outcomes, and only these:
   - **Created.** The product is ours. Uniqueness guarantees this cannot be a
     second copy — had one existed, the create would have been refused.
   - **Duplicate refusal.** Someone holds the SKU. This routes to
     **reconciliation** and never to adoption: read by `idProperty` and inspect
     the correlation token. Token equal to this allocation → ours, from an
     earlier attempt whose response we lost → adopt. Token absent or different
     → **`conflicted`**, for a human.
   - **Uncertain again.** Remain uncertain and retry later, bounded. Still
     safe, by the same argument — a retry cannot create a second product.

A duplicate response is never, by itself, grounds for adoption. It establishes
occupancy, and §3 is what establishes ownership.

**Why this is better than waiting.** The unsafe operation is creating a second
product, and the constraint makes that impossible regardless of what any read
returns or when. The design no longer has to be right about propagation delay,
which means it cannot be wrong about it.

**The boundary of that guarantee, stated plainly.** Duplicate prevention rests
on HubSpot continuing to enforce uniqueness on the UNCHANGED SKU. Two things
fall outside it:

- **The SKU is edited externally.** If someone changes `hs_sku` on our product,
  the value is free again and a retry will create a second product — correctly,
  as far as the constraint is concerned, because nothing holds that value any
  more.
- **The product is deleted or archived externally.** Same result, same reason.

Neither is prevented by this design, and neither should be reported as though
it were. They are detected after the fact by the correlation token: a leaf
whose recorded product no longer carries its SKU, or no longer exists, is a
reconciliation finding for a human. `hasUniqueValue` is also a property
setting, so a change to the property definition itself would remove the
guarantee silently.

**Falsifications required before this ships.** Each must be demonstrated to
FAIL when the protection is removed, not merely to pass with it in place.

*Allocation*

- N concurrent calls, SAME attempt key → exactly one allocation row, one SKU, N
  identical results.
- N concurrent calls, DIFFERENT keys, same brand → N distinct SKUs, no
  duplicate. Contiguity is NOT asserted: gaps are legitimate per §1.

*Crash*

- Process killed after the HubSpot request is issued and before the response is
  recorded → the allocation is durable, sits in `create_in_flight`, and
  recovery reconciles it. No second create is issued, and the SKU is not
  reallocated.
- Process killed between allocation and the first request → the allocation
  remains `allocated` and is claimable exactly once.

*Lease expiry*

- An expired `create_in_flight` lease → the row becomes claimable for
  RECONCILIATION only. A create claim against it returns zero rows.
- A `complete` allocation whose lease has long expired → **not** create
  eligible, not reconcile eligible. Terminal states are absent from every claim
  predicate, and the test asserts zero rows for both.
- Same for `conflicted`.

*Delayed response — the fencing case*

- Worker A stalls past its lease; worker B reconciles and records
  `conflicted`; worker A then returns with a success response and attempts to
  write `complete` → **zero rows updated**. A's claim_id and version no longer
  match, so the stale decision cannot overwrite the newer one. A reports and
  touches nothing.
- The same shape with A returning a duplicate refusal after B recorded
  `complete`.

*External SKU conflict*

- A SKU created outside Nexus occupying the counter's next value → allocation
  advances past it rather than colliding, and records the external value.
- A duplicate refusal on create where the occupying product carries NO
  correlation token → `conflicted`. Not adopted.
- A duplicate refusal where the token belongs to a DIFFERENT allocation →
  `conflicted`. Not adopted.
- A duplicate refusal where the token is this allocation's → adopted, and
  exactly one product exists.

*Retry safety*

- Repeated create attempts with the same allocated SKU → at most one product
  exists, regardless of how reads behave in between. This is the claim that
  replaces the deleted "authoritative absence", and it must hold without any
  timing assumption.

## 5 · Seeding is not a migration

**No remote catalog read executes inside a schema migration.** A migration that
calls HubSpot or NetSuite makes schema deployment depend on third-party
availability and credentials, and makes its result unreproducible.

Three separate steps:

1. **Reconciliation input.** A read-only job surveys Nexus, HubSpot and
   production NetSuite and emits an **audited artifact**: every known SKU, its
   normalized form, its source system, and its identity. Reviewable, diffable,
   attributable to a point in time.
2. **Collision detection.** The job reports every case where distinct products
   normalize to the same SKU — across systems and within each. These are
   surfaced for resolution; the job resolves nothing.
3. **Seeding.** A separately approved operation consumes the reviewed artifact,
   populates the identity index, and sets each brand's counter **above** the
   maximum observed for that brand. It is not the migration, and it runs only
   on an artifact someone has read.

The migration creates structures. Nothing else.

## 6 · The governed brand registry

Tokens are **registered, never derived**. Deriving `MISTR` from
"MISTR - 2oz Lube Silicone" would mint a namespace from a typo.

```
sku_brand_registry
  token, display_name, hubspot_company_id NULL,
  kind ('customer' | 'shared'), active, created_at / created_by
```

- **From a customer quote:** the project's company resolves to a registry row
  and that brand is **preselected** — visible and overridable.
- **Direct Library creation:** an explicit choice of registered brand or
  approved shared namespace. No default; that surface has no customer context.
- Unregistered customer → creation says the brand must be registered first. A
  governed gap with a next step, not an operator with no path.

## 7 · Allocation, and the collision the counter cannot prevent

The atomic counter protects only Nexus allocations. An externally created
`DPS-ELE-1048` collides with a value the counter would later issue. So
allocation is a bounded loop: take the next value, check it against the
identity index, and on collision record the external value and advance. The
bound being reached is operator-visible, not a silent give-up.

Reconciliation raises counters when external values appear above them.
**Detection is not prevention**, and gaps created by this are expected per §1.

## 8 · Identity is not readiness

A generated SKU establishes an identifier and nothing more. It must not mark a
leaf NetSuite-ready; item resolution stays the separate gate it is today.

The same product carrying its SKU in Nexus, HubSpot and NetSuite is the
expected state. **Two distinct products sharing one is a conflict** that blocks
completion — so readiness compares identities, not the presence of a value.

## Prerequisites, in the order they block

1. **`nexus_allocation_id` property**, created AND integration-controlled.
   Without it adoption is unavailable and every uncertain create ends
   `conflicted`. Blocks recovery, not allocation.
2. **Production NetSuite survey.** Blocks counter seeding; the survey to date
   is sandbox.
3. **Registry contents adjudicated** — the 53 existing tokens, whether MISTR is
   registered, and which shared namespace is approved. Blocks generated
   allocation entirely; nothing can be issued without a token.
4. **Reconciliation artifact reviewed**, including its normalized-collision
   report. Blocks seeding.
5. **Seeding**, as a separately approved operation. Blocks go-live.

Items 1-3 are decisions. Items 4-5 are operations on those decisions.

## Outstanding, unapproved

- Production NetSuite survey.
- Registry adjudication, including whether MISTR is registered and which shared
  namespace is approved.
- The `nexus_allocation_id` HubSpot property, without which automatic adoption
  is not available and recovery ends in `conflicted`.
- Seeding, backfill of the 58 SKU-less leaves, and anything touching existing
  identifiers.
