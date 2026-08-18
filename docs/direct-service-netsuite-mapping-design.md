# Direct Service → NetSuite item mapping — bounded Settings design

**Status:** design report, requested before Stage 3. Nothing implemented.
**Requested by:** Edward, 2026-08-14 (Stage 2 hold disposition).
**Scope:** the five canonical Direct Services only. Explicitly NOT the general
`netsuite_item_map` for the 1,082 catalog products.

---

## 1 · Why services need a mapping table when 1,082 products do not

This is the whole justification, so it goes first.

Today `resolveNetsuiteItem(sku)` resolves a leaf to a NetSuite item by
**exact SKU match** at push time (`src/lib/netsuite/item-resolver.ts`). Zero
matches and multiple matches both **block** the push; there is no auto-create.
That works for catalog products because their SKUs *are* the real NetSuite item
codes — `DPS-BOTTLE-0001` exists on both sides because both sides got it from
the same place.

The canonical services break that assumption at the root. Their SKUs —
`SVC-FORMULATION`, `SVC-FILLING-BLENDING`, `SVC-PACKOUT-ASSEMBLY`,
`SVC-TESTING-MICROS`, `SVC-OTHER` — are **Nexus-invented identifiers**, chosen
for readability and stability (migration `0080`). Nothing put them in NetSuite.
So SKU-match resolves `not_found` for every service, every time.

The resulting behaviour is *correct* and *useless*: the push blocks, and no
operator can clear the block, because the SKU that fails to match is a
canonical value they cannot edit. A permanent block with no operator remedy is
worse than an error — it is a dead end.

The mapping table is what converts that dead end into an admin task performed
once.

**A tempting wrong answer, named so it is not reached for later:** rename the
canonical SKUs to whatever NetSuite calls those services, and let SKU-match
work. It fails on two counts. It makes a *governed Nexus identity* depend on an
external system's naming, so a NetSuite rename silently breaks attachment and
costing rather than just the push. And it presumes exactly one NetSuite item
per service, forever, in one account — a presumption with nothing behind it.

---

## 2 · What is stored, and what each field is for

One firm-level table. Five rows maximum, one per governed identity.

| Field | Purpose |
|---|---|
| `service_identity` | **The key.** The governed `direct_service_identity` enum value. |
| `netsuite_item_code` | The NetSuite SKU / `itemid`. What an admin types and recognises. |
| `netsuite_internal_id` | **The authoritative reference.** What the SO write actually uses. |
| `resolved_at` | When `netsuite_internal_id` was last confirmed against NetSuite. |
| `resolved_by_user_id` | Who mapped it. |

### Why the key is the identity, not the leaf

`service_identity` is the value the database already guarantees is unique
(`leaves_service_identity_unique_idx`), and it is what the closed enum exists to
name. Keying on `leaves.id` would tie the mapping to a specific row, and
`0080`'s own comment says replacing a canonical record is a migration — a
migration that would then silently orphan the mapping. Keying on the SKU string
would reintroduce the string-matching fragility this table exists to remove.

### Why both the item code and the internal ID

They answer different questions and must not be collapsed:

- The **item code** is for humans. An admin recognises `SVC-FILL-01`; they do
  not recognise `41350`. It is what the Settings form takes as input and what
  the mapped-state row displays back.
- The **internal ID** is for machines. NetSuite item codes are mutable; internal
  IDs are not. Every write references the internal ID.

Storing only the code would mean re-resolving on every push, which is the
fragility being removed. Storing only the internal ID would leave an admin
staring at a number with no way to tell whether it is the right one.

**The write path must never use the item code.** That is the same discipline as
Pattern 58: the human-facing label may drift; the authoritative reference may
not.

---

## 3 · Resolution happens at mapping time, not at push time

When an admin saves a mapping, Nexus calls the **existing**
`resolveNetsuiteItem(itemCode)` and stores the returned internal ID with
`resolved_at`. The same three outcomes the resolver already produces surface
immediately, in Settings:

- `found` → mapping saved with the resolved internal ID.
- `not_found` → refused, naming the code that did not match.
- `ambiguous` → refused, listing the candidates. No silent first-match.

This is the point of the design. Those three refusals exist today and are
correct; what is wrong is *when* an admin meets them. At push time the operator
is mid-completion on a real quote and cannot fix a NetSuite catalog problem. At
mapping time an admin is doing catalog work already, with no quote blocked.

Reusing the resolver rather than writing a second lookup is deliberate — two
lookups would be two answers to "which item is this", which is the divergence
Pattern 58 and the attachment-gate note both warn about.

---

## 4 · Mapped state is three-valued, not a nullable field read as two

| State | Condition | Push |
|---|---|---|
| `unmapped` | no row | **blocked** |
| `mapped` | row present, internal ID resolved and confirmed | allowed |
| `stale` | row present, re-verification failed or item now inactive | **blocked** |

`stale` must be its own state rather than degrading to `mapped`. A mapping that
once resolved and no longer does is *not* a working mapping, and treating a
failed re-verification as "still fine" would push a Sales Order line at an
inactive item. It is also not `unmapped` — the admin's prior decision is intact
and should be shown, so re-mapping starts from what was there rather than from
blank.

**The read that produces this must distinguish "not found" from "the check
failed".** A NetSuite call that errors is `indeterminate`, and indeterminate is
not evidence of absence. Fold the two together and a transient API failure
silently marks every mapping stale, blocking all completion firm-wide. This is
the OD-027 lesson: a lookup wrapper that catches errors and returns "missing"
cannot establish nonexistence.

---

## 5 · Where the block lives

One place: `loadSalesOrderPreflight` (`src/lib/netsuite/sales-order-preflight.ts`),
alongside the existing per-leaf item resolution. Preflight already decides
whether a quote can push; adding a second gate elsewhere would create two
answers to that question.

Preflight enumerates every Direct Service on the quote, reads each identity's
mapping state, and blocks on any `unmapped` or `stale` — with a message naming
the service and pointing at Settings.

Three prohibitions, stated because each is individually tempting:

1. **Never fall back to SKU-match for a service.** It would normally find
   nothing; the danger is the case where it finds *something* — an unrelated
   NetSuite item an admin happened to create as `SVC-OTHER`. A wrong item on a
   Sales Order is worse than a blocked push.
2. **Never auto-create the NetSuite item.** Same reasoning already recorded in
   the item resolver: GL accounts, costing, UoM and tax config all require human
   setup.
3. **Never guess among ambiguous candidates.** Already the resolver's behaviour;
   the mapping must not weaken it.

---

## 6 · Not a Pattern 52 pinned column

Worth stating explicitly so a later reader does not add the pin.

The mapping is a **routing table**, not a commercial term. It answers "which
NetSuite record represents this service", not "what did we charge". Nothing an
operator negotiated depends on it. Once a quote completes, the internal ID it
actually used is on the Sales Order and in the `quote_completed` audit row's
`diff_json.netsuite` subtree — so historical reproducibility is already served
by the record of what happened, not by freezing what the table said.

Re-mapping a service later therefore does **not** retroactively reprice or
re-route anything already pushed.

---

## 7 · Bounded scope

**In:** one table (≤5 rows), an admin Settings surface to view and set the five
mappings, resolution-on-save through the existing resolver, the three-valued
state, and the preflight block.

**Out:** the general `netsuite_item_map` for catalog products (the option-D
roadmap item in the item resolver's header — a different problem with a
different justification, and 1,082 rows rather than 5). Bulk re-verification
scheduling. Per-quote mapping overrides. Auto-creation of NetSuite items.
Writing anything back to NetSuite.

## 8 · Open for disposition before implementation

1. **Where in Settings.** Its own card, or inside an existing NetSuite/
   integrations section? Affects nothing structural.
2. **Re-verification trigger.** On-demand button only, or also lazily on
   preflight read? The lazy path makes `stale` discoverable without an admin
   visiting Settings, at the cost of a NetSuite call in the preflight path.
3. **Does `other_service` map at all?** It is the catch-all identity. If the
   firm books miscellaneous services against several different NetSuite items,
   one mapping cannot express that, and the honest answer may be that
   `other_service` requires a per-use item choice rather than a firm default.
   This is a business question, not a technical one.

---

**Cross-references.** `drizzle/0080_canonical_direct_services.sql` (the
canonical records and their SKUs); `src/lib/netsuite/item-resolver.ts` (the
resolver being reused, and its option-D note); BV-012 §5.f (the closed service
vocabulary); Pattern 58 (authoritative reference vs human-facing label);
OD-027 (a failed read is not evidence of absence).
