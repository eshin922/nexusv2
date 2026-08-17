# BV-013 — Production Markup Authority

## Status

**Approved governing business rule. Recorded 2026-08-17 (Edward).**

This document **authorizes no implementation.** The migration trace and the
repricing impact are recorded separately at
[`../validation/production-markup-migration-trace.md`](../validation/production-markup-migration-trace.md),
and **existing quotes must not be repriced without a further disposition.**

---

## 1. The rule

> **All Production inputs use one shared Production markup default.**

- One governed markup category: **`Production`**.
- Managed in **Firm Settings → Markup Defaults**, alongside the packaging
  defaults.
- Initial value: **40%**.
- Every Production input inherits it — Filling, Blending, Pack-out, Bulk Raw,
  Setup, Tooling, Artwork, R&D / Formulation, Testing, Other Service, and
  every other BV-011 Production/OTC destination.

### 1.a Bulk Raw has no separate markup authority

Bulk Raw uses `Production` like everything else. The current
`Raw ingredients → Other` resolution is **removed as pricing authority** — not
re-pointed, not kept as a fallback.

### 1.b Accounting destination does not imply markup policy

BV-011's destinations and item types are **independent** of this.
`OTC - Filling`, `OTC - Packout`, `OTC - Raws` and the rest remain accounting
destinations. Different NetSuite destinations do not mean different markup
policies, and sixteen destinations do not imply sixteen rates.

**`Production` is the pricing-policy category. BV-011's names are accounting
destinations. They are different axes and must not be collapsed.**

### 1.c Why one rate

Per-destination markup would be policy complexity carried by operators, for a
distinction they do not make commercially. One rate is the deliberate choice,
not an interim simplification.

### 1.d Usage counting must recognise Production

Firm Settings currently counts a category as "in use" only when a packaging
line carries it. Production consumes its category through the engine, not
through a per-line category value, so the category reads as unused while it is
pricing real quotes. The counting must reflect Production consumption.

---

## 2. What this settles

| Inventory item | Resolution |
|---|---|
| **D1** — markup per destination, per item type, or one rate | One rate: `Production` |
| **D2** — governed markup vocabulary | `Production` is added and governed; the nineteen-category list in `CLAUDE.md` remains unratified and is not adopted by this document |
| **A2** — Bulk Raw's markup authority | Resolved prospectively: there is none separate. **The retroactive question is NOT settled here** — see §3 |

---

## 3. Explicitly NOT settled

**Whether existing quotes are repriced.** Moving Production from 30% to 40%
changes computed prices on quotes that already exist, including **sent** ones,
because markup resolves at compute time from live `markup_defaults` rather than
from a per-quote snapshot.

Measured impact is in the migration trace. **No backfill, and no change to live
calculated prices, without a further disposition.** Recording this rule does
not authorize repricing anything.

---

## 4. Related authority

| Document | Relationship |
|---|---|
| [BV-011](BV-011-production-otc-accounting-map.md) | Accounting classification and destination. Independent axis — see §1.b |
| [BV-012](BV-012-production-cost-ownership.md) | Ownership: the Item Group owns the economics this rate prices |
| [`production-otc-decision-inventory.md`](../validation/production-otc-decision-inventory.md) | The decision set this closes D1, D2 and (prospectively) A2 within |
