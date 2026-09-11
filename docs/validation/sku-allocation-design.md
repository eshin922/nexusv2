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

1. **Correlation token, the only strong proof.** The create payload carries the
   allocation id in a dedicated HubSpot property (e.g. `nexus_allocation_id`).
   A product found by SKU whose token equals this allocation's id is
   **provably** this intent's product. Adoption is then justified.
   *This requires a HubSpot property to be created — an admin action, outside
   this design's authority, and a prerequisite for automatic adoption.*

2. **Absent the token, ownership cannot be established.** Creation timestamp
   inside the attempt window and matching name/cost are corroborating, not
   probative: a concurrent operator creating the same product with the same
   SKU produces the same signature.

So: **no token, no adoption.** The allocation goes to `conflicted`, which
blocks completion and names what a human must resolve. Never auto-adopt by SKU
alone.

## 4 · Concurrency, crash recovery, and authoritative absence

### Intent is persisted before the external request

The allocation row is written and committed **before** any HubSpot call. A
crash between the call and recording its response therefore leaves a durable
record that a request may be outstanding, which is the whole point: the
alternative is an in-flight request nobody remembers making.

### One worker issues the create

A competing worker must not issue a second create for the same intent. The
claim is a conditional update, so it is decided by the database:

```sql
UPDATE sku_allocations
   SET state = 'create_in_flight',
       claimed_by = $worker, claim_expires_at = now() + interval '2 minutes',
       attempt_count = attempt_count + 1
 WHERE id = $id
   AND (state = 'allocated'
        OR (state = 'create_in_flight' AND claim_expires_at < now()))
RETURNING id;
```

No row returned means another worker holds the claim; that worker waits or
reports, and does not call HubSpot. An expired lease does NOT mean the request
failed — it means the outcome is unknown, so the lease expiring routes to
reconciliation, never to a fresh create.

### States

| state | meaning | next |
|---|---|---|
| `allocated` | SKU reserved, nothing sent | claim, then create |
| `create_in_flight` | a request is or was outstanding | on lease expiry → reconcile |
| `create_uncertain` | outcome unknown | reconcile |
| `hubspot_created` | product exists and is PROVEN ours | insert leaf |
| `complete` | leaf and product both exist | none |
| `conflicted` | SKU occupied, ownership unproven | human resolution |

### What establishes authoritative absence

**An empty search result does not, on its own.** HubSpot search is not
guaranteed read-your-writes, so a product created moments earlier can be absent
from a successful search.

Absence is authoritative only when ALL hold:

- the search **succeeded** — an error is not an absence;
- it ran after a settle window measured from the create attempt (a starting
  figure to be validated against observed behaviour, not assumed);
- it returned empty on **repeated** reads separated in time;
- the read was a direct `hs_sku` lookup rather than a full-text query.

Anything short of that keeps the allocation uncertain. An uncertain allocation
never creates. It is surfaced to an operator, because "we do not know" is a
state a person can act on and a machine should not paper over.

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

## Outstanding, unapproved

- Production NetSuite survey.
- Registry adjudication, including whether MISTR is registered and which shared
  namespace is approved.
- The `nexus_allocation_id` HubSpot property, without which automatic adoption
  is not available and recovery ends in `conflicted`.
- Seeding, backfill of the 58 SKU-less leaves, and anything touching existing
  identifiers.
