# BV-014 — Component-Charge Accounting Destination

## Status

**Partial disposition. Recorded 2026-08-29 (Edward). Amended same day —
see §4.**

This document **authorizes no implementation.** It records which
component-owned charge types have a governed BV-011 accounting destination,
which are waiting on Accounting configuration, which are waiting on an
Accounting or business decision, and which are deliberately unsupported in V1.

**The destination axis is NOT complete.** One of five component charge types is
fully configured. Nothing here should be read as clearing component charges for
NetSuite.

**Commercial pricing authority is settled separately and is not affected by
anything in this document.** See [BV-013](BV-013-production-markup-authority.md)
for the production rate rule and PR #501 (`58a83ef`) for the charge-type rule.

---

## 1. The two axes are independent

> **Commercial authority** — what recovery and sell follow from the charge type.
> **Accounting destination authority** — where a separately billed charge posts
> in NetSuite.

They are governed separately and must not be inferred from one another.
`print_plates` prices as **Tooling** and posts to **`OTC - Print Plates`**; that
is not a contradiction, it is the two axes answering two questions.

The concrete failure this prevents: reading a destination off a markup category
would send print plates to the tooling account because they share a rate, and
the resulting Sales Order would reconcile to the correct total while posting to
the wrong account. Correct totals are not evidence of correct attribution.

---

## 2. Disposition by charge type

| Charge type | Markup authority | BV-011 destination | Status |
|---|---|---|---|
| `artwork_plate` | Manufacturing 0.30 | **`OTC - Artwork`** (`otc_artwork`, Non-inv) | **Code-ready.** Item `OTC-0001` / `11012` mapped 2026-08-19. |
| `print_plates` | Tooling 0.20 | **`OTC - Print Plates`** (`otc_print_plates`, Non-inv) | **Accounting execution task** — create and map the item. §4. |
| `samples` | Manufacturing 0.30 | **`OTC - Samples`** (`otc_samples`, Non-inv) | **Accounting execution task** — create and map the item. §4. |
| `tooling` | Tooling 0.20 | **UNDECIDED** | **Accounting/business authority unresolved.** Two questions, §5. |
| `other_service` | **UNCLASSIFIED** | **UNGOVERNED** | **Deliberately unsupported in V1**, both axes. §6. |

---

## 3. Code-ready mappings

**`artwork_plate` → `otc_artwork`.**

This is the **prepress / adaptation-labour** half. It is **not**
`otc_print_plates`. The registry already governs the division: once
`print_plates` exists as its own type, a new component-owned `artwork_plate`
means only the adaptation-labour half, because the plate-making half has
somewhere else to go. Proofs fold in here for the same reason — a proof is
prepress labour, not a plate.

Both destinations are Non-inventory, so the split raises no item-type question.

**This makes `artwork_plate` the nearest component type to a NetSuite
certification subject** — and the only one. A destination model that shipped
for `artwork_plate` alone would leave four types unsendable, which is the
correct outcome, not a partial success to be reported as progress.

---

## 4. Accounting configuration — create the missing items

**AMENDED 2026-08-29 (Edward). These are no longer open Accounting decisions.
They are configuration / execution tasks.**

**`print_plates` → `otc_print_plates`** and **`samples` → `otc_samples`.** The
semantic authority exists in BV-011 §1.b for both and the enum values exist in
the destination catalogue; what is missing is the NetSuite record. Verified
against `netsuite_destination_item_map` on 2026-08-29: **neither destination has
a row.**

**The disposition is to CREATE the required NetSuite items.**

### 4.1 Do not substitute an existing item to avoid creating one

The governed destination semantics recorded in §2 and §3 stand. Mapping either
destination to some already-existing item because one is to hand would put the
charge in an account that does not mean what the charge means — and it would
reconcile perfectly, which is why it would not be noticed. A near-enough item is
not a shortcut to the same outcome; it is a different outcome that looks
identical on the total.

### 4.2 Capture, per new item, before implementation or certification

| Field | Source |
|---|---|
| NetSuite internal ID | resolved by the mapping surface, not typed |
| Item / SKU name (`itemid`) | as created in NetSuite |
| Item type | returned by the resolver; see §4.4 |
| Destination mapping | `otc_print_plates` / `otc_samples` |
| Accounting approval / evidence | who approved, when, against what |

### 4.3 Map through the governed surface, never in code

Use **`/admin/netsuite`** → `saveDestinationMapping`. The admin enters the
**item code**; the action calls `netsuite.resolveItem` and writes the
authoritative internal id itself, refusing `not_found` and refusing `ambiguous`
rather than taking a first match. It writes a `destination_item_mapping_set`
audit row carrying the destination, its governed item type, and the before /
after mapping.

**No ad-hoc code mapping to an item ID.** An internal id pasted into a source
file is a second copy of a mapping the admin table already owns, free to drift,
and it skips both the resolution and the audit row that make the mapping
evidence rather than an assertion.

### 4.4 Item type — get it right at creation

BV-011 governs **both** destinations as **Non-inventory**, and `resolveItem`
already returns the real `itemtype`, so the value is available at mapping time.

**Nothing compares it to the governed expectation** — that is the §5.6c gap in
§5.2, where `governed_item_type` is written to an audit `diff_json` and never
checked. Both existing mismatches (`otc_tooling`, `otc_filling`) arose from
mapping **pre-existing** items whose type nobody chose. These two items do not
exist yet, so their type can be correct by construction rather than reconciled
afterwards. Create them as Non-inventory and record the resolved `itemtype` as
evidence that they are.

### 4.5 Until then

An unmapped destination must continue to block the send. Nothing in the codebase
may choose an item, and no fallback may stand in for one.

For reference, the destinations that ARE mapped: `otc_filling`, `otc_packout`,
`otc_setup`, `otc_artwork`, `otc_tooling`, `otc_formulation`. `otc_testing` and
`otc_other_service` are per-line by design and hold no firm row. The remaining
eight, including print plates and samples, have none.

---

## 5. Unresolved Accounting / business authority — `tooling`

**No destination disposition. One governing question for Accounting (§5.1b)
and one independent blocker (§5.2), both open.**

**The §4 amendment does not reach `tooling`.** That disposition creates missing
ITEMS; the tooling question is which DESTINATION the charge belongs to, and it
stays open whether or not any item exists. Creating an item cannot answer it —
there are already two destinations, both real, and nothing on the charge says
which one an amount is.

### 5.1 The charge type spans two BV-011 authorities

The component type is labelled **"Tooling & dies"**. BV-011 §1.b governs those
as **different destinations with different item types**:

| BV-011 input | Destination | Item type |
|---|---|---|
| Tooling | `OTC - Tooling` | **Inventory** |
| Emboss / Deboss / Foil / Cutting Die | `OTC - Dies` | **Non-inventory** |

Structurally identical to `tooling_artwork_legacy`, which readiness already
refuses with a dedicated blocker because *"no rule can say which half this
amount is."* **The destination therefore does not depend only on charge type**
— it depends on which physical thing was bought, and the model records no such
fact.

**Must not be mapped by name, and must not be resolved by choosing one
arbitrarily.**

### 5.1a The distinction has never existed operationally

**Superseding the earlier framing of this section.** It offered a type split, a
discriminator, and a single destination as three peer options. They are not
peers, and presenting them that way invited a design decision where a factual
question comes first. Evidence gathered 2026-08-29:

- **`OTC - Dies` has no authoring surface, and never has.** BV-011 §1 records it
  among seven destinations with none: *"Testing / Micros, **Dies**, Print
  Plates, Samples / PPS, Processing Fee, Cartons, and Customs."*
- **No separate Dies production input exists.** `VIRTUAL_LINES` defines six
  production inputs; none is dies.
- **Historical dies therefore necessarily entered through Tooling.** Live
  counts: `tooling_total` 9 rows, `artwork_total` 8, `tooling_artwork_total`
  (legacy combined) 14. Whatever dies the firm has bought are inside those
  figures, already posting to `OTC - Tooling`.
- **No latent distinction in free text.** All seven `tooling` /
  `artwork_plate` / `tooling_artwork_legacy` charge instances carry
  `label = NULL`. There is nothing to mine.
- **The component label is accurate, not sloppy.** "Tooling & dies" describes
  the commercial fact operators have always recorded as one.

So **a single destination is the STATUS QUO, not a compromise between options**,
and `OTC - Dies` is an aspirational destination in the map with no operational
counterpart on either side of the system.

### 5.1b The one governing question for Accounting

> **Does Accounting require dies to be posted separately from tooling going
> forward?**

**If NO — govern V1:**

- `tooling` ("Tooling & dies") → **`otc_tooling`**.
- No new discriminator, no new charge type, no new input, no historical
  migration.
- `OTC - Dies` remains an **unused destination** unless and until the business
  deliberately introduces separate die accounting.

**If YES — stop. This is a new operational capability, not a mapping
correction.** Return for design covering:

1. how the operator identifies Tooling versus Dies;
2. separate charge type versus a discriminator on the charge;
3. storage;
4. authoring;
5. destination;
6. treatment of historical amounts previously recorded as Tooling.

**Do not infer or backfill the distinction from existing data.** No such data
exists — an inference would be manufacturing a record of a decision nobody
made, and it would be indistinguishable from a real one afterwards.

### 5.2 §5.6c remains open — do not route new charges to `otc_tooling`

Independently of §5.1, `otc_tooling` carries an Accounting question **raised
2026-08-19 and not acted on**, recorded at
[`../validation/accounting-uat-plan.md`](../validation/accounting-uat-plan.md)
§5.6c:

| destination | BV-011 declares | mapped item | item actually is |
|---|---|---|---|
| `otc_tooling` | **Inventory** | `OTC-0005` (4077) | **NonInvtPart** |
| `otc_filling` | **Inventory** | `BLD-FILL` (14525) | **NonInvtPart** |

`otc_filling` is pre-existing and in use, so the Case 0 mappings did not
introduce this; they made it visible. **Nothing enforces the declaration** —
`netsuite-destination-map.ts` records `governed_item_type` into the audit
`diff_json` and never compares it to the resolved item's real type, so a
mismatch saves silently.

**Component charges must not be routed to `otc_tooling` until this is
resolved — INCLUDING under a NO answer to §5.1b.** The two are independent: NO
settles which destination the charge belongs to; §5.6c settles whether that
destination's declared semantics or its mapped item is wrong. Approving the
first does not release the second.

Accounting must establish which authority is wrong, or whether BV-011's
`itemType` field has a different intended meaning than a claim about the
NetSuite record's type — the third possibility the UAT plan names.

Routing before that resolves would consume an unsettled question and multiply
the population affected by whichever answer lands.

---

## 6. Deliberately unsupported in V1 — `other_service`

**Ungoverned on both axes, by decision.**

- **Commercial:** `unclassified` in the charge-type authority map. An
  operator-labelled catch-all has no type to govern its rate, so it recovers
  nothing and cannot be sent — BV-013's "no governed rate, no price", reached
  deliberately rather than defaulting to the `Other` markup category because the
  two share a word.
- **Accounting:** `otc_other_service` is a **per-line** destination whose item is
  chosen per line; migration 0081's CHECK forbids it a firm row.

**A structural obstacle sits behind it, and this phase does not touch it.**
Per-line selections live in `quote_other_service_items`, whose live indexes are
`qosi_assembly_unique` and **`qosi_leaf_unique` — one selection per
`quote_leaf`**. A component may own **two instances of the same charge type**,
so two `other_service` charges on one carton would need two selections while the
index admits one. The destination catalogue already names this tripwire: adding
such a destination *"needs a `destination` column, a new unique key, and a
backfill. Do not add such a destination here without doing that first."*

Unreachable today only because the charge is unpriced. **Do not change
`quote_other_service_items` keying or the per-line destination model in this
phase.**

---

## 7. What this means for certification

**NetSuite / end-to-end certification remains BLOCKED for component-owned
charges** until a governed destination is available for the certification
subject.

Component OTC lines are already unsendable and were before PR #501: the
projection records `bv011Destination: null` for every one of them, and
`otc_dies` / `otc_print_plates` / `otc_samples` are assigned by nothing
anywhere. #501 did not worsen this — it replaced a remediation that told the
operator to revise and re-send (which records `null` again, an instruction that
cannot succeed) with `component_destination_ungoverned`, which states the true
reason.

**One of five types being configured is not a destination axis.** Any status
report on this work states the four unfinished categories explicitly rather than
leading with `artwork_plate`.

Under the §4 amendment the count becomes **one configured, two in execution, one
undecided, one deliberately unsupported** — which is progress on the axis and
still not a complete axis. The two items do not exist until they exist; a
disposition to create them is not a mapping.

---

## 8. Out of scope

- **Commercial pricing authority** — settled; PR #501 (`58a83ef`).
- **Legacy seven-column repricing** — separate, unchanged. The legacy columns
  still resolve one `Production` category, which is why a legacy tooling charge
  prices at 0.40 while a `Tooling` category exists at 0.20.
- **The Drizzle migration-history divergence** — a separate infrastructure
  finding. `__drizzle_migrations.created_at` no longer corresponds to
  `_journal.json.when` for six entries, so the documented "verify the pending
  set" method reports false pendings. Not to be folded into destination work.

---

## 9. Evidence

Gathered 2026-08-29 against the live shared database and the current tree.

- `netsuite_destination_item_map` — six mapped destinations; none of
  `otc_print_plates`, `otc_samples`, `otc_dies` has a row.
- `quote_snapshot_lines` — posted destinations to date are `otc_setup` (13),
  `otc_testing` (4), `otc_formulation` (1), `otc_packout` (1). **`otc_tooling`
  and `otc_artwork` are mapped but have never appeared on a frozen line**;
  configured is not the same as proven in a real Sales Order.
- `pg_indexes` on `quote_other_service_items` — `qosi_leaf_unique` confirmed.
- No `charge_key → destination` map exists in the codebase. Verified behind a
  known-positive control, so the empty result means absence rather than a grep
  that could not match.
- `BV011_DESTINATIONS` — 5 Inventory, 11 Non-inventory, matching BV-011 after
  the 2026-08-20 packout amendment. The module's header comment still says
  *"six Inventory and ten Non-inventory"* and is stale; the array is correct.
