# Direct Service — implementation plan

**Written 2026-08-17 against `2330296`.** Ordered around the ten boundaries in
the disposition. Authority:
[BV-012 §5](../business-validation/BV-012-production-cost-ownership.md),
[BV-011](../business-validation/BV-011-production-otc-accounting-map.md),
[BV-013](../business-validation/BV-013-production-markup-authority.md).

**The decided questions are not reopened here.** This records sequencing,
architectural dependencies, and the questions that genuinely still block.

---

## What blocks, and what merely follows

**Three architectural dependencies constrain the order.** Everything else is
downstream of them.

**D-1 · Identity precedes storage precedes surface.** Stages 1 → 3 → 4 are a
hard chain. The Costs surface must be gated on service identity, not on the
presence of production rows (otherwise the first stray row recreates what #282
removed), and identity cannot gate anything before it exists.

**D-2 · The Production-ownership migration and the BV-013 category migration
touch the same table.** Stage 3 adds a second owner column to
`assembly_production_inputs`; stage 5 changes how its markup resolves. Running
3 before 5 means stage 5 handles rows with either owner — which it must
eventually anyway. Running 5 first means re-proving BV-013's invariance after
stage 3 moves the rows underneath it. **Stage 3 first**, deliberately.

**D-3 · Stage 8 depends on F2's mechanism, which is directed but not designed.**
"Separately billed Item Group charges must reach the SO" is settled as
direction. Whether that is a new SO line built at push time, an OTC line
materialised at accept time, or a change to what `totalRevenue` includes, is
undecided — and it determines whether REG-4's "lines sum exactly to the accepted
commercial total" needs its definition of *accepted commercial total* revised.
See Q-A below.

---

## The stages

### 1 · Product Library service identity + attachment constraint

Add a governed service classification to the library entry. Not
`product_types.scope` (that is `["assembly","leaf"]`, i.e. placement), not the
legacy `Service / labor` type, not HubSpot's field.

The attachment boundary is the load-bearing half: a service-classified entry may
attach only as a top-level Direct Service. Enforced at the governed write
boundary — the same posture as Client Target's refusal of an Item Group member.

**Falsification:** attaching a service entry beneath an Item Group is refused by
the action, not merely absent from the UI.

### 2 · Setup — `Add Direct Service`

A third intentional act beside `+ Add Product` and `+ Create Item Group`. The
operator states what the customer is buying; nothing is inferred from which
Costs fields hold values.

**Falsification:** a Direct Service exists in the quote before any cost is
entered, and its identity survives having no costs at all.

### 3 · Production-input ownership — Item Group XOR Direct Service

`assembly_production_inputs` grows a nullable `quote_leaf_id`, `assembly_id`
becomes nullable, and a CHECK enforces exactly one owner.

**This shape is already in production twice:** OD-017 moved packaging cost
identity onto `quote_leaf_id`, and migration 0077 (Client Target) runs the
`assembly_id XOR quote_leaf_id` CHECK with per-branch partial unique indexes.
Follow 0077.

**The invariant that must not be lost.** Today "a Direct Product cannot own
production" is guaranteed by a NOT NULL FK — a violation is *unrepresentable*.
After this it becomes *legal and merely wrong*, so it needs an explicit guard:
only a service-classified leaf may own production rows. This is the Pattern 56
shape exactly, and the reason to write the guard in the same change that removes
the FK, not after.

**Falsification:** a production row keyed to a non-service `quote_leaf_id` is
refused; existing assembly-owned rows are bit-identical; the costing witness
shows zero movement.

### 4 · Costs authoring for Direct Service, gated by identity

Service authoring surface driven by the library service identity — a Filling
service does not expose Formulation, Tooling or Pack-out. No allocation control
(BV-012 §5.d). No packaging-component masquerade.

**Do not undo #282:** no generic Production table returns to top-level leaves.
The surface appears because the unit *is* a service, never because it *has*
rows.

### 5 · BV-013 — `Production` at 40%, preserving pin invariants

Already traced. The three-rung fallback is the risk, not the rate: `Raw
ingredients → Other`, the implicit `"Other"` default arg, and
`FALLBACK_MARKUP = 0.3` all resolve to 30% today, so a half-migration looks
correct now and breaks the moment any rate moves. A missing `Production`
category must fail loudly.

**Carries a prerequisite already identified:** existing pins contain
`Manufacturing` and `Raw ingredients`, never `Production`. Pinned quotes must
resolve their historical rate after consolidation rather than falling through to
live 40%. Compatibility first, then the live authority.

**Falsification:** drafts adopt 40%; every pinned non-draft is bit-identical;
no non-draft resolves live; no Production or Bulk Raw path can reach `Other` or
the 30% global fallback.

### 6 · Customer Quote / PDF

`customer-view-resolver.ts` aggregates by `aggByAssembly` and labels fees with
the assembly's `skuLabel`. A Direct Service has no assembly and would be
**invisible on the document the customer signs** — the Pattern 45 failure mode.
Widen the aggregation key to the owning sellable unit. `FEE_COPY`'s four labels
are narrower than the service vocabulary.

### 7 · NetSuite — standalone Direct Service projection

A service leaf with its own NetSuite item projects as a line by the existing
leaf-line mechanism; library service identity + BV-011 mapping resolve the item.
This is the *closest* of the NetSuite work to already functioning.

### 8 · NetSuite — Item Group OTC lines + allocation-OFF reconciliation

The largest stage, and the one carrying **D-3**. OTC lines associate with the
owning Item Group **without joining `composition_hash`** — product structure
alone governs Item Group identity, so Setup/Tooling/Testing/Freight changing
between quotes must not manufacture a new group. OD-004 identity stability is a
falsifiable property here, not a hope.

### 9 · Engagement expansion

Explicit operator action, original Direct Service history intact, new Item Group
built from remaining economics, nothing silently duplicated/deleted/moved, and
the service product **not** attached beneath the group.

Existing shapes worth reusing rather than inventing: `copied_from_quote_id`, the
`scenario_copied` audit action with its `source_type` discriminator, and the
`quote_snapshots` supersede pattern.

### 10 · End-to-end sandbox certification

Representative NetSuite orders for all three sellable units, with operator
review. Certification is the gate, not the last coding step.

---

## Genuinely unresolved — these still block

**Q-A · What is "the accepted commercial total" once OTC lines exist? (blocks 8)**
Today `totalRevenue` excludes allocation-OFF fees while the PDF folds them into
the grand total. The disposition settles that the SO must carry them. It does
not settle whether `totalRevenue` grows to include them (changing a figure many
surfaces read, including margin) or whether the SO composes its total from
`totalRevenue` **plus** OTC lines (leaving `totalRevenue` a unit-economics
figure). **These produce identical SO totals and different Pricing surfaces**,
so it cannot be deferred to implementation.

**Q-B · Is Bulk Raw authorable on a Direct Service? (blocks 4)**
BV-011 places Bulk Raw in the finished-good class with Filling and Pack-out. A
`Formulation` service plausibly carries raw material; a `Testing` service does
not. Stage 4 gates the surface on service identity, so this resolves as part of
Q-C rather than separately — but it is the case where the finished-good/OTC
split and the service vocabulary visibly disagree.

**Q-C · What is the governed service vocabulary, and its input mapping?
(blocks 1 and 4)** BV-011 names 16 accounting destinations. Which are sellable
as Direct Services, and which Production inputs does each expose? Stage 1 cannot
define the classification's *values* without this, and stage 4 cannot gate a
surface on it.

**Q-D · Do OTC lines exist at accept time or at push time? (blocks 8, 10)**
If they materialise only during SO push they are invisible to the operator
before it; if they exist earlier they need a home in the quote model and in the
snapshot. Bears directly on Pattern 52 — whether an OTC line is frozen at send.

---

## Not blocking, but decide before stage 3

**The pin/backfill work is complete and unaffected** — 14/14 pinned, economics
bit-identical, `legacy_live` at zero. **Step 5 of that sequence (retiring
`legacy_live` as a runtime path) is independent of everything here** and can
land whenever dispositioned; leaving it undone means a future unpinned non-draft
quote silently resolves live again.
