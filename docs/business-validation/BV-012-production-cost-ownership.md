# BV-012 — Production Cost Ownership

## Status

**Approved governing business rule. Recorded 2026-08-17 (Edward, confirmed with
Accounting).**

This document **authorizes no implementation.** It changes no costing, PDF,
Quote, or NetSuite behaviour, and no code, schema, or migration may cite it as
authority to do so. It governs **where Production economics belong in Nexus** —
the unit of account — and nothing else.

### Why this is its own BV

- **[BV-006](BV-006-product-structure-contract.md) is frozen.** Its §3 defines
  the Commercial Cost Model and states that non-component commercial-cost
  values "are not LEAFs; are not ASY children" — but it is silent on *positive*
  ownership. It says where these costs do NOT live, never where they DO. BV-006
  itself specifies that only "a future Business Validation" may extend it; this
  is that document.
- **[BV-011](BV-011-production-otc-accounting-map.md) is a different question.**
  It governs accounting CLASSIFICATION and DESTINATION — which item type each
  input projects to. This governs OWNERSHIP — which business object incurs the
  economics in the first place. A cost can be correctly classified as
  `OTC - Filling` and still be attached to the wrong object. **Do not conflate
  the two.**

---

## 1. The rule

> **The Item Group is the finished-good economic envelope and the owner of
> Production economics.**

An Item Group represents the finished good. Its economics may include the
components and services required to produce and deliver that finished good.

Worked example — a skin serum Item Group:

- packaging components: bottle, pump, cap, carton, label;
- bulk / formula / raw material;
- production activities such as filling / blending and assembly / pack-out;
- freight and other applicable governed finished-good costs.

### 1.a Ownership

> **Production costs belong to the Item Group itself. They do not belong to an
> arbitrary packaging component underneath it.**

A 50ml bottle does not incur the filling cost merely because it is one
component of a filled serum. The finished-good Item Group incurs it.

### 1.b The inverse, equally governing

> **No Item Group → no Production economics.**

A Direct Product — a folding carton, bottle, pump — passes through with its
**standalone packaging economics only**. It does not receive Filling, Blending,
Pack-out, Bulk Raw, R&D or other turnkey Production economics, and the presence
of a component-level place to enter them is not a reason to.

### 1.c No ownership locations invented in the Product Library

Ordinary Nexus Product Library products such as "Filling" or "Pack-out" must
**not** be created merely to manufacture somewhere for these costs to live.

NetSuite may require accounting items — `OTC - Filling`, `OTC - Packout`,
`OTC - Raws` — and BV-011 governs those. They are **downstream accounting
projections of Item Group economics, not Nexus product identity.** An
accounting destination is not a business object.

---

## 2. This is a correction, not a description

The existing component / leaf-level Production model **may calculate correct
totals while assigning those economics to the wrong business object.**

Both halves of that sentence matter, and the second is not excused by the
first. Arithmetic correctness and attribution correctness are separate checks:
a stack that sums exactly can still report a figure against an object that does
not own it. See "Exact reconciliation is necessary but not sufficient" and
Pattern 58 in `CLAUDE.md`.

Treat this as a correction to the **Production unit of account.**

---

## 3. Scope boundary

This document does **not** authorize, and must not be cited to justify:

- any change to costing arithmetic, allocation behaviour, or markup resolution;
- any change to customer-facing Quote or PDF presentation;
- any change to NetSuite projection, item resolution, or grouping;
- any schema migration, backfill, or removal of an authoring surface;
- creating, renaming, or archiving any Product Library entry.

The reconciliation trace against the current implementation is recorded
separately at
[`../validation/production-cost-ownership-trace.md`](../validation/production-cost-ownership-trace.md).
That document reports findings; it decides nothing.

---

## 4. Related authority

| Document | Relationship |
|---|---|
| [BV-006](BV-006-product-structure-contract.md) | Product Structure Contract (**frozen**). Defines Direct LEAF / ASY / Commercial Product and the Commercial Cost Model. This BV supplies the positive ownership rule its §3 leaves unstated |
| [BV-011](BV-011-production-otc-accounting-map.md) | Accounting classification and destination. Answers *what item type*; this answers *whose economics*. Not interchangeable |
| [BV-009](BV-009-freight-treatment.md) | Freight treatment ⚠️ unratified — [OD-001](../OPEN_DECISIONS.md). §1 lists freight among finished-good costs; the freight *treatment* question remains BV-009's |
| `CLAUDE.md` Pattern 58 | Membership determines attribution, never arithmetic. The discipline this rule is an instance of |
